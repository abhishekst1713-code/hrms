"""
scripts/test_email.py — say exactly why mail is or is not going out.

send_email() deliberately swallows its own failures so a dead mail server
cannot break the request that triggered it. That is right for production and
useless for debugging, because the reason ends up in a log nobody is watching.
This walks the same steps by hand and prints where it stopped.

    python scripts/test_email.py
    python scripts/test_email.py --to someone@example.com
    python scripts/test_email.py --probe          # which SMTP ports are open

It checks whichever transport the environment selects: a provider HTTP API
when one has a key, SMTP otherwise. Run it from the backend directory so it
reads backend/.env.
"""
import argparse
import os
import smtplib
import socket
import ssl
import sys
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))
except ImportError:
    pass

OK, BAD, INFO = '  [ok]  ', '  [FAIL]', '  [--]  '


def explain(e):
    """Turn the raw SMTP failure into the thing to actually go and change.

    Order matters: every smtplib exception inherits from OSError, so the
    protocol-level cases have to be tested before the network ones or they all
    come out as "could not reach the server".
    """
    if isinstance(e, smtplib.SMTPAuthenticationError):
        code = e.smtp_code
        msg = (e.smtp_error or b'').decode(errors='replace')
        if code == 535:
            return ('Gmail rejected the username or password.',
                    ['SMTP_PASS must be a Google APP PASSWORD, not your normal '
                     'account password.',
                     'Generate one at https://myaccount.google.com/apppasswords '
                     '(2-Step Verification has to be on first).',
                     'Paste it with no spaces: 16 letters, e.g. abcdefghijklmnop.',
                     'If you revoked the old app password, the one in .env is dead — '
                     'generate a new one.',
                     f'Server said: {msg.strip()[:120]}'])
        if code == 534:
            return ('Google wants extra verification for this sign-in.',
                    ['Use an app password rather than the account password.',
                     f'Server said: {msg.strip()[:120]}'])
        return (f'Authentication failed ({code}).', [msg.strip()[:160]])
    if isinstance(e, smtplib.SMTPSenderRefused):
        return ('The server refused the From address.',
                ['SMTP_FROM must be the same mailbox as SMTP_USER for Gmail.',
                 f'Server said: {(e.smtp_error or b"").decode(errors="replace")[:120]}'])
    if isinstance(e, smtplib.SMTPRecipientsRefused):
        return ('The server refused the recipient address.',
                ['Check the address you passed to --to.'])
    if isinstance(e, smtplib.SMTPResponseException):
        return (f'The mail server refused the request ({e.smtp_code}).',
                [(e.smtp_error or b'').decode(errors='replace')[:160]])
    if isinstance(e, socket.timeout):
        return ('The connection timed out.',
                ['Port 587 is probably blocked by a firewall, antivirus or your network.',
                 'Try from a different network, or ask IT to allow outbound 587.'])
    if isinstance(e, socket.gaierror):
        return ('The host name could not be resolved.',
                ['Check SMTP_HOST is spelled correctly (smtp.gmail.com for Gmail).'])
    if isinstance(e, OSError) and getattr(e, 'errno', None) in (97, 101, 110, 113):
        return ('The host is not allowed to open an outbound SMTP connection.',
                ['This is what a free Render instance does: ports 25, 465 and 587 '
                 'are blocked, so no SMTP setting can fix it.',
                 'To keep SMTP: use a relay that listens on 2525 (Brevo, SendGrid, '
                 'Mailgun) and set SMTP_PORT=2525. Gmail has no 2525, so Gmail SMTP '
                 'cannot work here.',
                 'Run --probe to see which ports this host can actually reach.',
                 'Or send over HTTPS: set RESEND_API_KEY, BREVO_API_KEY or '
                 'SENDGRID_API_KEY plus EMAIL_FROM.',
                 'See EMAIL_SETUP.md.'])
    if isinstance(e, (ConnectionRefusedError, smtplib.SMTPConnectError, OSError)):
        return ('Could not reach the mail server at all.',
                ['Check SMTP_HOST is spelled correctly (smtp.gmail.com for Gmail).',
                 'Check you are online and that outbound port 587 is not blocked.'])
    return (type(e).__name__, [str(e)[:200]])


PROBE_PORTS = (587, 465, 2525, 25)


def probe(host):
    """Which SMTP ports this host can actually open a socket to.

    Worth running before anything else on a host that may filter egress: a
    free Render instance blocks 25, 465 and 587, and the only way to know
    what is left is to try. Nothing is sent — this is one TCP connect per
    port, closed immediately."""
    print(f'\nProbing outbound SMTP ports to {host}')
    open_ports = []
    for port in PROBE_PORTS:
        try:
            with socket.create_connection((host, port), timeout=8):
                print(f'{OK} {port:<5} open')
                open_ports.append(port)
        except OSError as e:
            reason = f'errno {e.errno} — {e.strerror or e}' if e.errno else str(e)
            print(f'{BAD} {port:<5} {reason}')

    print()
    if not open_ports:
        print('No SMTP port is reachable from here. Either this host blocks '
              'outbound SMTP entirely,')
        print(f'or {host} is wrong. On a free Render instance it is the first '
              'one: use a provider API')
        print('(RESEND_API_KEY / BREVO_API_KEY / SENDGRID_API_KEY over HTTPS), '
              'or upgrade the instance.')
        return 1
    if 2525 in open_ports and not {587, 465} & set(open_ports):
        print('Only 2525 is open, which is the relay port. Keep SMTP and set '
              'SMTP_PORT=2525')
        print('against a relay that listens on it (Brevo, SendGrid, Mailgun). '
              'Gmail does not.')
        return 0
    print(f'Usable: {", ".join(str(p) for p in open_ports)}. Set SMTP_PORT to one of these.')
    return 0


def check_provider(name, args):
    """A provider is one HTTPS call, so there is nothing to walk through:
    either the key and sender are accepted or the body says why not."""
    from services.email_service import from_address, try_send_email

    sender = from_address()
    print(f'\n{OK} Transport          {name} (HTTPS, port 443)')
    print(f'{OK if sender else BAD} EMAIL_FROM         {sender or "(empty)"}')
    if not sender:
        print('\nSet EMAIL_FROM to the address verified with the provider.')
        return 1
    if not args.to:
        print('\nAdd --to your@address.com to send a real test message through it.')
        return 0

    sent, err = try_send_email(args.to, 'Infopace HR — email test',
                               'If you are reading this, the app can send mail.\n',
                               from_label='Infopace HR')
    if not sent:
        print(f'{BAD} {name} rejected the send\n')
        print(f'        - {err}')
        print('\n        - A 401/403 means the API key is wrong or revoked.')
        print('        - A 403 naming the sender means EMAIL_FROM is not verified '
              'with the provider yet.')
        return 1
    print(f'{OK} test message accepted for {args.to}')
    return 0


def main():
    ap = argparse.ArgumentParser(description='Diagnose the email configuration.')
    ap.add_argument('--to', help='send a real test message to this address')
    ap.add_argument('--probe', action='store_true',
                    help='report which outbound SMTP ports this host can reach, and stop')
    args = ap.parse_args()

    if args.probe:
        return probe(os.getenv('SMTP_HOST') or os.getenv('SMTP_SERVER')
                     or 'smtp-relay.brevo.com')

    from services.email_service import transport
    name = transport()
    if name and name != 'smtp':
        return check_provider(name, args)

    host = os.getenv('SMTP_HOST') or os.getenv('SMTP_SERVER', '')
    user = os.getenv('SMTP_USER') or os.getenv('SMTP_EMAIL', '')
    pwd = os.getenv('SMTP_PASS') or os.getenv('SMTP_PASSWORD', '')
    port = int(os.getenv('SMTP_PORT', 587))
    sender = os.getenv('SMTP_FROM') or os.getenv('SMTP_EMAIL', '') or user
    notify = os.getenv('DEMO_NOTIFY_EMAIL', '')

    print('\nSettings read from backend/.env')
    print(f'{OK if host and user else INFO} Transport          '
          f'{"smtp" if host and user else "(none configured)"}')
    print(f'{OK if host else BAD} SMTP_HOST          {host or "(empty)"}')
    print(f'{OK if user else BAD} SMTP_USER          {user or "(empty)"}')
    print(f'{OK if pwd else BAD} SMTP_PASS          '
          f'{"set, " + str(len(pwd)) + " characters" if pwd else "(empty)"}')
    print(f'{OK} SMTP_PORT          {port}')
    print(f'{OK if sender else INFO} SMTP_FROM          {sender or "(empty, will use SMTP_USER)"}')
    print(f'{OK if notify else INFO} DEMO_NOTIFY_EMAIL  {notify or "(empty, team gets no heads-up)"}')

    if not host or not user:
        print('\nNo transport is configured, so the app stores leads and sends nothing.')
        print('Either set RESEND_API_KEY / BREVO_API_KEY / SENDGRID_API_KEY and '
              'EMAIL_FROM (works anywhere, including hosts that block SMTP),')
        print('or fill SMTP_HOST and SMTP_USER in backend/.env. Then run this again.')
        return 1

    if 'gmail' in host and pwd and (' ' in pwd or len(pwd) != 16):
        print(f'\n  NOTE  A Gmail app password is exactly 16 letters with no spaces. '
              f'Yours is {len(pwd)}{" and contains a space" if " " in pwd else ""}.')

    print(f'\nConnecting to {host}:{port}')
    try:
        with smtplib.SMTP(host, port, timeout=15) as s:
            print(f'{OK} connected')
            s.ehlo()
            s.starttls(context=ssl.create_default_context())
            s.ehlo()
            print(f'{OK} STARTTLS negotiated')
            s.login(user, pwd)
            print(f'{OK} signed in as {user}')

            if args.to:
                msg = MIMEMultipart()
                msg['From'] = f'Infopace HR <{sender}>'
                msg['To'] = args.to
                msg['Subject'] = 'Infopace HR — email test'
                msg.attach(MIMEText(
                    'If you are reading this, the Book a demo form can send mail.\n',
                    'plain'))
                s.sendmail(sender, args.to, msg.as_string())
                print(f'{OK} test message accepted for {args.to}')
    except Exception as e:
        headline, steps = explain(e)
        print(f'{BAD} {headline}\n')
        for st in steps:
            print(f'        - {st}')
        print('\nThe Book a demo form will still store leads. Only the emails fail.')
        return 1

    print('\nSMTP is working.')
    if not args.to:
        print('Add --to your@address.com to send yourself a real test message.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
