"""
analytics.py — read-only reporting endpoints. Aggregates existing collections
(employees, payslips, leave_balances) rather than introducing new data models.

Role scoping:
  - admin / hr_head / hr : company-wide, including payroll-cost and leave-liability.
  - manager               : headcount + attrition, scoped to direct reports only.
                             payroll-cost / leave-liability are 403 for managers.
  - employee               : 403 everywhere (no self-service analytics use case here).
"""

from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from datetime import datetime, timedelta
from bson import ObjectId
from collections import defaultdict
import calendar

analytics_bp = Blueprint('analytics', __name__)

HR_ROLES = {'admin', 'hr', 'hr_head'}
ALLOWED_ROLES = HR_ROLES | {'manager'}
EXIT_STATUSES = {'exited', 'inactive'}
NOTICE_STATUSES = {'notice_period', 'clearance_pending', 'clearance_complete'}


def _get_caller(db, uid):
    user = db.users.find_one({'_id': ObjectId(uid)})
    if not user:
        return None, (jsonify({'error': 'User not found'}), 404)
    return user, None


def _parse_date(d_str):
    if not d_str or not isinstance(d_str, str):
        return None
    for fmt in ('%Y-%m-%d', '%d-%m-%Y', '%d/%m/%Y'):
        try:
            return datetime.strptime(d_str.strip(), fmt)
        except ValueError:
            continue
    return None


def _scope_query(db, caller):
    """Returns a Mongo query fragment restricting to the caller's visibility,
    or {} for HR-tier (unrestricted). 403s are handled by the caller."""
    if caller.get('role') in HR_ROLES:
        return {}
    mgr_ref = caller.get('employee_ref', '')
    return {'manager_id': mgr_ref}


def _last_12_months():
    """[(year, month), ...] oldest to newest, ending this month."""
    out = []
    d = datetime.utcnow().replace(day=1)
    for i in range(11, -1, -1):
        m = d.month - i
        y = d.year
        while m <= 0:
            m += 12
            y -= 1
        out.append((y, m))
    return out


TENURE_BANDS = ['<1 yr', '1-3 yrs', '3-5 yrs', '5+ yrs', 'Unknown']


def _tenure_band(join_dt, now):
    if not join_dt:
        return 'Unknown'
    years = (now - join_dt).days / 365.25
    if years < 1:
        return '<1 yr'
    if years < 3:
        return '1-3 yrs'
    if years < 5:
        return '3-5 yrs'
    return '5+ yrs'


@analytics_bp.route('/headcount', methods=['GET'])
@jwt_required()
def headcount():
    db  = current_app.db
    uid = get_jwt_identity()
    caller, err = _get_caller(db, uid)
    if err: return err
    if caller.get('role') not in ALLOWED_ROLES:
        return jsonify({'error': 'Access denied'}), 403

    scope = _scope_query(db, caller)
    employees = list(db.employees.find(scope))

    total = len(employees)
    active = sum(1 for e in employees if e.get('status') == 'active')
    on_notice = sum(1 for e in employees if e.get('status') in NOTICE_STATUSES)
    exited = sum(1 for e in employees if e.get('status') in EXIT_STATUSES)

    by_dept = defaultdict(int)
    for e in employees:
        if e.get('status') not in EXIT_STATUSES:
            by_dept[e.get('department') or 'Unassigned'] += 1

    months = _last_12_months()
    hires_by_month = defaultdict(int)
    exits_by_month = defaultdict(int)
    now = datetime.utcnow()
    tenure_counts = defaultdict(int)
    new_joiners_this_month = 0
    for e in employees:
        joined = _parse_date(e.get('joining_date')) or e.get('created_at')
        if joined:
            hires_by_month[(joined.year, joined.month)] += 1
            if joined.year == now.year and joined.month == now.month:
                new_joiners_this_month += 1
        if e.get('status') in EXIT_STATUSES:
            left = _parse_date(e.get('last_working_day')) or _parse_date(e.get('resignation_date'))
            if left:
                exits_by_month[(left.year, left.month)] += 1
        else:
            tenure_counts[_tenure_band(_parse_date(e.get('joining_date')), now)] += 1

    trend = [{
        'year': y, 'month': m, 'label': f'{calendar.month_abbr[m]} {y}',
        'hires': hires_by_month.get((y, m), 0), 'exits': exits_by_month.get((y, m), 0),
    } for (y, m) in months]

    return jsonify({
        'total': total, 'active': active, 'on_notice': on_notice, 'exited': exited,
        'by_department': [{'department': k, 'count': v} for k, v in sorted(by_dept.items(), key=lambda x: -x[1])],
        'tenure_bands': [{'band': b, 'count': tenure_counts.get(b, 0)} for b in TENURE_BANDS],
        'new_joiners_this_month': new_joiners_this_month,
        'trend': trend,
        'scoped_to_team': caller.get('role') == 'manager',
    })


@analytics_bp.route('/attrition', methods=['GET'])
@jwt_required()
def attrition():
    db  = current_app.db
    uid = get_jwt_identity()
    caller, err = _get_caller(db, uid)
    if err: return err
    if caller.get('role') not in ALLOWED_ROLES:
        return jsonify({'error': 'Access denied'}), 403

    scope = _scope_query(db, caller)
    employees = list(db.employees.find(scope))
    months = _last_12_months()

    exits_by_month = defaultdict(int)
    reason_counts = defaultdict(int)
    for e in employees:
        if e.get('status') in EXIT_STATUSES:
            left = _parse_date(e.get('last_working_day')) or _parse_date(e.get('resignation_date'))
            if left:
                exits_by_month[(left.year, left.month)] += 1
            reason = (e.get('exit_reason') or '').strip() or 'Not specified'
            reason_counts[reason] += 1

    # Approximate "headcount at the time" as current active + not-yet-exited-by-then count.
    current_active = sum(1 for e in employees if e.get('status') not in EXIT_STATUSES)
    trend = []
    for (y, m) in months:
        exits = exits_by_month.get((y, m), 0)
        approx_headcount = max(current_active, 1)
        rate = round((exits / approx_headcount) * 100, 2) if approx_headcount else 0
        trend.append({'year': y, 'month': m, 'label': f'{calendar.month_abbr[m]} {y}', 'exits': exits, 'rate_pct': rate})

    top_reasons = sorted(reason_counts.items(), key=lambda x: -x[1])[:8]

    return jsonify({
        'trend': trend,
        'top_reasons': [{'reason': r, 'count': c} for r, c in top_reasons],
        'scoped_to_team': caller.get('role') == 'manager',
    })


@analytics_bp.route('/payroll-cost', methods=['GET'])
@jwt_required()
def payroll_cost():
    db  = current_app.db
    uid = get_jwt_identity()
    caller, err = _get_caller(db, uid)
    if err: return err
    if caller.get('role') not in HR_ROLES:
        return jsonify({'error': 'Access denied — payroll cost is visible to HR and above only'}), 403

    payslips = list(db.payslips.find({'status': {'$in': ['approved', 'released']}}))
    emp_cache = {}

    def _dept(emp_id):
        if emp_id not in emp_cache:
            emp = db.employees.find_one({'_id': ObjectId(emp_id)}) if emp_id else None
            emp_cache[emp_id] = emp.get('department') or 'Unassigned' if emp else 'Unassigned'
        return emp_cache[emp_id]

    by_month = defaultdict(lambda: {'gross': 0.0, 'net': 0.0})
    by_dept = defaultdict(float)
    for p in payslips:
        key = (p.get('year'), p.get('month'))
        by_month[key]['gross'] += float(p.get('gross_salary') or 0)
        by_month[key]['net'] += float(p.get('net_salary') or 0)
        by_dept[_dept(p.get('employee_id'))] += float(p.get('gross_salary') or 0)

    monthly = [{
        'year': y, 'month': m, 'label': f'{calendar.month_abbr[m]} {y}' if m else str(y),
        'gross': round(v['gross'], 2), 'net': round(v['net'], 2),
    } for (y, m), v in sorted(by_month.items())]

    return jsonify({
        'monthly': monthly,
        'by_department': [{'department': k, 'gross': round(v, 2)} for k, v in sorted(by_dept.items(), key=lambda x: -x[1])],
        'total_gross': round(sum(v['gross'] for v in by_month.values()), 2),
    })


@analytics_bp.route('/leave-liability', methods=['GET'])
@jwt_required()
def leave_liability():
    db  = current_app.db
    uid = get_jwt_identity()
    caller, err = _get_caller(db, uid)
    if err: return err
    if caller.get('role') not in HR_ROLES:
        return jsonify({'error': 'Access denied — leave liability is visible to HR and above only'}), 403

    year = int(request.args.get('year', datetime.utcnow().year))
    balances = list(db.leave_balances.find({'year': year}))
    emp_cache = {}

    def _dept(emp_id):
        if emp_id not in emp_cache:
            emp = db.employees.find_one({'_id': ObjectId(emp_id)}) if emp_id else None
            emp_cache[emp_id] = emp.get('department') or 'Unassigned' if emp else 'Unassigned'
        return emp_cache[emp_id]

    by_dept_lp = defaultdict(float)
    total_lp = 0.0
    total_used = 0.0
    total_cap = 0.0
    for b in balances:
        lp = sum(b.get('lp_monthly', {}).values())
        dept = _dept(b.get('employee_id'))
        by_dept_lp[dept] += lp
        total_lp += lp
        total_used += sum(b.get('monthly_used', {}).values())
        total_cap += (b.get('monthly_cap', 0) or 0) * 12

    utilization_pct = round((total_used / total_cap) * 100, 1) if total_cap else 0

    return jsonify({
        'year': year,
        'total_lp_days': round(total_lp, 1),
        'total_paid_days_used': round(total_used, 1),
        'utilization_pct': utilization_pct,
        'lp_by_department': [{'department': k, 'lp_days': round(v, 1)} for k, v in sorted(by_dept_lp.items(), key=lambda x: -x[1])],
    })


@analytics_bp.route('/upcoming-events', methods=['GET'])
@jwt_required()
def upcoming_events():
    """Birthdays and work anniversaries in the next 30 days — same visibility
    as the emails scheduler.py already sends company-wide, so open to any role."""
    db  = current_app.db
    uid = get_jwt_identity()
    caller, err = _get_caller(db, uid)
    if err: return err

    from scheduler import _ordinal

    today = datetime.utcnow().date()
    window_end = today + timedelta(days=30)
    events = []

    def _next_occurrence(base_dt):
        try:
            occ = base_dt.replace(year=today.year).date()
        except ValueError:
            return None  # Feb 29 on a non-leap current year
        if occ < today:
            try:
                occ = base_dt.replace(year=today.year + 1).date()
            except ValueError:
                return None
        return occ

    users = list(db.users.find({'is_active': {'$ne': False}, 'employee_ref': {'$exists': True, '$ne': ''}}))
    for user in users:
        name = user.get('name', '')
        try:
            emp = db.employees.find_one({'_id': ObjectId(user.get('employee_ref'))})
        except Exception:
            emp = None
        if not emp:
            continue

        bday_str = user.get('birthday') or emp.get('birthday') or emp.get('date_of_birth', '')
        bday_dt = _parse_date(bday_str)
        if bday_dt:
            occ = _next_occurrence(bday_dt)
            if occ and today <= occ <= window_end:
                events.append({
                    'type': 'birthday', 'name': name, 'date': occ.isoformat(),
                    'days_until': (occ - today).days,
                })

        join_dt = _parse_date(emp.get('joining_date', ''))
        if join_dt:
            occ = _next_occurrence(join_dt)
            if occ and today <= occ <= window_end:
                years = occ.year - join_dt.year
                if years >= 1:
                    events.append({
                        'type': 'anniversary', 'name': name, 'date': occ.isoformat(),
                        'days_until': (occ - today).days, 'years': years,
                        'years_label': _ordinal(years),
                    })

    events.sort(key=lambda e: e['days_until'])
    return jsonify(events[:20])
