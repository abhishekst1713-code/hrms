"""
routes/demo_requests.py — the public "Book a demo" form on the marketing
site.

This is the only unauthenticated write endpoint in the API, so it is
deliberately narrow: one POST with name, phone, company and email, rate
limited, with a honeypot for bots. Reads are platform-admin only.

Leads are NOT tenant data — a visitor has no tenant yet — so this uses
the raw `current_app.db` rather than tenant_scope.get_db(), the same way
plans and platform_admins do. Going through get_db() would inject a
tenant_id that does not exist for a lead.
"""
import logging
import os
import re
import threading
from datetime import datetime

from flask import Blueprint, current_app, jsonify, request

from auth_utils import platform_admin_required
from extensions import limiter
from runtime_env import background_work_survives_response
from services.email_service import from_address, is_configured, send_email

log = logging.getLogger(__name__)

demo_requests_bp = Blueprint('demo_requests', __name__)

# Deliberately permissive: the aim is to reject obvious typos, not to
# re-implement RFC 5322. Anything that gets past this is still only ever
# used as an email address.
EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$')

# A dot may not lead, trail or double up in the local part (RFC 5322 for an
# unquoted local part), and no mailbox begins "www." — that one is always the
# browser address bar bleeding into the form, and it produces a lead nobody can
# reach. A real submission of "www.someone@gmail.com" is what prompted this.
LOCAL_TYPO_RE = re.compile(r'^\.|\.$|\.\.|^www\.', re.I)

MAX_EMAIL_LEN = 254        # RFC limit, also caps the stored value
SOURCE_MAX_LEN = 60
NAME_MAX_LEN = 120
COMPANY_MAX_LEN = 160

# Digits with the usual separators and an optional leading +. The digit
# count is checked separately: 7 to 15, the E.164 ceiling.
PHONE_RE = re.compile(r'^\+?[\d\s()\-.]+$')


def _text(value) -> str:
    """This endpoint is public, so the body is whatever anyone posts —
    {"email": 12345} or {"email": [...]} must be a 400, not a 500. Anything
    that is not already a string is treated as absent."""
    return value.strip() if isinstance(value, str) else ''


def _notify_address():
    """Where the internal heads-up goes. Falls back to the send-as address
    so a missing setting means 'tell us at our own mailbox', not silence."""
    return os.getenv('DEMO_NOTIFY_EMAIL') or from_address()


def _confirmation_body(email: str) -> str:
    return f"""Hi there,

Thank you for your interest in Infopace HR Automation.

We've received your request for a product walkthrough at {email}, and
someone from our team will reach out shortly to find a time that works
for you.

What happens next:

  1. We'll get in touch to book a slot that suits your schedule.
  2. We'll walk you through the product using your own structure —
     your departments, leave policies, and payroll setup — so you can
     see exactly how it would work for your team.
  3. If it's a good fit, we'll help you set up your account, branding,
     and first records together.

If you didn't submit this request, you can simply ignore this email —
no account has been created and we won't be in touch again.

Looking forward to showing you around.

Warm regards,
Team Infopace
Infopace Management Pvt Ltd
"""


def _notification_body(email: str, source: str, when: datetime,
                       name: str = '', phone: str = '', company: str = '') -> str:
    return f"""New demo request received from the website.

  Name       : {name}
  Company    : {company}
  Phone      : {phone}
  Email      : {email}
  Source     : {source or 'landing'}
  Received   : {when.strftime('%d %b %Y, %H:%M')} UTC

Please reach out to the address above to schedule the walkthrough.
"""


@demo_requests_bp.route('', methods=['POST'])
@demo_requests_bp.route('/', methods=['POST'])
@limiter.limit('5 per minute; 30 per hour')
def create_demo_request():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        data = {}

    # Honeypot: a field hidden from people and filled in by naive bots.
    # Answer 200 so the bot has nothing to learn from the response.
    if _text(data.get('company_website')):
        log.info('demo request rejected: honeypot filled')
        return jsonify({'ok': True}), 200

    email = _text(data.get('email')).lower()
    if not email or len(email) > MAX_EMAIL_LEN or not EMAIL_RE.match(email):
        return jsonify({'error': 'Enter a valid email address.'}), 400

    local = email.split('@', 1)[0]
    if LOCAL_TYPO_RE.search(local):
        log.info('demo request rejected: malformed local part (%s)', email)
        return jsonify({'error': 'That address does not look right. '
                                 'Check for a stray "www." or a misplaced dot.'}), 400

    name = ' '.join(_text(data.get('name')).split())
    if not name:
        return jsonify({'error': 'Enter your name.'}), 400
    if len(name) > NAME_MAX_LEN:
        return jsonify({'error': 'That name is too long.'}), 400

    phone = _text(data.get('phone'))
    phone_digits = re.sub(r'\D', '', phone)
    if not phone or not PHONE_RE.match(phone) or not 7 <= len(phone_digits) <= 15:
        return jsonify({'error': 'Enter a valid phone number.'}), 400

    # 'company_name', not 'company': 'company_website' is the honeypot and
    # the two must not be confused.
    company = ' '.join(_text(data.get('company_name')).split())
    if not company:
        return jsonify({'error': 'Enter your company name.'}), 400
    if len(company) > COMPANY_MAX_LEN:
        return jsonify({'error': 'That company name is too long.'}), 400

    source = _text(data.get('source'))[:SOURCE_MAX_LEN] or 'landing'
    now = datetime.utcnow()
    db = current_app.db          # platform-level, not tenant-scoped

    # One row per address. A second submission bumps the counter and the
    # timestamp instead of creating a duplicate lead for sales to dedupe.
    result = db.demo_requests.update_one(
        {'email': email},
        {
            # contact details follow the latest submission; mail_triggered
            # resets to False here because a fresh send is about to be
            # attempted (or skipped, if email isn't configured) — it only
            # flips to True once _send_mail confirms delivery below.
            '$set':      {'email': email, 'name': name, 'phone': phone,
                          'company_name': company, 'source': source,
                          'last_requested_at': now, 'updated_at': now,
                          'mail_triggered': False},
            '$inc':      {'request_count': 1},
            # status is set once: a repeat enquiry must not reset a lead
            # sales has already moved to 'contacted'.
            '$setOnInsert': {'created_at': now, 'status': 'new'},
        },
        upsert=True,
    )
    is_new = result.upserted_id is not None
    log.info('demo request stored (%s): %s', 'new' if is_new else 'repeat', email)

    # The lead is safe now, so nobody should wait on the mail server: send on
    # a thread where the host keeps threads alive after the response, inline
    # on a serverless host that freezes them. send_email swallows and logs
    # its own failures, so neither path can take the request down with it.
    configured = is_configured()
    if configured and background_work_survives_response():
        threading.Thread(target=_send_mail,
                         args=(db, email, source, now, name, phone, company),
                         name=f'demo-mail-{email}', daemon=True).start()
    elif configured:
        _send_mail(db, email, source, now, name, phone, company)
    else:
        log.warning('demo request stored but email is not configured, no mail sent: %s', email)

    return jsonify({'ok': True, 'emailed': {'confirmation': configured,
                                            'notification': configured},
                    'queued': configured}), 201


def _send_mail(db, email: str, source: str, when: datetime,
               name: str = '', phone: str = '', company: str = ''):
    """Runs off the request thread (or inline on a serverless host).
    Failures are logged by send_email.

    mail_triggered reflects only the confirmation email to the lead
    (the one the visitor is actually waiting on) — True once send_email
    confirms it went out, False if it wasn't sent or raised/failed.
    """
    sent = send_email(email, 'Your Infopace HR demo request',
                      _confirmation_body(email), from_label='Infopace HR')
    try:
        db.demo_requests.update_one({'email': email}, {'$set': {'mail_triggered': sent}})
    except Exception:
        log.exception('demo request: could not update mail_triggered for %s', email)

    notify_to = _notify_address()
    if notify_to:
        send_email(notify_to, f'Demo request: {email}',
                   _notification_body(email, source, when, name, phone, company),
                   from_label='Infopace HR website')
    else:
        log.warning('demo request: no DEMO_NOTIFY_EMAIL or send-as address set, team not notified')


@demo_requests_bp.route('', methods=['GET'])
@demo_requests_bp.route('/', methods=['GET'])
@platform_admin_required
def list_demo_requests():
    """Platform admins only. Leads are not tenant data, so no tenant
    admin should be able to read another company's enquiries."""
    db = current_app.db
    rows = list(db.demo_requests.find({}).sort('last_requested_at', -1).limit(500))
    for r in rows:
        r['_id'] = str(r['_id'])
    return jsonify({'demo_requests': rows, 'count': len(rows)})
