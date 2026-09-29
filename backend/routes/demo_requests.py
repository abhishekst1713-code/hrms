"""
routes/demo_requests.py — the public "Book a demo" form on the marketing
site.

This is the only unauthenticated write endpoint in the API, so it is
deliberately narrow: one POST, one email field, rate limited, with a
honeypot for bots. Reads are platform-admin only.

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
from services.email_service import send_email, is_configured

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


def _text(value) -> str:
    """This endpoint is public, so the body is whatever anyone posts —
    {"email": 12345} or {"email": [...]} must be a 400, not a 500. Anything
    that is not already a string is treated as absent."""
    return value.strip() if isinstance(value, str) else ''


def _notify_address():
    """Where the internal heads-up goes. Falls back to the send-as address
    so a missing setting means 'tell us at our own mailbox', not silence."""
    return os.getenv('DEMO_NOTIFY_EMAIL') or os.getenv('SMTP_FROM') or os.getenv('SMTP_USER')


def _confirmation_body(email: str) -> str:
    return f"""Thanks for getting in touch.

We have your request for a walkthrough of Infopace HR Automation against
{email}, and someone from the team will reply to arrange a time.

What happens next:

  1. We reply to book a slot that suits you.
  2. We walk you through the product on your own structure: your
     departments, your leave policy, your payroll setup.
  3. If it fits, we set up your tenant, branding and first records with you.

If you did not request this, you can ignore this message. Nothing has been
created and we will not contact you again.

Infopace Management Pvt Ltd
"""


def _notification_body(email: str, source: str, when: datetime) -> str:
    return f"""A new demo request came in from the website.

  Email   : {email}
  Source  : {source or 'landing'}
  Received: {when.strftime('%d %b %Y, %H:%M')} UTC

Reply to the address above to arrange the walkthrough.
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

    source = _text(data.get('source'))[:SOURCE_MAX_LEN] or 'landing'
    now = datetime.utcnow()
    db = current_app.db          # platform-level, not tenant-scoped

    # One row per address. A second submission bumps the counter and the
    # timestamp instead of creating a duplicate lead for sales to dedupe.
    result = db.demo_requests.update_one(
        {'email': email},
        {
            '$set':      {'email': email, 'source': source,
                          'last_requested_at': now, 'updated_at': now},
            '$inc':      {'request_count': 1},
            # status is set once: a repeat enquiry must not reset a lead
            # sales has already moved to 'contacted'.
            '$setOnInsert': {'created_at': now, 'status': 'new'},
        },
        upsert=True,
    )
    is_new = result.upserted_id is not None
    log.info('demo request stored (%s): %s', 'new' if is_new else 'repeat', email)

    # The lead is safe now, so nobody should wait on the mail server. Sending
    # inline made the visitor sit through the full SMTP round trip — seven
    # seconds on a good day, fifteen when the server was refusing us, all of it
    # after the work that mattered was already done. send_email swallows and
    # logs its own failures, so the thread cannot take anything down with it.
    configured = is_configured()
    if configured:
        threading.Thread(target=_send_mail, args=(email, source, now),
                         name=f'demo-mail-{email}', daemon=True).start()
    else:
        log.warning('demo request stored but SMTP is not configured, no mail sent: %s', email)

    # 'queued' rather than 'sent': at this point the request has been handed to
    # a thread and nothing has been delivered yet, so the page promises a
    # confirmation only when there is a mail server to send one.
    return jsonify({'ok': True, 'emailed': {'confirmation': configured,
                                            'notification': configured},
                    'queued': configured}), 201


def _send_mail(email: str, source: str, when: datetime):
    """Runs off the request thread. Failures are logged by send_email."""
    send_email(email, 'Your Infopace HR demo request',
               _confirmation_body(email), from_label='Infopace HR')
    notify_to = _notify_address()
    if notify_to:
        send_email(notify_to, f'Demo request: {email}',
                   _notification_body(email, source, when),
                   from_label='Infopace HR website')
    else:
        log.warning('demo request: no DEMO_NOTIFY_EMAIL or SMTP_FROM set, team not notified')


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
