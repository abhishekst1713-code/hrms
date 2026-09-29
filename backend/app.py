from flask import Flask, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from pymongo import MongoClient
from datetime import timedelta
import os
import sys

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))


from observability import configure_logging, init_sentry, register_request_hooks
configure_logging()

app = Flask(__name__)
app.url_map.strict_slashes = False
init_sentry(app)
register_request_hooks(app)

# Multi-tenant SaaS: each customer org's frontend runs on its own origin, so
# CORS must be an explicit allow-list, not '*' — a wildcard would let any
# website read another tenant's API responses via the browser. Set
# ALLOWED_ORIGINS in .env as a comma-separated list, e.g.
#   ALLOWED_ORIGINS=https://app.example.com,http://localhost:3000
_allowed_origins_env = os.getenv('ALLOWED_ORIGINS', '')
ALLOWED_ORIGINS = [o.strip() for o in _allowed_origins_env.split(',') if o.strip()]
if not ALLOWED_ORIGINS:
    # Local dev default only — production deployments must set ALLOWED_ORIGINS.
    # 3000 is the in-app React frontend; 5173/4173 are the marketing site's
    # Vite dev and preview servers, which POST to /api/demo-requests.
    ALLOWED_ORIGINS = ['http://localhost:3000',
                       'http://localhost:5173',
                       'http://localhost:4173']
    if os.getenv('FLASK_ENV') == 'production':
        print('[app.py] FATAL: ALLOWED_ORIGINS must be set in production (comma-separated origins).', flush=True)
        sys.exit(1)

CORS(app,
     resources={r"/api/*": {"origins": ALLOWED_ORIGINS}},
     allow_headers=["Content-Type", "Authorization"],
     methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
     supports_credentials=True)

_jwt_secret = os.getenv('JWT_SECRET_KEY')
if not _jwt_secret:
    if os.getenv('FLASK_ENV') == 'production':
        print('[app.py] FATAL: JWT_SECRET_KEY must be set in production — refusing to start '
              'with an insecure default secret.', flush=True)
        sys.exit(1)
    print('[app.py] WARNING: JWT_SECRET_KEY not set — using an insecure dev-only default. '
          'Set JWT_SECRET_KEY in backend/.env before deploying.', flush=True)
    _jwt_secret = 'dev-secret-change-in-prod'

app.config['JWT_SECRET_KEY']            = _jwt_secret
app.config['JWT_ACCESS_TOKEN_EXPIRES']  = timedelta(hours=8)
app.config['STORAGE_ROOT']              = os.path.join(os.getcwd(), 'storage')
app.config['UPLOAD_FOLDER']             = os.path.join(os.getcwd(), 'storage')
app.config['MONGO_URI']                 = os.getenv('MONGO_URI', 'mongodb://localhost:27017/hr_offer_letters')

for d in ['templates', 'letters', 'documents', 'previews']:
    os.makedirs(os.path.join(app.config['STORAGE_ROOT'], d), exist_ok=True)

jwt    = JWTManager(app)
client = MongoClient(app.config['MONGO_URI'])
app.db = client.hr_offer_letters

from extensions import limiter
limiter.init_app(app)

from routes.auth               import auth_bp
from routes.employees          import employees_bp
from routes.templates          import templates_bp
from routes.letters            import letters_bp
from routes.approvals          import approvals_bp
from routes.exit               import exit_bp
from routes.appointment_orders import appointment_orders_bp
from routes.documents          import documents_bp
from routes.leaves             import leaves_bp
from routes.attendance         import attendance_bp
from routes.payslips           import payslips_bp
from routes.platform           import platform_bp
from routes.demo_requests      import demo_requests_bp
from routes.assets             import assets_bp
from routes.support            import support_bp
from routes.roles              import roles_bp
from routes.workflows          import workflows_bp
from routes.audit              import audit_bp
from routes.payroll_config     import payroll_config_bp
from routes.payroll_runs       import payroll_runs_bp
from routes.expenses           import expenses_bp
from routes.announcements      import announcements_bp
from routes.notifications      import notifications_bp
from routes.policies           import policies_bp
from routes.analytics          import analytics_bp
from routes.api_keys           import api_keys_bp
from routes.webhooks           import webhooks_bp
from routes.public_api         import public_api_bp

app.register_blueprint(auth_bp,               url_prefix='/api/auth')
app.register_blueprint(roles_bp,              url_prefix='/api/roles')
app.register_blueprint(workflows_bp,          url_prefix='/api/workflows')
app.register_blueprint(audit_bp,              url_prefix='/api/audit-log')
app.register_blueprint(payroll_config_bp,     url_prefix='/api/payroll-config')
app.register_blueprint(payroll_runs_bp,       url_prefix='/api/payroll-runs')
app.register_blueprint(expenses_bp,           url_prefix='/api/expenses')
app.register_blueprint(announcements_bp,      url_prefix='/api/announcements')
app.register_blueprint(notifications_bp,      url_prefix='/api/notifications')
app.register_blueprint(policies_bp,           url_prefix='/api/policies')
app.register_blueprint(analytics_bp,          url_prefix='/api/analytics')
app.register_blueprint(api_keys_bp,           url_prefix='/api/api-keys')
app.register_blueprint(webhooks_bp,           url_prefix='/api/webhooks')
app.register_blueprint(public_api_bp,         url_prefix='/api/public/v1')
app.register_blueprint(employees_bp,          url_prefix='/api/employees')
app.register_blueprint(templates_bp,          url_prefix='/api/templates')
app.register_blueprint(letters_bp,            url_prefix='/api/letters')
app.register_blueprint(approvals_bp,          url_prefix='/api/approvals')
app.register_blueprint(exit_bp,               url_prefix='/api/exit')
app.register_blueprint(appointment_orders_bp, url_prefix='/api/appointment-orders')
app.register_blueprint(documents_bp,          url_prefix='/api/documents')
app.register_blueprint(leaves_bp,             url_prefix='/api/leaves')
app.register_blueprint(attendance_bp,         url_prefix='/api/attendance')
app.register_blueprint(payslips_bp,           url_prefix='/api/payslips')
app.register_blueprint(platform_bp,           url_prefix='/api/platform')
app.register_blueprint(demo_requests_bp,      url_prefix='/api/demo-requests')
app.register_blueprint(assets_bp,             url_prefix='/api/assets')
app.register_blueprint(support_bp,            url_prefix='/api/support')

@app.route('/')
def index():
    return {
        'status': 'ok',
        'message': 'HR Automation API is running',
        'version': '1.0.0'
    }

@app.errorhandler(404)
def not_found(e):    return {'error': 'Not found'}, 404

# flask-limiter's default 429 body is an HTML page, which every caller of
# this API (the React app, the marketing site) has to parse as JSON. Return
# the same shape as the other errors instead.
@app.errorhandler(429)
def rate_limited(e):
    retry_after = getattr(e, 'retry_after', None)
    body = {'error': 'Too many requests. Please wait a moment and try again.'}
    if getattr(e, 'description', None):
        body['limit'] = str(e.description)
    resp = jsonify(body)
    resp.status_code = 429
    if retry_after:
        resp.headers['Retry-After'] = str(retry_after)
    return resp

@app.errorhandler(500)
def server_error(e):
    import logging
    logging.getLogger('request').exception('Unhandled exception: %s', e)
    return {'error': 'Internal server error'}, 500

from tenant_scope import TenantMismatchError

@app.errorhandler(TenantMismatchError)
def tenant_mismatch(e):
    return {'error': 'Request referenced a different tenant than your session'}, 400

# ── TEST ONLY — remove before production ─────────────────────────────────────
# from flask import jsonify
# @app.route('/api/test-scheduler')
# def test_scheduler():
#     from scheduler import run_checks_now
#     return jsonify(run_checks_now(app))

# ── Start background scheduler (birthday + anniversary emails) ────────────────
from scheduler import start_scheduler
start_scheduler(app)

# ── Start biometric attendance sync (guarded — a missing device/driver
#    should never take down the whole API) ────────────────────────────────────
try:
    from services.essl_sync import start_background_sync
    start_background_sync(app)
except Exception as e:
    print(f'[app.py] ESSL biometric sync not started: {e}', flush=True)

if __name__ == '__main__':
    port = int(os.getenv('PORT', 5050))
    # threaded=True is important: a slow/unreachable biometric device connection
    # (services/essl_sync.py) must not block every other API request while it
    # times out — without this, Flask's dev server handles one request at a time.
    app.run(host="0.0.0.0", port=port, debug=True, use_reloader=False, threaded=True)
