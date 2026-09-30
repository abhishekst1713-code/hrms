"""
tests/test_diagnostics.py — the endpoint exists to be reachable from a host
with no shell, which makes who can reach it the first thing to pin down.
"""
import sys
import types

import pytest
from flask import Flask

from extensions import limiter
from routes.diagnostics import diagnostics_bp


ENV = ('DIAGNOSTICS_TOKEN', 'RESEND_API_KEY', 'BREVO_API_KEY', 'SENDGRID_API_KEY',
       'EMAIL_FROM', 'EMAIL_PROVIDER', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
       'SMTP_PORT', 'SMTP_FROM', 'VERCEL')


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in ENV:
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def client():
    app = Flask(__name__)
    app.config['TESTING'] = True
    app.config['JWT_SECRET_KEY'] = 'test'
    limiter.init_app(app)
    limiter.enabled = False            # the limits are not what these assert
    app.register_blueprint(diagnostics_bp, url_prefix='/api/diagnostics')
    with app.test_client() as c:
        yield c


def test_no_token_is_refused(client):
    assert client.get('/api/diagnostics/email').status_code == 403


def test_wrong_token_is_refused(client, monkeypatch):
    monkeypatch.setenv('DIAGNOSTICS_TOKEN', 'correct-horse')
    r = client.get('/api/diagnostics/email', headers={'X-Diagnostics-Token': 'guess'})
    assert r.status_code == 403


def test_unset_token_cannot_be_matched_by_an_empty_header(client):
    """An unconfigured DIAGNOSTICS_TOKEN must not mean 'any empty token
    works' — that would leave the endpoint open on every deployment that
    never set it."""
    r = client.get('/api/diagnostics/email', headers={'X-Diagnostics-Token': ''})
    assert r.status_code == 403


def test_report_describes_smtp_without_leaking_the_password(client, monkeypatch):
    """check_connection is stubbed: this asserts what the report says, and
    a test that opens a socket to Gmail would be slow and flaky besides.
    The connection logic itself is covered in test_email_service.py."""
    import routes.diagnostics as diagnostics
    monkeypatch.setattr(diagnostics, 'check_connection',
                        lambda: (False, 'could not reach smtp.gmail.com:587'))
    monkeypatch.setenv('DIAGNOSTICS_TOKEN', 'correct-horse')
    monkeypatch.setenv('SMTP_HOST', 'smtp.gmail.com')
    monkeypatch.setenv('SMTP_USER', 'hr@example.com')
    monkeypatch.setenv('SMTP_PASS', 'abcd efgh ijkl mnop')

    r = client.get('/api/diagnostics/email', headers={'X-Diagnostics-Token': 'correct-horse'})
    assert r.status_code == 200
    body = r.get_json()

    assert body['transport'] == 'smtp'
    assert body['smtp']['host'] == 'smtp.gmail.com'
    assert body['smtp']['pass_set'] is True
    assert body['smtp']['pass_has_space'] is True     # the usual Gmail mistake
    assert 'abcd' not in r.get_data(as_text=True)
    assert 'connection' in body


def test_test_send_rejects_a_bad_address(client, monkeypatch):
    monkeypatch.setenv('DIAGNOSTICS_TOKEN', 'correct-horse')
    r = client.post('/api/diagnostics/email/test', json={'to': 'not-an-address'},
                    headers={'X-Diagnostics-Token': 'correct-horse'})
    assert r.status_code == 400


def test_test_send_reports_the_transport_used(client, monkeypatch):
    monkeypatch.setenv('DIAGNOSTICS_TOKEN', 'correct-horse')
    monkeypatch.setenv('BREVO_API_KEY', 'xkeysib-test')
    monkeypatch.setenv('EMAIL_FROM', 'hr@example.com')

    def fake_post(url, headers=None, json=None, timeout=None):
        return types.SimpleNamespace(status_code=200, text='{"id":"1"}')

    monkeypatch.setitem(sys.modules, 'requests', types.SimpleNamespace(post=fake_post))

    r = client.post('/api/diagnostics/email/test', json={'to': 'you@example.com'},
                    headers={'X-Diagnostics-Token': 'correct-horse'})
    assert r.status_code == 200
    assert r.get_json() == {'sent': True, 'error': None, 'transport': 'brevo'}


def test_failed_send_returns_the_reason(client, monkeypatch):
    monkeypatch.setenv('DIAGNOSTICS_TOKEN', 'correct-horse')
    monkeypatch.setenv('BREVO_API_KEY', 'xkeysib-test')
    monkeypatch.setenv('EMAIL_FROM', 'hr@example.com')

    def fake_post(url, headers=None, json=None, timeout=None):
        return types.SimpleNamespace(status_code=401, text='invalid api key')

    monkeypatch.setitem(sys.modules, 'requests', types.SimpleNamespace(post=fake_post))

    r = client.post('/api/diagnostics/email/test', json={'to': 'you@example.com'},
                    headers={'X-Diagnostics-Token': 'correct-horse'})
    assert r.status_code == 502
    assert 'invalid api key' in r.get_json()['error']
