"""
scheduler.py — Daily birthday and work anniversary email sender
Runs as a background thread started when Flask app boots.
Checks every day at 09:00 AM server time for:
  - Employees whose birthday is today → sends birthday wish
  - Employees whose joining_date anniversary is today → sends work anniversary wish
"""

import threading
import time
import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, date, timedelta

from services.email_service import is_configured, try_send_email

log = logging.getLogger(__name__)

# Bounds how many tenants' daily checks run concurrently — each tenant's
# work is I/O-bound (Mongo queries + mail sends), so a modest thread pool
# lets tenant count grow without the whole run serializing behind one
# slow send, while still isolating failures per tenant (see the
# try/except around each future below).
MAX_CONCURRENT_TENANTS = int(os.getenv('SCHEDULER_MAX_CONCURRENT_TENANTS', 8))


def _send_email(to_email: str, subject: str, body: str):
    """Goes through services.email_service so these reminders use whatever
    transport the deployment has — the provider API where outbound SMTP is
    blocked, SMTP where it is not."""
    company = os.getenv('COMPANY_NAME', 'Infopace Management Pvt Ltd')

    if not is_configured():
        log.warning('Scheduler: email not configured — skipping email to %s', to_email)
        return False

    sent, err = try_send_email(to_email, subject, body, from_label=f'{company} HR')
    if sent:
        log.info('Scheduler: email sent to %s — %s', to_email, subject)
    else:
        log.error('Scheduler: email failed to %s — %s', to_email, err)
    return sent


def _parse_date(d_str: str):
    if not d_str or not isinstance(d_str, str):
        return None
    d_str = d_str.strip()
    for fmt in ('%Y-%m-%d', '%d-%m-%Y', '%d/%m/%Y'):
        try:
            return datetime.strptime(d_str, fmt)
        except ValueError:
            continue
    return None


def _years_completed(join_dt: datetime, today: date) -> int:
    years = today.year - join_dt.year
    if (today.month, today.day) < (join_dt.month, join_dt.day):
        years -= 1
    return years


def _ordinal(n: int) -> str:
    if 11 <= n % 100 <= 13:
        return f'{n}th'
    return f'{n}{["th","st","nd","rd","th","th","th","th","th","th"][n % 10]}'


def _birthday_body(name: str, company: str) -> str:
    return f"""Dear {name},

Wishing you a very Happy Birthday! 🎂

On behalf of everyone at {company}, we hope your special day is filled with joy, laughter, and wonderful memories.

Your dedication and hard work are truly appreciated. We are grateful to have you as part of our team and look forward to celebrating many more milestones together.

Warm wishes,
HR Team
{company}
"""


def _anniversary_body(name: str, years: int, company: str) -> str:
    ordinal = _ordinal(years)
    return f"""Dear {name},

Congratulations on completing your {ordinal} work anniversary at {company}! 🎉

{years} year{'s' if years > 1 else ''} of dedication, growth, and contribution — thank you for being such a valued member of our team.

Your efforts make a real difference every day, and we look forward to many more successful years together.

With appreciation,
HR Team
{company}
"""


def _run_daily_checks_for_tenant(db, company_name, today):
    """db is a TenantScopedDB for one tenant — every query below is
    automatically confined to that tenant's data."""
    from bson import ObjectId

    users = list(db.users.find({
        'is_active': {'$ne': False},
        'employee_ref': {'$exists': True, '$ne': ''},
    }))

    sent_birthday    = 0
    sent_anniversary = 0

    for user in users:
        work_email = user.get('email', '')
        name       = user.get('name', 'Team Member')
        emp_ref    = user.get('employee_ref')

        if not work_email:
            continue

        try:
            emp = db.employees.find_one({'_id': ObjectId(emp_ref)})
        except Exception:
            emp = None

        if not emp:
            continue

        # ── Birthday check ────────────────────────────────────
        # Checks user.birthday → emp.birthday → emp.date_of_birth (set by Step 1 form)
        bday_str = (user.get('birthday')
                    or emp.get('birthday')
                    or emp.get('date_of_birth', ''))
        bday_dt = _parse_date(bday_str)
        if bday_dt and bday_dt.month == today.month and bday_dt.day == today.day:
            sent = _send_email(
                to_email=work_email,
                subject=f'Happy Birthday, {name.split()[0]}! 🎂',
                body=_birthday_body(name, company_name),
            )
            if sent:
                sent_birthday += 1
                db.scheduler_log.insert_one({
                    'type': 'birthday', 'user_id': str(user['_id']),
                    'to_email': work_email, 'name': name,
                    'sent_at': datetime.utcnow(), 'date': today.isoformat(),
                })

        # ── Work anniversary check ────────────────────────────
        join_str = emp.get('joining_date', '')
        join_dt  = _parse_date(join_str)
        if join_dt and join_dt.month == today.month and join_dt.day == today.day:
            years = _years_completed(join_dt, today)
            if years >= 1:
                sent = _send_email(
                    to_email=work_email,
                    subject=f'Happy {_ordinal(years)} Work Anniversary, {name.split()[0]}! 🎉',
                    body=_anniversary_body(name, years, company_name),
                )
                if sent:
                    sent_anniversary += 1
                    db.scheduler_log.insert_one({
                        'type': 'anniversary', 'user_id': str(user['_id']),
                        'to_email': work_email, 'name': name, 'years': years,
                        'sent_at': datetime.utcnow(), 'date': today.isoformat(),
                    })

    return sent_birthday, sent_anniversary


def run_daily_checks(app):
    while True:
        now    = datetime.now()
        target = now.replace(hour=9, minute=0, second=0, microsecond=0)

        if now >= target:
            # Already past 9 AM — schedule for tomorrow using timedelta (safe for month-end)
            target = target + timedelta(days=1)

        wait_seconds = (target - now).total_seconds()
        log.info('Scheduler: next run in %.0f seconds (at %s)', wait_seconds, target)
        time.sleep(wait_seconds)

        today = date.today()
        log.info('Scheduler: running daily checks for %s', today)

        try:
            with app.app_context():
                from tenant_scope import scoped_db_for

                companies = list(app.db.companies.find({'status': {'$ne': 'suspended'}}))
                total_birthday, total_anniversary = 0, 0

                def _run_one(company):
                    tenant_id = str(company['_id'])
                    company_name = (company.get('branding', {}) or {}).get('company_display_name') \
                        or company.get('name', 'Your Company')
                    tdb = scoped_db_for(tenant_id)
                    # Runs inside a worker thread — needs its own app context
                    # for anything touching current_app (get_db()/services),
                    # even though _run_daily_checks_for_tenant here only uses
                    # the already-bound `tdb` and stdlib/email calls.
                    with app.app_context():
                        return tenant_id, _run_daily_checks_for_tenant(tdb, company_name, today)

                with ThreadPoolExecutor(max_workers=MAX_CONCURRENT_TENANTS) as pool:
                    futures = {pool.submit(_run_one, c): c for c in companies}
                    for future in as_completed(futures):
                        company = futures[future]
                        try:
                            tenant_id, (b, a) = future.result()
                            total_birthday    += b
                            total_anniversary += a
                        except Exception as e:
                            log.error('Scheduler: daily check failed for tenant %s — %s', company.get('_id'), e)

                log.info('Scheduler: done — %d birthday, %d anniversary emails sent across %d tenant(s)',
                         total_birthday, total_anniversary, len(companies))

        except Exception as e:
            log.error('Scheduler: daily check failed — %s', e)

        # Safety sleep before recalculating next target
        time.sleep(60)


def run_checks_now(app):
    """Test function — runs the daily check immediately (dry run, no emails
    sent) and returns a summary, across all active tenants."""
    from bson import ObjectId
    from tenant_scope import scoped_db_for

    today = date.today()
    results = []

    with app.app_context():
        companies = list(app.db.companies.find({'status': {'$ne': 'suspended'}}))
        for company in companies:
            tenant_id = str(company['_id'])
            tdb = scoped_db_for(tenant_id)
            users = list(tdb.users.find({
                'is_active': {'$ne': False},
                'employee_ref': {'$exists': True, '$ne': ''},
            }))

            for user in users:
                work_email = user.get('email', '')
                name = user.get('name', '')
                emp_ref = user.get('employee_ref')
                try:
                    emp = tdb.employees.find_one({'_id': ObjectId(emp_ref)})
                except Exception:
                    emp = None
                if not emp:
                    continue

                bday_str = user.get('birthday') or emp.get('birthday') or emp.get('date_of_birth', '')
                bday_dt  = _parse_date(bday_str)
                join_str = emp.get('joining_date', '')
                join_dt  = _parse_date(join_str)

                results.append({
                    'tenant':        company.get('name'),
                    'name':          name,
                    'email':         work_email,
                    'birthday':      bday_str,
                    'bday_match':    bool(bday_dt and bday_dt.month == today.month and bday_dt.day == today.day),
                    'joining_date':  join_str,
                    'anniv_match':   bool(join_dt and join_dt.month == today.month and join_dt.day == today.day),
                })

    return {'today': today.isoformat(), 'checked': len(results), 'employees': results}


def start_scheduler(app):
    t = threading.Thread(target=run_daily_checks, args=(app,), daemon=True)
    t.start()
    log.info('Scheduler: background thread started')