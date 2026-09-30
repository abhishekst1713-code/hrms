"""
tests/test_email_service.py — which transport gets picked, and what each one
puts on the wire.

The bug these cover: on a host that blocks outbound SMTP (a free Render
instance), every send died at connect with "[Errno 101] Network is
unreachable". So the cases that matter are that an API key moves sending to
HTTPS, that SMTP still works where it is allowed, and that a blocked port
produces an error that says so instead of a bare errno.
"""
import smtplib
import sys
import types

import pytest

from services import email_service


EMAIL_ENV = ('RESEND_API_KEY', 'BREVO_API_KEY', 'SENDGRID_API_KEY', 'EMAIL_FROM',
             'EMAIL_PROVIDER', 'SMTP_HOST', 'SMTP_SERVER', 'SMTP_USER', 'SMTP_EMAIL',
             'SMTP_PASS', 'SMTP_PASSWORD', 'SMTP_PORT', 'SMTP_FROM', 'SMTP_TIMEOUT')


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    """A developer's own .env must not decide what these assert."""
    for name in EMAIL_ENV:
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def captured_posts(monkeypatch):
    """Stands in for the provider APIs. _post imports requests lazily, so the
    fake goes into sys.modules rather than onto the module."""
    posts = []

    def fake_post(url, headers=None, json=None, timeout=None):
        posts.append({'url': url, 'headers': headers or {}, 'json': json})
        return types.SimpleNamespace(status_code=200, text='{"id":"1"}')

    monkeypatch.setitem(sys.modules, 'requests', types.SimpleNamespace(post=fake_post))
    return posts


class FakeSMTP:
    """Records the message instead of opening a socket."""
    sent = []
    raises = None

    def __init__(self, host, port, timeout=None):
        if FakeSMTP.raises:
            raise FakeSMTP.raises
        self.host, self.port = host, port

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def ehlo(self): pass
    def starttls(self): pass
    def login(self, user, password): self.user = user

    def sendmail(self, sender, to, body):
        FakeSMTP.sent.append({'host': self.host, 'port': self.port,
                              'from': sender, 'to': to, 'body': body})


@pytest.fixture
def fake_smtp(monkeypatch):
    FakeSMTP.sent = []
    FakeSMTP.raises = None
    monkeypatch.setattr(smtplib, 'SMTP', FakeSMTP)
    monkeypatch.setattr(smtplib, 'SMTP_SSL', FakeSMTP)
    return FakeSMTP


# ── transport selection ───────────────────────────────────────────────────

def test_nothing_configured_is_not_configured():
    assert email_service.transport() == ''
    assert email_service.is_configured() is False


def test_smtp_when_only_smtp_is_set(monkeypatch):
    monkeypatch.setenv('SMTP_HOST', 'smtp.gmail.com')
    monkeypatch.setenv('SMTP_USER', 'hr@example.com')
    assert email_service.transport() == 'smtp'


def test_api_key_wins_over_smtp(monkeypatch):
    """The whole point of the change: where both are configured, mail goes
    over HTTPS, because that is the one that works on the blocked host."""
    monkeypatch.setenv('SMTP_HOST', 'smtp.gmail.com')
    monkeypatch.setenv('SMTP_USER', 'hr@example.com')
    monkeypatch.setenv('BREVO_API_KEY', 'xkeysib-test')
    assert email_service.transport() == 'brevo'


def test_email_provider_forces_smtp(monkeypatch):
    monkeypatch.setenv('SMTP_HOST', 'smtp.gmail.com')
    monkeypatch.setenv('SMTP_USER', 'hr@example.com')
    monkeypatch.setenv('BREVO_API_KEY', 'xkeysib-test')
    monkeypatch.setenv('EMAIL_PROVIDER', 'smtp')
    assert email_service.transport() == 'smtp'


def test_api_key_without_a_sender_is_not_used(monkeypatch):
    """A key with no verified From address cannot send, so it must not be
    chosen silently over a working SMTP setup."""
    monkeypatch.setenv('RESEND_API_KEY', 're_test')
    assert email_service.transport() == ''


def test_from_address_falls_back_to_smtp_settings(monkeypatch):
    monkeypatch.setenv('SMTP_USER', 'hr@example.com')
    assert email_service.from_address() == 'hr@example.com'
    monkeypatch.setenv('SMTP_FROM', 'noreply@example.com')
    assert email_service.from_address() == 'noreply@example.com'
    monkeypatch.setenv('EMAIL_FROM', 'hello@example.com')
    assert email_service.from_address() == 'hello@example.com'


# ── the HTTP providers ────────────────────────────────────────────────────

def test_brevo_send(monkeypatch, captured_posts):
    monkeypatch.setenv('BREVO_API_KEY', 'xkeysib-test')
    monkeypatch.setenv('EMAIL_FROM', 'hr@example.com')

    assert email_service.send_email('you@example.com', 'Subject', 'Body') is True

    post = captured_posts[0]
    assert post['url'] == 'https://api.brevo.com/v3/smtp/email'
    assert post['headers']['api-key'] == 'xkeysib-test'
    assert post['json']['sender'] == {'name': 'HR Team', 'email': 'hr@example.com'}
    assert post['json']['to'] == [{'email': 'you@example.com'}]
    assert post['json']['textContent'] == 'Body'


def test_resend_send_with_attachment(monkeypatch, captured_posts):
    monkeypatch.setenv('RESEND_API_KEY', 're_test')
    monkeypatch.setenv('EMAIL_FROM', 'hr@example.com')

    sent, err = email_service.try_send_email(
        'you@example.com', 'Offer', 'Body', from_label='Infopace HR',
        attachments=[{'filename': 'offer.pdf', 'content': b'%PDF-1.4',
                      'mimetype': 'application/pdf'}])

    assert (sent, err) == (True, '')
    post = captured_posts[0]
    assert post['url'] == 'https://api.resend.com/emails'
    assert post['headers']['Authorization'] == 'Bearer re_test'
    assert post['json']['from'] == 'Infopace HR <hr@example.com>'
    assert post['json']['attachments'][0]['filename'] == 'offer.pdf'
    # base64 of b'%PDF-1.4'
    assert post['json']['attachments'][0]['content'] == 'JVBERi0xLjQ='


def test_sendgrid_send(monkeypatch, captured_posts):
    monkeypatch.setenv('SENDGRID_API_KEY', 'SG.test')
    monkeypatch.setenv('EMAIL_FROM', 'hr@example.com')

    assert email_service.send_email('you@example.com', 'Subject', 'Body') is True

    post = captured_posts[0]
    assert post['url'] == 'https://api.sendgrid.com/v3/mail/send'
    assert post['json']['personalizations'] == [{'to': [{'email': 'you@example.com'}]}]
    assert post['json']['content'][0]['value'] == 'Body'


def test_provider_error_body_is_reported(monkeypatch):
    """A 403 from the provider is nearly always an unverified sender, and
    only the body says so — so the body has to reach the caller."""
    def fake_post(url, headers=None, json=None, timeout=None):
        return types.SimpleNamespace(status_code=403, text='sender not verified')

    monkeypatch.setitem(sys.modules, 'requests', types.SimpleNamespace(post=fake_post))
    monkeypatch.setenv('BREVO_API_KEY', 'xkeysib-test')
    monkeypatch.setenv('EMAIL_FROM', 'hr@example.com')

    sent, err = email_service.try_send_email('you@example.com', 'Subject', 'Body')
    assert sent is False
    assert 'HTTP 403' in err and 'sender not verified' in err


# ── SMTP ──────────────────────────────────────────────────────────────────

def test_smtp_send_carries_the_attachment(monkeypatch, fake_smtp):
    monkeypatch.setenv('SMTP_HOST', 'smtp.example.com')
    monkeypatch.setenv('SMTP_USER', 'hr@example.com')
    monkeypatch.setenv('SMTP_PASS', 'secret')

    assert email_service.send_email(
        'you@example.com', 'Subject', 'Body',
        attachments=[('letter.pdf', b'%PDF-1.4', 'application/pdf')]) is True

    sent = fake_smtp.sent[0]
    assert (sent['host'], sent['port']) == ('smtp.example.com', 587)
    assert sent['to'] == 'you@example.com'
    assert 'filename="letter.pdf"' in sent['body']


def test_port_465_uses_implicit_tls(monkeypatch, fake_smtp):
    """STARTTLS on 465 hangs until the timeout, which reads like a network
    fault and is not one."""
    calls = []
    monkeypatch.setattr(smtplib, 'SMTP', lambda *a, **k: pytest.fail('465 must not use STARTTLS'))
    monkeypatch.setattr(smtplib, 'SMTP_SSL',
                        lambda host, port, timeout=None: calls.append((host, port)) or FakeSMTP(host, port))
    monkeypatch.setenv('SMTP_HOST', 'smtp.example.com')
    monkeypatch.setenv('SMTP_USER', 'hr@example.com')
    monkeypatch.setenv('SMTP_PORT', '465')

    assert email_service.send_email('you@example.com', 'Subject', 'Body') is True
    assert calls == [('smtp.example.com', 465)]


def test_blocked_outbound_smtp_says_what_to_do(monkeypatch, fake_smtp):
    """The production symptom. An errno on its own sent people back to
    re-check SMTP settings that were never the problem."""
    fake_smtp.raises = OSError(101, 'Network is unreachable')
    monkeypatch.setenv('SMTP_HOST', 'smtp.gmail.com')
    monkeypatch.setenv('SMTP_USER', 'hr@example.com')

    sent, err = email_service.try_send_email('you@example.com', 'Subject', 'Body')
    assert sent is False
    assert 'Network is unreachable' in err
    assert 'RESEND_API_KEY' in err and 'HTTPS' in err


def test_auth_failure_names_the_app_password(monkeypatch, fake_smtp):
    fake_smtp.raises = smtplib.SMTPAuthenticationError(535, b'bad credentials')
    monkeypatch.setenv('SMTP_HOST', 'smtp.gmail.com')
    monkeypatch.setenv('SMTP_USER', 'hr@example.com')

    sent, err = email_service.try_send_email('you@example.com', 'Subject', 'Body')
    assert sent is False
    assert 'App Password' in err


def test_unconfigured_send_fails_without_raising():
    sent, err = email_service.try_send_email('you@example.com', 'Subject', 'Body')
    assert sent is False
    assert 'not configured' in err


# ── check_connection ──────────────────────────────────────────────────────

def test_check_connection_signs_in_without_sending(monkeypatch, fake_smtp):
    monkeypatch.setenv('SMTP_HOST', 'smtp.example.com')
    monkeypatch.setenv('SMTP_USER', 'hr@example.com')
    monkeypatch.setenv('SMTP_PASS', 'secret')

    ok, detail = email_service.check_connection()
    assert ok is True
    assert 'smtp.example.com:587' in detail
    assert fake_smtp.sent == []          # a check must not send mail


def test_check_connection_explains_a_gmail_app_password(monkeypatch, fake_smtp):
    fake_smtp.raises = smtplib.SMTPAuthenticationError(535, b'Username and Password not accepted')
    monkeypatch.setenv('SMTP_HOST', 'smtp.gmail.com')
    monkeypatch.setenv('SMTP_USER', 'hr@example.com')
    monkeypatch.setenv('SMTP_PASS', 'not-an-app-password')

    ok, detail = email_service.check_connection()
    assert ok is False
    assert 'App Password' in detail
    assert 'Username and Password not accepted' in detail


def test_check_connection_on_a_blocked_port(monkeypatch, fake_smtp):
    fake_smtp.raises = OSError(101, 'Network is unreachable')
    monkeypatch.setenv('SMTP_HOST', 'smtp.gmail.com')
    monkeypatch.setenv('SMTP_USER', 'hr@example.com')

    ok, detail = email_service.check_connection()
    assert ok is False
    assert 'RESEND_API_KEY' in detail


def test_describe_never_returns_the_password(monkeypatch):
    monkeypatch.setenv('SMTP_HOST', 'smtp.gmail.com')
    monkeypatch.setenv('SMTP_USER', 'hr@example.com')
    monkeypatch.setenv('SMTP_PASS', 'abcdefghijklmnop')

    report = email_service.describe()
    assert 'abcdefghijklmnop' not in repr(report)
    assert report['smtp']['pass_length'] == 16
    assert report['smtp']['pass_has_space'] is False
