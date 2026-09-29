"""
leaves.py — Leave Tracker module (v2: monthly-cap model)
===========================================================
Design (per confirmed rules):

Leave types: CL, SL, LP, ML (ML is female-only).

Monthly free quota — checked PER MONTH, no annual running balance, no
carry-over (this is why there's no accrual job anymore — the cap simply
applies fresh each month):

    category        CL/SL pool (per month)   ML pool (per month)
    regular         2                        n/a
    probationary    1                        n/a
    female          2                        1

Day-level overflow: within a single request, each individual DAY is checked
against how many free days are left in *that day's* calendar month. Days
that fit the remaining free quota are recorded as the requested type
(CL/SL/ML); any day beyond the cap automatically becomes LP. A single
request can therefore be part-paid / part-LP (e.g. 2 days free left this
month + a 3-day request -> 2 days CL/SL + 1 day LP).

LP itself has no cap — it's just logged.

A live PREVIEW endpoint lets the frontend show the employee the paid/LP
split (and a warning) before they submit.

Approval routing is unchanged from v1:
  employee -> manager -> (HR notified)
  manager (own request) -> HR Head/Admin -> (HR notified)
  HR / HR Head: view everything + adjust balances, never approve.
  HR Head / Admin: additionally decide manager-routed requests.
"""

from flask import Blueprint, request, jsonify, g, current_app
from flask_jwt_extended import get_jwt_identity
from datetime import datetime, timedelta
from bson import ObjectId
from bson.errors import InvalidId

from auth_utils import tenant_scoped, require_role
from tenant_scope import get_db

leaves_bp = Blueprint('leaves', __name__)

BUILTIN_LEAVE_TYPES = {'CL', 'SL', 'LP', 'ML', 'MATERNITY', 'OD', 'CO', 'PERMISSION'}
POOLED_TYPES = {'CL', 'SL'}         # share the CL/SL monthly pool
ML_TYPE = 'ML'                      # its own monthly pool, female only
MATERNITY_TYPE = 'MATERNITY'        # female only, no cap, continuous block, no quota impact
OD_TYPE = 'OD'                      # not leave — marks attendance as Present, no balance impact
CO_TYPE = 'CO'                      # comp-off — standalone earned balance, not month-based
PERMISSION_TYPE = 'PERMISSION'      # half-day draws 0.5d from CL/SL pool; hourly tracked separately, no pool impact
FEMALE_ONLY_TYPES = {ML_TYPE, MATERNITY_TYPE}

DEFAULT_CATEGORY_RULES = {
    'regular':      {'monthly_cap': 2, 'ml_monthly_cap': 0},
    'probationary': {'monthly_cap': 1, 'ml_monthly_cap': 0},
    'female':       {'monthly_cap': 2, 'ml_monthly_cap': 1},
}


# ─────────────────────────────────────────────────────────────────────────────
# Per-tenant leave policy: fiscal/calendar leave year, category caps, and
# HR-defined custom leave types (beyond the built-in CL/SL/ML/LP/MATERNITY/
# OD/CO/PERMISSION set). Loaded fresh each request — cheap single-document
# reads, and this way a policy change takes effect immediately.
# ─────────────────────────────────────────────────────────────────────────────

def _get_leave_policy(db):
    """Returns a fully-populated policy dict, merging any tenant customization
    on top of the built-in defaults so callers never need to null-check.

    NOTE: `companies` documents don't carry a tenant_id field on themselves
    (a company IS a tenant, not tenant-scoped data) — looking them up through
    the get_db() wrapper would auto-merge a tenant_id filter that no company
    doc can ever match. This deliberately bypasses the wrapper and reads the
    calling tenant's own company doc directly via g.tenant_id."""
    company = current_app.db.companies.find_one({'_id': ObjectId(g.tenant_id)}) or {}
    policy = company.get('leave_policy') or {}
    start_month = policy.get('leave_year_start_month') or 1
    category_rules = dict(DEFAULT_CATEGORY_RULES)
    custom_rules = policy.get('category_rules') or {}
    for cat, rules in custom_rules.items():
        if cat in category_rules and isinstance(rules, dict):
            category_rules[cat] = {**category_rules[cat], **rules}
    return {'leave_year_start_month': start_month, 'category_rules': category_rules}


def _leave_year(d, start_month):
    """Maps a date to its 'leave year' label under the tenant's fiscal-year
    setting. start_month=1 (default) reproduces plain calendar-year
    behavior (label == d.year). For any other start_month, the label is the
    year the leave year STARTS in — e.g. start_month=4 (Apr-Mar): a date in
    Jan-Mar belongs to the leave year that started the previous April."""
    if start_month <= 1:
        return d.year
    return d.year if d.month >= start_month else d.year - 1


def _current_leave_year(db):
    policy = _get_leave_policy(db)
    return _leave_year(datetime.now(), policy['leave_year_start_month'])


def _get_custom_types(db, active_only=True):
    """Dict of {code: doc} for this tenant's HR-defined custom leave types."""
    query = {'is_active': True} if active_only else {}
    return {t['code']: t for t in db.leave_types.find(query)}


def _all_leave_type_codes(db):
    return BUILTIN_LEAVE_TYPES | set(_get_custom_types(db).keys())


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _s(doc):
    doc['_id'] = str(doc['_id'])
    return doc


def _is_probationary(emp):
    joining = emp.get('joining_date')
    months = emp.get('probation_period', 6)
    if not joining:
        return False
    try:
        months = int(months)
    except (TypeError, ValueError):
        months = 6
    jd = None
    for fmt in ('%Y-%m-%d', '%d-%m-%Y', '%d/%m/%Y'):
        try:
            jd = datetime.strptime(str(joining).strip(), fmt)
            break
        except ValueError:
            continue
    if not jd:
        return False
    probation_end = jd + timedelta(days=30.44 * months)
    return datetime.now() < probation_end


def _suggest_category(db, emp, employee_id=None):
    if _is_probationary(emp):
        return 'probationary'
    gender = (emp.get('gender') or '').strip().lower()
    if not gender and employee_id:
        user = db.users.find_one({'employee_ref': employee_id})
        if user:
            gender = (user.get('gender') or '').strip().lower()
    if gender == 'female':
        return 'female'
    return 'regular'


def _get_or_create_category(db, employee_id, year=None, category_rules=None):
    """One doc per employee per leave-year holding the category + per-month
    usage counters. No accrual needed — the cap is checked live against
    actual usage recorded for that specific month. `year` is a leave-year
    label (see _leave_year) — plain calendar year if the tenant hasn't set
    a fiscal leave_year_start_month."""
    year = year if year is not None else _current_leave_year(db)
    category_rules = category_rules or _get_leave_policy(db)['category_rules']
    doc = db.leave_balances.find_one({'employee_id': employee_id, 'year': year})
    if doc:
        # Defensive migration: a doc created by an earlier schema version
        # (e.g. the old annual_quota/monthly_credit model) is missing the
        # v2 fields. Rather than crash, backfill them in place.
        required = ('monthly_cap', 'ml_monthly_cap', 'monthly_used', 'ml_monthly_used', 'lp_monthly', 'comp_off_balance')
        if not all(k in doc for k in required):
            category = doc.get('category') or _suggest_category(db, db.employees.find_one({'_id': ObjectId(employee_id)}) or {}, employee_id)
            rules = category_rules.get(category, category_rules['regular'])
            patch = {
                'category':        category,
                'monthly_cap':     doc.get('monthly_cap', rules['monthly_cap']),
                'ml_monthly_cap':  doc.get('ml_monthly_cap', rules['ml_monthly_cap']),
                'monthly_used':    doc.get('monthly_used') or {str(m): 0 for m in range(1, 13)},
                'ml_monthly_used': doc.get('ml_monthly_used') or {str(m): 0 for m in range(1, 13)},
                'lp_monthly':      doc.get('lp_monthly') or {str(m): 0 for m in range(1, 13)},
                'comp_off_balance': doc.get('comp_off_balance', 0),
                'comp_off_earned_dates': doc.get('comp_off_earned_dates') or [],
                'custom_used':     doc.get('custom_used') or {},
                'updated_at':      datetime.utcnow(),
            }
            db.leave_balances.update_one({'_id': doc['_id']}, {'$set': patch})
            doc.update(patch)
        doc.setdefault('custom_used', {})
        return doc

    emp = db.employees.find_one({'_id': ObjectId(employee_id)})
    if not emp:
        return None

    category = _suggest_category(db, emp, employee_id)
    rules = category_rules.get(category, category_rules['regular'])

    doc = {
        'employee_id':     employee_id,
        'year':            year,
        'category':        category,
        'monthly_cap':     rules['monthly_cap'],
        'ml_monthly_cap':  rules['ml_monthly_cap'],
        'monthly_used':    {str(m): 0 for m in range(1, 13)},   # CL/SL pool, per month
        'ml_monthly_used': {str(m): 0 for m in range(1, 13)},   # ML pool, per month
        'lp_monthly':      {str(m): 0 for m in range(1, 13)},   # informational only
        'comp_off_balance': 0,                                  # earned comp-off, standalone
        'comp_off_earned_dates': [],                            # weekend/holiday dates already credited — prevents double-crediting
        'custom_used':     {},                                  # {type_code: {month_str: count}} for HR-defined custom types
        'manually_set':    False,
        'created_at':      datetime.utcnow(),
        'updated_at':      datetime.utcnow(),
    }
    result = db.leave_balances.insert_one(doc)
    doc['_id'] = result.inserted_id
    return doc


def _date_range(from_date, to_date):
    f = datetime.strptime(from_date, '%Y-%m-%d')
    t = datetime.strptime(to_date, '%Y-%m-%d')
    days = []
    d = f
    while d <= t:
        days.append(d)
        d += timedelta(days=1)
    return days


def _compute_split(cat_doc, leave_type, from_date, to_date, custom_type=None):
    """Day-by-day: for each day, spend from that day's month's remaining free
    quota (CL/SL pool, ML pool, or a custom type's own flat pool); anything
    left over becomes LP for that day. Returns (paid_days, lp_days,
    month_breakdown) where month_breakdown is a list of {year, month, paid,
    lp} so approval can credit the right buckets. Does NOT mutate cat_doc —
    this is also used for the pre-submit preview.

    `custom_type` is the leave_types doc for an HR-defined custom type (only
    passed when leave_type isn't one of the built-in codes)."""
    if leave_type == 'LP':
        days = _date_range(from_date, to_date)
        return 0, len(days), []

    if leave_type in (MATERNITY_TYPE, OD_TYPE):
        # No monthly-quota impact whatsoever — Maternity is a paid continuous
        # block outside the CL/SL/ML pools; On Duty isn't leave at all (it's
        # handled as a Present marker over in attendance.py).
        days = _date_range(from_date, to_date)
        return len(days), 0, []

    if leave_type == CO_TYPE:
        # Comp-off draws from its own standalone earned balance, not a
        # per-month pool — the balance check/deduction happens in apply_leave
        # and the approval handler, not here.
        days = _date_range(from_date, to_date)
        return len(days), 0, []

    if custom_type is not None:
        cap = custom_type.get('monthly_cap')
        if cap is None:
            # Uncapped custom type — same shape as LP, but keeps its own code
            # (so reporting can still tell it apart from generic LP).
            days = _date_range(from_date, to_date)
            return len(days), 0, []
        used_map = cat_doc.get('custom_used', {}).get(custom_type['code'], {})
        running_used = dict(used_map)
    else:
        is_ml = (leave_type == ML_TYPE)
        cap = cat_doc['ml_monthly_cap'] if is_ml else cat_doc['monthly_cap']
        used_map = cat_doc['ml_monthly_used'] if is_ml else cat_doc['monthly_used']
        running_used = dict(used_map)

    days = _date_range(from_date, to_date)
    by_month = {}
    for d in days:
        key = (d.year, d.month)
        month_str = str(d.month)
        remaining = cap - running_used.get(month_str, 0)
        by_month.setdefault(key, {'paid': 0, 'lp': 0})
        if remaining > 0:
            running_used[month_str] = running_used.get(month_str, 0) + 1
            by_month[key]['paid'] += 1
        else:
            by_month[key]['lp'] += 1

    month_breakdown = [
        {'year': y, 'month': m, 'paid': v['paid'], 'lp': v['lp']}
        for (y, m), v in sorted(by_month.items())
    ]
    total_paid = sum(v['paid'] for v in by_month.values())
    total_lp = sum(v['lp'] for v in by_month.values())
    return total_paid, total_lp, month_breakdown


def _compute_permission(cat_doc, permission_mode, the_date, from_time=None, to_time=None):
    """Half-day permission draws 0.5 day from the CL/SL pool for that day's
    month (falls to LP if the pool is already exhausted). Hourly permission
    is tracked in hours only and never touches the CL/SL pool.
    Returns (paid_days, lp_days, month_breakdown, permission_hours)."""
    if permission_mode == 'hourly':
        try:
            t1 = datetime.strptime(from_time, '%H:%M')
            t2 = datetime.strptime(to_time, '%H:%M')
        except (TypeError, ValueError):
            return None
        hours = round((t2 - t1).total_seconds() / 3600, 2)
        if hours <= 0:
            return None
        return 0, 0, [], hours

    # half_day
    d = datetime.strptime(the_date, '%Y-%m-%d')
    month_str = str(d.month)
    remaining = cat_doc['monthly_cap'] - cat_doc['monthly_used'].get(month_str, 0)
    if remaining >= 0.5:
        paid, lp = 0.5, 0
    else:
        paid, lp = 0, 0.5
    breakdown = [{'year': d.year, 'month': d.month, 'paid': paid, 'lp': lp}]
    return paid, lp, breakdown, None


def _apply_month_breakdown(db, cat_doc_id, is_ml, month_breakdown, custom_code=None):
    field = f'custom_used.{custom_code}' if custom_code else ('ml_monthly_used' if is_ml else 'monthly_used')
    lp_field = 'lp_monthly'
    inc = {}
    for entry in month_breakdown:
        m = str(entry['month'])
        if entry['paid']:
            inc[f'{field}.{m}'] = inc.get(f'{field}.{m}', 0) + entry['paid']
        if entry['lp']:
            inc[f'{lp_field}.{m}'] = inc.get(f'{lp_field}.{m}', 0) + entry['lp']
    if inc:
        db.leave_balances.update_one({'_id': cat_doc_id}, {'$inc': inc, '$set': {'updated_at': datetime.utcnow()}})


def _apply_approval_effects(db, cat_doc, r):
    """Called once a request is approved — applies the correct balance
    mutation for whichever leave_type this request actually is."""
    leave_type = r.get('leave_type')
    if leave_type in ('LP', MATERNITY_TYPE, OD_TYPE):
        return  # no balance impact
    if leave_type == CO_TYPE:
        db.leave_balances.update_one(
            {'_id': cat_doc['_id']},
            {'$inc': {'comp_off_balance': -r.get('days', 0)},
             '$set': {'updated_at': datetime.utcnow()}},
        )
        return
    if leave_type == PERMISSION_TYPE:
        if r.get('permission_mode') == 'hourly':
            return  # hourly never touches CL/SL — nothing to apply
        _apply_month_breakdown(db, cat_doc['_id'], False, r.get('month_breakdown', []))
        return
    if leave_type not in BUILTIN_LEAVE_TYPES:
        # HR-defined custom type — its own flat pool, tracked separately
        # from the built-in CL/SL/ML pools.
        _apply_month_breakdown(db, cat_doc['_id'], False, r.get('month_breakdown', []), custom_code=leave_type)
        return
    # CL, SL, ML
    _apply_month_breakdown(db, cat_doc['_id'], leave_type == ML_TYPE, r.get('month_breakdown', []))


def _notify_hr(db, message, link='', related_id=None):
    db.leave_notifications.insert_one({
        'target_role': 'hr', 'message': message, 'link': link,
        'related_id': related_id, 'read': False, 'created_at': datetime.utcnow(),
    })


def _enrich_request(r, db):
    r['_id'] = str(r['_id'])
    try:
        emp = db.employees.find_one({'_id': ObjectId(r.get('employee_id', ''))})
        r['employee_name'] = emp.get('name', 'Unknown') if emp else 'Unknown'
        r['employee_code'] = emp.get('employee_id', '') if emp else ''
        r['department']    = emp.get('department', '') if emp else ''
    except Exception:
        r['employee_name'], r['employee_code'], r['department'] = 'Unknown', '', ''
    return r


def _this_year_summary(cat_doc, lp_used_this_year):
    monthly_cap = cat_doc['monthly_cap']
    ml_cap = cat_doc['ml_monthly_cap']
    used = sum(cat_doc['monthly_used'].values())
    ml_used = sum(cat_doc['ml_monthly_used'].values())
    now = datetime.now()
    this_month = str(now.month)
    return {
        'category':          cat_doc['category'],
        'monthly_cap':        monthly_cap,
        'used_this_year':     used,
        'annual_quota':       monthly_cap * 12,
        'available_this_year': monthly_cap * 12 - used,
        'used_this_month':    cat_doc['monthly_used'].get(this_month, 0),
        'available_this_month': max(0, monthly_cap - cat_doc['monthly_used'].get(this_month, 0)),
        'ml_monthly_cap':     ml_cap,
        'ml_used_this_year':  ml_used,
        'ml_available_this_year': (ml_cap * 12 - ml_used) if ml_cap else None,
        'ml_used_this_month': cat_doc['ml_monthly_used'].get(this_month, 0),
        'ml_available_this_month': (max(0, ml_cap - cat_doc['ml_monthly_used'].get(this_month, 0)) if ml_cap else None),
        'lp_days_taken':      lp_used_this_year,
        'comp_off_available': cat_doc.get('comp_off_balance', 0),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Employee / Manager — own leave
# ─────────────────────────────────────────────────────────────────────────────

@leaves_bp.route('/my-summary', methods=['GET'])
@tenant_scoped
def my_summary():
    db = get_db()
    u  = g.caller
    emp_ref = u.get('employee_ref')
    if not emp_ref:
        return jsonify({'error': 'No employee record linked to this account'}), 400

    year = int(request.args.get('year', _current_leave_year(db)))
    cat_doc = _get_or_create_category(db, emp_ref, year)
    if not cat_doc:
        return jsonify({'error': 'Employee record not found'}), 404

    lp_used = db.leave_requests.count_documents({
        'employee_id': emp_ref, 'leave_type': 'LP', 'status': 'approved',
        'from_date': {'$regex': f'^{year}'},
    }) + db.leave_requests.count_documents({
        'employee_id': emp_ref, 'lp_days': {'$gt': 0}, 'status': 'approved',
        'from_date': {'$regex': f'^{year}'},
    })

    return jsonify({'year': year, **_this_year_summary(cat_doc, lp_used), 'is_female': cat_doc['category'] == 'female'})


@leaves_bp.route('/my-requests', methods=['GET'])
@tenant_scoped
def my_requests():
    db = get_db()
    u  = g.caller
    emp_ref = u.get('employee_ref', '__none__')
    reqs = list(db.leave_requests.find({'employee_id': emp_ref}).sort('created_at', -1))
    return jsonify([_enrich_request(r, db) for r in reqs])


@leaves_bp.route('/preview', methods=['POST'])
@tenant_scoped
def preview_leave():
    """Live paid/LP split preview, called by the Apply form before submit."""
    db = get_db()
    u  = g.caller
    emp_ref = u.get('employee_ref')
    if not emp_ref:
        return jsonify({'error': 'No employee record linked to this account'}), 400

    data = request.json or {}
    leave_type = (data.get('leave_type') or '').upper().strip()
    from_date, to_date = data.get('from_date'), data.get('to_date')
    custom_types = _get_custom_types(db)
    valid_codes = BUILTIN_LEAVE_TYPES | set(custom_types.keys())
    if leave_type not in valid_codes:
        return jsonify({'error': f'leave_type must be one of {", ".join(sorted(valid_codes))}'}), 400
    if not from_date or not to_date:
        return jsonify({'error': 'from_date and to_date are required'}), 400

    policy = _get_leave_policy(db)
    year = _leave_year(datetime.strptime(from_date, '%Y-%m-%d'), policy['leave_year_start_month'])
    cat_doc = _get_or_create_category(db, emp_ref, year, policy['category_rules'])
    if leave_type in FEMALE_ONLY_TYPES and cat_doc['category'] != 'female':
        return jsonify({'error': f'{leave_type.title()} is only available to female employees'}), 400

    if leave_type == PERMISSION_TYPE:
        permission_mode = (data.get('permission_mode') or 'half_day').strip()
        result = _compute_permission(cat_doc, permission_mode, from_date,
                                      data.get('from_time'), data.get('to_time'))
        if result is None:
            return jsonify({'error': 'Invalid permission time range'}), 400
        paid, lp, breakdown, hours = result
        if permission_mode == 'hourly':
            return jsonify({'days': 0, 'paid_days': 0, 'lp_days': 0, 'permission_hours': hours,
                             'breakdown': [], 'warning': None})
    else:
        paid, lp, breakdown = _compute_split(cat_doc, leave_type, from_date, to_date, custom_types.get(leave_type))

    message = None
    if leave_type != 'LP' and lp > 0:
        if paid == 0:
            message = (f"Your free {leave_type} day(s) for this month are already used. "
                       f"All {lp} day(s) of this request will be recorded as Leave Without Pay.")
        else:
            message = (f"Only {paid} day(s) of this request fall within your free monthly quota. "
                       f"The remaining {lp} day(s) will be recorded as Leave Without Pay.")

    return jsonify({'days': paid + lp, 'paid_days': paid, 'lp_days': lp, 'breakdown': breakdown, 'warning': message})


@leaves_bp.route('/apply', methods=['POST'])
@tenant_scoped
def apply_leave():
    db  = get_db()
    uid = get_jwt_identity()
    u   = g.caller
    emp_ref = u.get('employee_ref')
    if not emp_ref:
        return jsonify({'error': 'No employee record linked to this account'}), 400

    data = request.json or {}
    leave_type = (data.get('leave_type') or '').upper().strip()
    from_date, to_date = data.get('from_date'), data.get('to_date')
    reason = (data.get('reason') or '').strip()
    team_email = (data.get('team_email') or '').strip()
    acknowledge_lp = bool(data.get('acknowledge_lp_split'))
    permission_mode = (data.get('permission_mode') or '').strip() or None
    from_time = data.get('from_time')
    to_time = data.get('to_time')

    custom_types = _get_custom_types(db)
    valid_codes = BUILTIN_LEAVE_TYPES | set(custom_types.keys())
    if leave_type not in valid_codes:
        return jsonify({'error': f'leave_type must be one of {", ".join(sorted(valid_codes))}'}), 400
    if leave_type == PERMISSION_TYPE:
        if not from_date:
            return jsonify({'error': 'from_date is required'}), 400
        to_date = to_date or from_date
        if permission_mode not in ('half_day', 'hourly'):
            return jsonify({'error': "permission_mode must be 'half_day' or 'hourly'"}), 400
        if permission_mode == 'hourly' and (not from_time or not to_time):
            return jsonify({'error': 'from_time and to_time are required for hourly permission'}), 400
    else:
        if not from_date or not to_date:
            return jsonify({'error': 'from_date and to_date are required'}), 400
    if not reason:
        return jsonify({'error': 'Reason for leave is required'}), 400

    policy = _get_leave_policy(db)
    year = _leave_year(datetime.strptime(from_date, '%Y-%m-%d'), policy['leave_year_start_month'])
    cat_doc = _get_or_create_category(db, emp_ref, year, policy['category_rules'])
    if not cat_doc:
        return jsonify({'error': 'Employee record not found'}), 404

    if leave_type in FEMALE_ONLY_TYPES and cat_doc['category'] != 'female':
        return jsonify({'error': f'{leave_type.title()} is only available to female employees'}), 400

    permission_hours = None
    if leave_type == PERMISSION_TYPE:
        result = _compute_permission(cat_doc, permission_mode, from_date, from_time, to_time)
        if result is None:
            return jsonify({'error': 'Invalid permission time range'}), 400
        paid, lp, breakdown, permission_hours = result
    elif leave_type == CO_TYPE:
        paid, lp, breakdown = _compute_split(cat_doc, leave_type, from_date, to_date)
        if cat_doc.get('comp_off_balance', 0) < paid:
            return jsonify({'error': f"Insufficient comp-off balance. You have {cat_doc.get('comp_off_balance', 0)} day(s) available."}), 400
    else:
        paid, lp, breakdown = _compute_split(cat_doc, leave_type, from_date, to_date, custom_types.get(leave_type))

    lp_prone_types = {'CL', 'SL', 'ML', PERMISSION_TYPE} | set(custom_types.keys())
    if leave_type in lp_prone_types and lp > 0 and not acknowledge_lp:
        return jsonify({
            'error': 'lp_confirmation_required',
            'paid_days': paid, 'lp_days': lp,
            'message': 'Part of this request exceeds your free monthly quota and will become Leave Without Pay. '
                       'Resubmit with acknowledge_lp_split=true to confirm.',
        }), 409

    emp = db.employees.find_one({'_id': ObjectId(emp_ref)})
    days_total = 0 if (leave_type == PERMISSION_TYPE and permission_mode == 'hourly') else (paid + lp)

    if u.get('role') == 'manager':
        status, approver_note = 'pending_hr_head', 'Routed to HR Head/Admin (manager has no reporting manager)'
    else:
        manager_id = emp.get('manager_id') if emp else None
        if not manager_id:
            status, approver_note = 'pending_hr_head', 'Routed to HR Head/Admin (no manager assigned)'
        else:
            status, approver_note = 'pending_manager', ''

    doc = {
        'employee_id': emp_ref, 'leave_type': leave_type,
        'from_date': from_date, 'to_date': to_date, 'days': days_total,
        'paid_days': paid, 'lp_days': lp, 'month_breakdown': breakdown,
        'reason': reason, 'team_email': team_email,
        'status': status, 'routing_note': approver_note,
        'created_by': uid, 'created_at': datetime.utcnow(),
        'history': [{'action': 'submitted', 'by': uid, 'timestamp': datetime.utcnow().isoformat()}],
    }
    if leave_type == PERMISSION_TYPE:
        doc['permission_mode'] = permission_mode
        if permission_mode == 'hourly':
            doc['from_time'] = from_time
            doc['to_time'] = to_time
            doc['permission_hours'] = permission_hours
    result = db.leave_requests.insert_one(doc)

    split_note = f" ({paid}d {leave_type} + {lp}d LP)" if (leave_type != 'LP' and lp > 0) else ''
    _notify_hr(
        db,
        f"{emp.get('name', 'An employee') if emp else 'An employee'} applied for "
        f"{leave_type} leave ({from_date} to {to_date}, {days_total} day(s)){split_note}",
        link='/leave-management', related_id=str(result.inserted_id),
    )

    return jsonify({'id': str(result.inserted_id), 'status': status, 'days': days_total,
                    'paid_days': paid, 'lp_days': lp}), 201


@leaves_bp.route('/<rid>/cancel', methods=['POST'])
@tenant_scoped
def cancel_request(rid):
    db  = get_db()
    uid = get_jwt_identity()
    u   = g.caller
    r = db.leave_requests.find_one({'_id': ObjectId(rid)})
    if not r: return jsonify({'error': 'Not found'}), 404
    if r.get('employee_id') != u.get('employee_ref'):
        return jsonify({'error': 'Access denied'}), 403
    if r.get('status') not in ('pending_manager', 'pending_hr_head'):
        return jsonify({'error': 'Only pending requests can be cancelled'}), 400
    db.leave_requests.update_one({'_id': ObjectId(rid)}, {
        '$set': {'status': 'cancelled', 'updated_at': datetime.utcnow()},
        '$push': {'history': {'action': 'cancelled', 'by': uid, 'timestamp': datetime.utcnow().isoformat()}},
    })
    return jsonify({'message': 'Request cancelled'})


# ─────────────────────────────────────────────────────────────────────────────
# Manager — team approvals
# ─────────────────────────────────────────────────────────────────────────────

@leaves_bp.route('/team-pending', methods=['GET'])
@require_role('manager', 'hr_head', 'admin')
def team_pending():
    db = get_db()
    u  = g.caller
    mgr_emp_ref = u.get('employee_ref', '')
    team_ids = [str(e['_id']) for e in db.employees.find({'manager_id': mgr_emp_ref})]
    reqs = list(db.leave_requests.find({'employee_id': {'$in': team_ids}, 'status': 'pending_manager'}).sort('created_at', -1))
    return jsonify([_enrich_request(r, db) for r in reqs])


def _decide_request(db, u, rid, expected_status, allow_roles):
    if u.get('role') not in allow_roles:
        return None, (jsonify({'error': 'Access denied'}), 403)
    r = db.leave_requests.find_one({'_id': ObjectId(rid)})
    if not r:
        return None, (jsonify({'error': 'Not found'}), 404)
    if r.get('status') != expected_status:
        return None, (jsonify({'error': f"Status is '{r.get('status')}', expected {expected_status}"}), 400)
    return r, None


@leaves_bp.route('/<rid>/manager-action', methods=['POST'])
@require_role('manager', 'hr_head', 'admin')
def manager_action(rid):
    db  = get_db()
    uid = get_jwt_identity()
    u   = g.caller

    r, derr = _decide_request(db, u, rid, 'pending_manager', ('manager', 'hr_head', 'admin'))
    if derr: return derr

    if u.get('role') == 'manager':
        mgr_emp_ref = u.get('employee_ref', '')
        emp = db.employees.find_one({'_id': ObjectId(r['employee_id'])})
        if not emp or emp.get('manager_id') != mgr_emp_ref:
            return jsonify({'error': "You can only act on your own team's requests"}), 403
        if r['employee_id'] == mgr_emp_ref:
            return jsonify({'error': 'You cannot act on your own request'}), 403

    data = request.json or {}
    act, remarks = data.get('action'), (data.get('remarks') or '').strip()
    if act not in ('approve', 'reject'):
        return jsonify({'error': "action must be 'approve' or 'reject'"}), 400
    if act == 'reject' and not remarks:
        return jsonify({'error': 'Rejection reason is required'}), 400

    new_status = 'approved' if act == 'approve' else 'rejected'
    if act == 'approve':
        policy = _get_leave_policy(db)
        year = _leave_year(datetime.strptime(r['from_date'], '%Y-%m-%d'), policy['leave_year_start_month'])
        cat_doc = _get_or_create_category(db, r['employee_id'], year, policy['category_rules'])
        _apply_approval_effects(db, cat_doc, r)

    db.leave_requests.update_one({'_id': ObjectId(rid)}, {
        '$set': {'status': new_status, 'updated_at': datetime.utcnow(),
                 'decided_by': uid, 'decided_at': datetime.utcnow().isoformat(), 'decision_remarks': remarks},
        '$push': {'history': {'action': act, 'by': uid, 'remarks': remarks, 'timestamp': datetime.utcnow().isoformat()}},
    })

    emp = db.employees.find_one({'_id': ObjectId(r['employee_id'])})
    _notify_hr(db, f"{emp.get('name', 'An employee') if emp else 'An employee'}'s "
                   f"{r.get('leave_type')} leave request was {new_status} by {u.get('name', 'a manager')}",
               link='/leave-management', related_id=rid)
    return jsonify({'message': f'Request {act}d', 'new_status': new_status})


# ─────────────────────────────────────────────────────────────────────────────
# HR / HR Head / Admin — oversight
# ─────────────────────────────────────────────────────────────────────────────

@leaves_bp.route('/all', methods=['GET'])
@require_role('hr', 'hr_head', 'admin')
def all_requests():
    db = get_db()
    query = {}
    if request.args.get('status'):
        query['status'] = request.args.get('status')
    if request.args.get('employee_id'):
        query['employee_id'] = request.args.get('employee_id')
    reqs = list(db.leave_requests.find(query).sort('created_at', -1))
    return jsonify([_enrich_request(r, db) for r in reqs])


@leaves_bp.route('/<rid>/hr-head-action', methods=['POST'])
@require_role('hr_head', 'admin')
def hr_head_action(rid):
    """HR Head/Admin decide requests routed to them. Plain 'hr' never approves."""
    db  = get_db()
    uid = get_jwt_identity()
    u   = g.caller

    r, derr = _decide_request(db, u, rid, 'pending_hr_head', ('hr_head', 'admin'))
    if derr: return derr

    data = request.json or {}
    act, remarks = data.get('action'), (data.get('remarks') or '').strip()
    if act not in ('approve', 'reject'):
        return jsonify({'error': "action must be 'approve' or 'reject'"}), 400
    if act == 'reject' and not remarks:
        return jsonify({'error': 'Rejection reason is required'}), 400

    new_status = 'approved' if act == 'approve' else 'rejected'
    if act == 'approve':
        policy = _get_leave_policy(db)
        year = _leave_year(datetime.strptime(r['from_date'], '%Y-%m-%d'), policy['leave_year_start_month'])
        cat_doc = _get_or_create_category(db, r['employee_id'], year, policy['category_rules'])
        _apply_approval_effects(db, cat_doc, r)

    db.leave_requests.update_one({'_id': ObjectId(rid)}, {
        '$set': {'status': new_status, 'updated_at': datetime.utcnow(),
                 'decided_by': uid, 'decided_at': datetime.utcnow().isoformat(), 'decision_remarks': remarks},
        '$push': {'history': {'action': act, 'by': uid, 'remarks': remarks, 'timestamp': datetime.utcnow().isoformat()}},
    })
    return jsonify({'message': f'Request {act}d', 'new_status': new_status})


@leaves_bp.route('/balances', methods=['GET'])
@require_role('hr', 'hr_head', 'admin')
def all_balances():
    db = get_db()

    year = int(request.args.get('year', _current_leave_year(db)))
    out = []
    for emp in db.employees.find({'status': {'$ne': 'exited'}}):
        emp_id = str(emp['_id'])
        cat_doc = _get_or_create_category(db, emp_id, year)
        if not cat_doc:
            continue
        s = _this_year_summary(cat_doc, 0)
        out.append({
            'employee_id': emp_id, 'employee_name': emp.get('name', ''),
            'employee_code': emp.get('employee_id', ''), 'department': emp.get('department', ''),
            **s,
        })
    return jsonify(out)


@leaves_bp.route('/balances/<emp_id>/adjust', methods=['POST'])
@require_role('hr', 'hr_head', 'admin')
def adjust_balance(emp_id):
    db = get_db()

    data = request.json or {}
    year = int(data.get('year', _current_leave_year(db)))
    cat_doc = _get_or_create_category(db, emp_id, year)
    if not cat_doc:
        return jsonify({'error': 'Employee not found'}), 404

    update = {'updated_at': datetime.utcnow(), 'manually_set': True}
    if 'category' in data:
        cat = data['category']
        category_rules = _get_leave_policy(db)['category_rules']
        if cat not in category_rules:
            return jsonify({'error': f'category must be one of {list(category_rules)}'}), 400
        update['category'] = cat
        update['monthly_cap'] = category_rules[cat]['monthly_cap']
        update['ml_monthly_cap'] = category_rules[cat]['ml_monthly_cap']
    if 'monthly_cap' in data:
        update['monthly_cap'] = float(data['monthly_cap'])
    if 'ml_monthly_cap' in data:
        update['ml_monthly_cap'] = float(data['ml_monthly_cap'])
    if 'comp_off_balance' in data:
        update['comp_off_balance'] = float(data['comp_off_balance'])

    db.leave_balances.update_one({'_id': cat_doc['_id']}, {'$set': update})

    if 'comp_off_credit' in data:
        # Additive credit (e.g. "add 1 day earned this week") instead of a hard overwrite
        db.leave_balances.update_one({'_id': cat_doc['_id']}, {'$inc': {'comp_off_balance': float(data['comp_off_credit'])}})

    if 'correct_month' in data and 'correct_used' in data:
        month = str(int(data['correct_month']))
        field = 'ml_monthly_used' if data.get('correct_pool') == 'ml' else 'monthly_used'
        db.leave_balances.update_one({'_id': cat_doc['_id']}, {'$set': {f'{field}.{month}': float(data['correct_used'])}})

    updated = db.leave_balances.find_one({'_id': cat_doc['_id']})
    return jsonify(_s(updated))


@leaves_bp.route('/notifications', methods=['GET'])
@require_role('hr', 'hr_head', 'admin')
def notifications():
    db = get_db()
    notes = list(db.leave_notifications.find({'target_role': 'hr'}).sort('created_at', -1).limit(100))
    unread = sum(1 for n in notes if not n.get('read'))
    return jsonify({'notifications': [_s(n) for n in notes], 'unread_count': unread})


@leaves_bp.route('/notifications/mark-read', methods=['POST'])
@require_role('hr', 'hr_head', 'admin')
def mark_notifications_read():
    db = get_db()
    db.leave_notifications.update_many({'target_role': 'hr', 'read': False}, {'$set': {'read': True}})
    return jsonify({'message': 'Marked as read'})


# ─────────────────────────────────────────────────────────────────────────────
# HR — leave policy (fiscal/calendar leave year, category caps) and
# custom leave type management
# ─────────────────────────────────────────────────────────────────────────────

@leaves_bp.route('/policy', methods=['GET'])
@require_role('admin', 'hr', 'hr_head')
def get_policy():
    db = get_db()
    return jsonify(_get_leave_policy(db))


@leaves_bp.route('/policy', methods=['PUT'])
@require_role('admin', 'hr_head')
def update_policy():
    db = get_db()
    data = request.json or {}
    update = {}

    if 'leave_year_start_month' in data:
        try:
            m = int(data['leave_year_start_month'])
        except (TypeError, ValueError):
            return jsonify({'error': 'leave_year_start_month must be an integer 1-12'}), 400
        if not (1 <= m <= 12):
            return jsonify({'error': 'leave_year_start_month must be between 1 and 12'}), 400
        update['leave_policy.leave_year_start_month'] = m

    if 'category_rules' in data:
        rules = data['category_rules']
        if not isinstance(rules, dict):
            return jsonify({'error': 'category_rules must be an object'}), 400
        for cat, vals in rules.items():
            if cat not in DEFAULT_CATEGORY_RULES:
                return jsonify({'error': f"category must be one of {list(DEFAULT_CATEGORY_RULES)}"}), 400
            if not isinstance(vals, dict) or 'monthly_cap' not in vals:
                return jsonify({'error': f"category_rules.{cat} must include monthly_cap"}), 400
            try:
                monthly_cap = float(vals['monthly_cap'])
                ml_monthly_cap = float(vals.get('ml_monthly_cap', 0))
            except (TypeError, ValueError):
                return jsonify({'error': f"category_rules.{cat} caps must be numbers"}), 400
            update[f'leave_policy.category_rules.{cat}'] = {'monthly_cap': monthly_cap, 'ml_monthly_cap': ml_monthly_cap}

    if not update:
        return jsonify({'error': 'Nothing to update'}), 400
    update['updated_at'] = datetime.utcnow()

    # Same bypass as _get_leave_policy — companies aren't tenant-scoped data.
    current_app.db.companies.update_one({'_id': ObjectId(g.tenant_id)}, {'$set': update})
    return jsonify(_get_leave_policy(db))


def _serialize_type(t):
    t['_id'] = str(t['_id'])
    return t


@leaves_bp.route('/types', methods=['GET'])
@tenant_scoped
def list_types():
    """Any authenticated tenant member can list active custom types — the
    apply-leave form needs this to offer them as options. Include inactive
    ones only for HR/admin managing the list."""
    db = get_db()
    is_manager = g.caller.get('role') in ('admin', 'hr', 'hr_head')
    types = list(db.leave_types.find({} if is_manager else {'is_active': True}).sort('created_at', 1))
    return jsonify([_serialize_type(t) for t in types])


@leaves_bp.route('/types', methods=['POST'])
@require_role('admin', 'hr', 'hr_head')
def create_type():
    db = get_db()
    data = request.json or {}
    code = (data.get('code') or '').strip().upper()
    name = (data.get('name') or '').strip()
    if not code or not name:
        return jsonify({'error': 'code and name are required'}), 400
    if not code.replace('_', '').isalnum():
        return jsonify({'error': 'code must be alphanumeric (underscores allowed)'}), 400
    if code in BUILTIN_LEAVE_TYPES:
        return jsonify({'error': f"'{code}' is a built-in leave type code and can't be reused"}), 400
    if db.leave_types.find_one({'code': code}):
        return jsonify({'error': f"A leave type with code '{code}' already exists"}), 400

    monthly_cap = data.get('monthly_cap')
    if monthly_cap is not None:
        try:
            monthly_cap = float(monthly_cap)
        except (TypeError, ValueError):
            return jsonify({'error': 'monthly_cap must be a number or null (uncapped)'}), 400

    now = datetime.utcnow()
    doc = {
        'code': code, 'name': name, 'monthly_cap': monthly_cap,
        'is_active': True, 'created_at': now, 'updated_at': now,
    }
    result = db.leave_types.insert_one(doc)
    doc['_id'] = result.inserted_id
    return jsonify(_serialize_type(doc)), 201


@leaves_bp.route('/types/<type_id>', methods=['PUT'])
@require_role('admin', 'hr', 'hr_head')
def update_type(type_id):
    db = get_db()
    try:
        oid = ObjectId(type_id)
    except InvalidId:
        return jsonify({'error': 'Invalid type id'}), 400

    data = request.json or {}
    update = {}
    if 'name' in data:
        name = (data['name'] or '').strip()
        if not name:
            return jsonify({'error': 'name cannot be empty'}), 400
        update['name'] = name
    if 'monthly_cap' in data:
        cap = data['monthly_cap']
        if cap is not None:
            try:
                cap = float(cap)
            except (TypeError, ValueError):
                return jsonify({'error': 'monthly_cap must be a number or null'}), 400
        update['monthly_cap'] = cap
    if 'is_active' in data:
        update['is_active'] = bool(data['is_active'])
    if not update:
        return jsonify({'error': 'Nothing to update'}), 400
    update['updated_at'] = datetime.utcnow()

    result = db.leave_types.update_one({'_id': oid}, {'$set': update})
    if result.matched_count == 0:
        return jsonify({'error': 'Leave type not found'}), 404
    return jsonify(_serialize_type(db.leave_types.find_one({'_id': oid})))


@leaves_bp.route('/types/<type_id>', methods=['DELETE'])
@require_role('admin', 'hr_head')
def delete_type(type_id):
    db = get_db()
    try:
        oid = ObjectId(type_id)
    except InvalidId:
        return jsonify({'error': 'Invalid type id'}), 400

    t = db.leave_types.find_one({'_id': oid})
    if not t:
        return jsonify({'error': 'Leave type not found'}), 404
    if db.leave_requests.find_one({'leave_type': t['code']}):
        return jsonify({'error': 'This leave type has existing requests — deactivate it instead of deleting'}), 400

    db.leave_types.delete_one({'_id': oid})
    return jsonify({'message': 'Leave type deleted'})    $env:DEVICE_IP="correct-device-ip"
    python sync.py