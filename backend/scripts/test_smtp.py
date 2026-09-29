"""
scripts/test_smtp.py — say exactly why mail is or is not going out.

send_email() deliberately swallows its own failures so a dead mail server
cannot break the request that triggered it. That is right for production and
useless for debugging, because the reason ends up in a log nobody is watching.
This walks the same steps by hand and prints where it stopped.

    python scripts/test_smtp.py
    python scripts/test_smtp.py --to someone@example.com

Run it from the backend directory so it reads backend/.env.
"""
import argparse
import os
import smtplib
import socket
import ssl
import sys
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

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
    if isinstance(e, (ConnectionRefusedError, smtplib.SMTPConnectError, OSError)):
        return ('Could not reach the mail server at all.',
                ['Check SMTP_HOST is spelled correctly (smtp.gmail.com for Gmail).',
                 'Check you are online and that outbound port 587 is not blocked.'])
    return (type(e).__name__, [str(e)[:200]])


def main():
    ap = argparse.ArgumentParser(description='Diagnose the SMTP configuration.')
    ap.add_argument('--to', help='send a real test message to this address')
    args = ap.parse_args()

    host = os.getenv('SMTP_HOST') or os.getenv('SMTP_SERVER', '')
    user = os.getenv('SMTP_USER') or os.getenv('SMTP_EMAIL', '')
    pwd = os.getenv('SMTP_PASS') or os.getenv('SMTP_PASSWORD', '')
    port = int(os.getenv('SMTP_PORT', 587))
    sender = os.getenv('SMTP_FROM') or os.getenv('SMTP_EMAIL', '') or user
    notify = os.getenv('DEMO_NOTIFY_EMAIL', '')

    print('\nSettings read from backend/.env')
    print(f'{OK if host else BAD} SMTP_HOST          {host or "(empty)"}')
    print(f'{OK if user else BAD} SMTP_USER          {user or "(empty)"}')
    print(f'{OK if pwd else BAD} SMTP_PASS          '
          f'{"set, " + str(len(pwd)) + " characters" if pwd else "(empty)"}')
    print(f'{OK} SMTP_PORT          {port}')
    print(f'{OK if sender else INFO} SMTP_FROM          {sender or "(empty, will use SMTP_USER)"}')
    print(f'{OK if notify else INFO} DEMO_NOTIFY_EMAIL  {notify or "(empty, team gets no heads-up)"}')

    if not host or not user:
        print('\nSMTP is not configured, so the app stores leads and sends nothing.')
        print('Fill SMTP_HOST and SMTP_USER in backend/.env, then run this again.')
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
                msg['Subject'] = 'Infopace HR — SMTP test'
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
