"""
routes/diagnostics.py — answer "why is mail not going out" from a host you
cannot get a shell on.

scripts/test_email.py does this from a terminal, which covers a laptop, a
Docker container and Render's shell tab. A serverless deployment has no
shell at all, so the same checks are exposed over HTTP here: the
configuration as the running instance sees it, a connection test, and an
optional real send.

Access is deliberately narrow. Either a platform-admin JWT, or an
X-Diagnostics-Token header matching DIAGNOSTICS_TOKEN — and when that
variable is unset, the token route does not exist at all, so an
unconfigured deployment cannot be probed. Nothing here returns a password
or an API key.
"""
import hmac
import logging
import os
import re

from flask import Blueprint, jsonify, request

from extensions import limiter
from runtime_env import is_serverless
from services.email_service import check_connection, describe, try_send_email

log = logging.getLogger(__name__)

diagnostics_bp = Blueprint('diagnostics', __name__)

EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$')


def _authorised():
    """A platform-admin token, or the shared diagnostics token. The token is
    compared with compare_digest: this endpoint reports whether credentials
    work, so a timing oracle on the way in would be its own small problem."""
    supplied = request.headers.get('X-Diagnostics-Token', '')
    expected = os.getenv('DIAGNOSTICS_TOKEN', '')
    if expected and supplied and hmac.compare_digest(supplied, expected):
        return True

    # Fall back to a platform-admin JWT, so this stays usable once the
    # token has been rotated out of the environment.
    try:
        from flask_jwt_extended import get_jwt, verify_jwt_in_request
        verify_jwt_in_request()
        return get_jwt().get('scope') == 'platform'
    except Exception:
        return False


@diagnostics_bp.route('/email', methods=['GET'])
@limiter.limit('10 per minute; 60 per hour')
def email_status():
    """What this instance thinks its mail configuration is, plus a live
    connection test. Sends nothing."""
    if not _authorised():
        return jsonify({'error': 'Diagnostics access required'}), 403

    report = describe()
    report['serverless'] = is_serverless()
    ok, detail = check_connection()
    report['connection'] = {'ok': ok, 'detail': detail}
    return jsonify(report)


@diagnostics_bp.route('/email/test', methods=['POST'])
@limiter.limit('5 per minute; 20 per hour')
def email_test():
    """Send one real message and report exactly what happened. Rate limited
    because it is, by design, a send-mail endpoint."""
    if not _authorised():
        return jsonify({'error': 'Diagnostics access required'}), 403

    data = request.get_json(silent=True) or {}
    to = data.get('to') if isinstance(data.get('to'), str) else ''
    to = to.strip()
    if not to or not EMAIL_RE.match(to):
        return jsonify({'error': 'Provide a recipient as {"to": "you@example.com"}'}), 400

    sent, err = try_send_email(
        to, 'Infopace HR — email test',
        'If you are reading this, the deployed app can send mail.\n',
        from_label='Infopace HR')
    log.info('diagnostics test email to %s: %s', to, 'sent' if sent else err)
    return jsonify({'sent': sent, 'error': err or None,
                    'transport': describe()['transport']}), (200 if sent else 502)
