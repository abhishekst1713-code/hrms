"""
services/email_service.py — the one place every outbound email goes through.

Two transports, chosen by what is configured:

  * an email provider's HTTP API (Resend, Brevo, SendGrid) over HTTPS, or
  * plain SMTP.

The HTTP path exists because of where this runs. Render blocks outbound
connections on the SMTP ports (25, 465, 587) from free instances, so
smtplib never reaches the mail server at all: it fails at connect with
"[Errno 101] Network is unreachable", which is exactly what the production
logs were full of. No SMTP setting fixes that — the connection is stopped
by the network, not refused by the server. A provider API call is ordinary
HTTPS on port 443, which is open, so mail goes out from the same host that
could not open an SMTP socket.

Set one API key and the provider is used; set none and it falls back to
SMTP, so local development and self-hosted deployments carry on unchanged.
"""
import base64
import logging
import os
import smtplib
from email import encoders
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

log = logging.getLogger(__name__)

# Ports a provider blocks are the ones nothing in this file can work around.
BLOCKED_PORT_HINT = (
    'the host cannot open an outbound SMTP connection (free Render instances '
    'block ports 25, 465 and 587) — either keep SMTP and point SMTP_HOST/'
    'SMTP_PORT at a relay that listens on 2525, or set RESEND_API_KEY, '
    'BREVO_API_KEY or SENDGRID_API_KEY to send over HTTPS. '
    'Run scripts/test_email.py --probe on the host to see which ports are open'
)

HTTP_TIMEOUT = int(os.getenv('EMAIL_HTTP_TIMEOUT', 20))


def _smtp_config():
    return {
        'host': os.getenv('SMTP_HOST') or os.getenv('SMTP_SERVER', ''),
        'user': os.getenv('SMTP_USER') or os.getenv('SMTP_EMAIL', ''),
        'pass': os.getenv('SMTP_PASS') or os.getenv('SMTP_PASSWORD', ''),
        'port': int(os.getenv('SMTP_PORT', 587)),
        'from': os.getenv('SMTP_FROM') or os.getenv('SMTP_EMAIL', ''),
    }


def from_address():
    """The mailbox mail is sent as. EMAIL_FROM is the explicit setting;
    SMTP_FROM/SMTP_USER are read too so an existing deployment can switch
    to an API key without re-entering an address it already has."""
    cfg = _smtp_config()
    return os.getenv('EMAIL_FROM') or cfg['from'] or cfg['user']


def transport():
    """Which transport will be used: 'resend', 'brevo', 'sendgrid', 'smtp'
    or '' when nothing is configured. EMAIL_PROVIDER forces one, which is
    how you keep using SMTP on a host that allows it while an unused API
    key is still in the environment."""
    forced = (os.getenv('EMAIL_PROVIDER') or '').strip().lower()
    if forced:
        return forced

    for name, key in (('resend', 'RESEND_API_KEY'),
                      ('brevo', 'BREVO_API_KEY'),
                      ('sendgrid', 'SENDGRID_API_KEY')):
        if os.getenv(key) and from_address():
            return name

    cfg = _smtp_config()
    return 'smtp' if cfg['host'] and cfg['user'] else ''


def is_configured():
    return bool(transport())


def _attachment_parts(attachments):
    """Normalise what callers pass into (filename, mimetype, bytes).

    Accepts dicts ({'filename', 'content', 'mimetype'}) or plain
    (filename, content) / (filename, content, mimetype) tuples, because the
    call sites that predate this file each grew their own shape."""
    parts = []
    for a in attachments or []:
        if isinstance(a, dict):
            filename = a.get('filename') or 'attachment'
            content = a.get('content') or b''
            mimetype = a.get('mimetype') or 'application/octet-stream'
        else:
            filename, content = a[0], a[1]
            mimetype = a[2] if len(a) > 2 else 'application/octet-stream'
        if isinstance(content, str):
            content = content.encode()
        parts.append((filename, mimetype, content))
    return parts


# ── HTTP providers ────────────────────────────────────────────────────────
# Each returns nothing on success and raises on failure; the caller turns
# that into the (sent, error) pair.

def _post(url, headers, payload):
    import requests          # imported here so SMTP-only installs stay light

    r = requests.post(url, headers=headers, json=payload, timeout=HTTP_TIMEOUT)
    if r.status_code >= 300:
        # The provider says why in the body (unverified sender, bad key,
        # domain not set up); the status code alone never does.
        raise RuntimeError(f'HTTP {r.status_code}: {r.text[:500]}')


def _send_resend(sender, to_email, subject, body_text, attachments):
    payload = {'from': sender, 'to': [to_email], 'subject': subject, 'text': body_text}
    if attachments:
        payload['attachments'] = [
            {'filename': f, 'content': base64.b64encode(c).decode()}
            for f, _m, c in attachments
        ]
    _post('https://api.resend.com/emails',
          {'Authorization': f'Bearer {os.environ["RESEND_API_KEY"]}'}, payload)


def _send_brevo(sender_name, sender_email, to_email, subject, body_text, attachments):
    payload = {
        'sender': {'name': sender_name, 'email': sender_email},
        'to': [{'email': to_email}],
        'subject': subject,
        'textContent': body_text,
    }
    if attachments:
        payload['attachment'] = [
            {'name': f, 'content': base64.b64encode(c).decode()}
            for f, _m, c in attachments
        ]
    _post('https://api.brevo.com/v3/smtp/email',
          {'api-key': os.environ['BREVO_API_KEY']}, payload)


def _send_sendgrid(sender_name, sender_email, to_email, subject, body_text, attachments):
    payload = {
        'personalizations': [{'to': [{'email': to_email}]}],
        'from': {'email': sender_email, 'name': sender_name},
        'subject': subject,
        'content': [{'type': 'text/plain', 'value': body_text}],
    }
    if attachments:
        payload['attachments'] = [
            {'filename': f, 'type': m, 'disposition': 'attachment',
             'content': base64.b64encode(c).decode()}
            for f, m, c in attachments
        ]
    _post('https://api.sendgrid.com/v3/mail/send',
          {'Authorization': f'Bearer {os.environ["SENDGRID_API_KEY"]}'}, payload)


def _send_smtp(sender, to_email, subject, body_text, attachments):
    cfg = _smtp_config()
    msg = MIMEMultipart()
    msg['From'] = sender
    msg['To'] = to_email
    msg['Subject'] = subject
    msg.attach(MIMEText(body_text, 'plain'))
    for filename, mimetype, content in attachments:
        maintype, _, subtype = mimetype.partition('/')
        part = MIMEBase(maintype or 'application', subtype or 'octet-stream')
        part.set_payload(content)
        encoders.encode_base64(part)
        part.add_header('Content-Disposition', f'attachment; filename="{filename}"')
        msg.attach(part)

    timeout = int(os.getenv('SMTP_TIMEOUT', 20))
    sender_addr = cfg['from'] or cfg['user']
    # 465 is implicit TLS: STARTTLS on it hangs until the timeout instead of
    # failing, which reads like a network problem and is not one.
    if cfg['port'] == 465:
        with smtplib.SMTP_SSL(cfg['host'], cfg['port'], timeout=timeout) as s:
            s.login(cfg['user'], cfg['pass'])
            s.sendmail(sender_addr, to_email, msg.as_string())
    else:
        with smtplib.SMTP(cfg['host'], cfg['port'], timeout=timeout) as s:
            s.ehlo(); s.starttls(); s.ehlo()
            s.login(cfg['user'], cfg['pass'])
            s.sendmail(sender_addr, to_email, msg.as_string())


def try_send_email(to_email, subject, body_text, from_label='HR Team', attachments=None):
    """Send, and say why not. Returns (sent, error) with error '' on success.

    Use this where the caller shows the reason to someone — an HR user
    clicking "email this letter" needs the reason on screen, not in a log.
    Everything else can use send_email() and ignore it."""
    name = transport()
    if not name:
        return False, ('email is not configured: set RESEND_API_KEY, BREVO_API_KEY '
                       'or SENDGRID_API_KEY (with EMAIL_FROM), or SMTP_HOST/SMTP_USER')

    sender_email = from_address()
    if name != 'smtp' and not sender_email:
        return False, 'EMAIL_FROM (or SMTP_FROM) must be set to the verified sender address'

    parts = _attachment_parts(attachments)
    sender = f'{from_label} <{sender_email}>' if sender_email else from_label

    try:
        if name == 'resend':
            _send_resend(sender, to_email, subject, body_text, parts)
        elif name == 'brevo':
            _send_brevo(from_label, sender_email, to_email, subject, body_text, parts)
        elif name == 'sendgrid':
            _send_sendgrid(from_label, sender_email, to_email, subject, body_text, parts)
        elif name == 'smtp':
            _send_smtp(sender, to_email, subject, body_text, parts)
        else:
            return False, f'unknown EMAIL_PROVIDER "{name}"'
    except smtplib.SMTPAuthenticationError:
        return False, ('SMTP authentication failed — for Gmail, SMTP_PASS must be an '
                       'App Password, not the account password')
    except OSError as e:
        # ENETUNREACH (101) / ETIMEDOUT (110) on connect is the blocked-port
        # case, and it is worth naming: the settings all look right, so
        # without this line the next person re-checks them for an hour.
        errno = getattr(e, 'errno', None)
        # 101 ENETUNREACH / 110 ETIMEDOUT / 113 EHOSTUNREACH / 97 EAFNOSUPPORT:
        # socket.create_connection already tried every address the host
        # resolved to, so this is the egress being closed, not one bad route.
        if name == 'smtp' and errno in (97, 101, 110, 113):
            return False, f'{e} — {BLOCKED_PORT_HINT}'
        return False, str(e)
    except Exception as e:
        return False, str(e)

    log.info('Email sent via %s: %s -> %s', name, subject, to_email)
    return True, ''


def send_email(to_email, subject, body_text, from_label='HR Team', attachments=None):
    """Returns True if sent, False if email isn't configured or the send
    failed (logged, never raised — a missing invite email shouldn't 500 the
    request that triggered it; the token/link is still valid and can be
    resent)."""
    sent, err = try_send_email(to_email, subject, body_text, from_label, attachments)
    if not sent:
        log.warning('Email send failed: %s -> %s (%s)', subject, to_email, err)
    return sent


def describe():
    """A safe summary of the mail configuration, for a diagnostics endpoint.

    Never returns a password or a full API key — only whether each is set
    and how long it is, which is what tells you a Gmail app password has
    been pasted with its spaces still in."""
    cfg = _smtp_config()
    name = transport()
    keys = {k: bool(os.getenv(k)) for k in
            ('RESEND_API_KEY', 'BREVO_API_KEY', 'SENDGRID_API_KEY')}
    return {
        'transport': name or None,
        'configured': bool(name),
        'from_address': from_address() or None,
        'provider_keys_set': keys,
        'smtp': {
            'host': cfg['host'] or None,
            'port': cfg['port'],
            'user': cfg['user'] or None,
            'pass_set': bool(cfg['pass']),
            'pass_length': len(cfg['pass']),
            'pass_has_space': ' ' in cfg['pass'],
        },
    }


def check_connection():
    """Connect, negotiate TLS and sign in — without sending anything.

    Separating this from a send is what makes a failure readable: a refused
    connection, a rejected password and a rejected recipient are three
    different problems that all surface as "it didn't work"."""
    name = transport()
    if not name:
        return False, 'no transport configured'
    if name != 'smtp':
        # An HTTP provider has no session to open; the key is only checked
        # when a message is actually posted.
        return True, f'{name} sends over HTTPS — nothing to connect to; send a test message to verify the key'

    cfg = _smtp_config()
    timeout = int(os.getenv('SMTP_TIMEOUT', 20))
    try:
        if cfg['port'] == 465:
            with smtplib.SMTP_SSL(cfg['host'], cfg['port'], timeout=timeout) as s:
                s.login(cfg['user'], cfg['pass'])
        else:
            with smtplib.SMTP(cfg['host'], cfg['port'], timeout=timeout) as s:
                s.ehlo(); s.starttls(); s.ehlo()
                s.login(cfg['user'], cfg['pass'])
    except smtplib.SMTPAuthenticationError as e:
        code = e.smtp_code
        detail = (e.smtp_error or b'').decode(errors='replace').strip()[:200]
        if code == 535:
            return False, (f'{cfg["host"]} rejected the credentials (535). For Gmail, SMTP_PASS '
                           f'must be a 16-character App Password with no spaces. Server said: {detail}')
        return False, f'authentication failed ({code}): {detail}'
    except OSError as e:
        errno = getattr(e, 'errno', None)
        if errno in (97, 101, 110, 113):
            return False, f'{e} — {BLOCKED_PORT_HINT}'
        return False, f'could not reach {cfg["host"]}:{cfg["port"]} — {e}'
    except Exception as e:
        return False, str(e)

    return True, f'connected to {cfg["host"]}:{cfg["port"]} and signed in as {cfg["user"]}'


def send_invite_email(to_email, name, company_name, accept_url):
    subject = f'You’ve been invited to {company_name}'
    body = f"""Hi {name},

You've been added to {company_name}'s HR portal. Set your password to activate your account:

{accept_url}

This link expires in 48 hours. If you weren't expecting this, you can ignore this email.

Regards,
{company_name} HR Team
"""
    return send_email(to_email, subject, body, from_label=f'{company_name} HR Team')


def send_password_reset_email(to_email, name, company_name, reset_url):
    subject = f'Reset your {company_name} password'
    body = f"""Hi {name},

We received a request to reset your password. Click the link below to choose a new one:

{reset_url}

This link expires in 48 hours. If you didn't request this, you can ignore this email — your password won't change.

Regards,
{company_name} HR Team
"""
    return send_email(to_email, subject, body, from_label=f'{company_name} HR Team')
