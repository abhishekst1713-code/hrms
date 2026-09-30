from flask import Blueprint, request, jsonify, current_app, g
from flask_jwt_extended import create_access_token, get_jwt_identity
import bcrypt, os
from datetime import datetime
from bson import ObjectId

from auth_utils import tenant_scoped, require_role
from tenant_scope import get_db
from extensions import limiter
from roles_service import build_user_role_fields
from security_utils import (
    generate_token, token_expiry, validate_password_policy,
    is_locked, record_failed_login, reset_failed_login,
)
from services.email_service import send_invite_email, send_password_reset_email
from audit import log_audit

auth_bp = Blueprint('auth', __name__)

# FIX #8: dummy hash used to prevent timing attacks on login
_DUMMY_HASH = bcrypt.hashpw(b'dummy-timing-guard', bcrypt.gensalt())

def serialize_user(user):
    d = {
        'id':        str(user['_id']),
        'email':     user['email'],
        'name':      user['name'],
        'role':      user['role'],
        'role_key':  user.get('role_key') or user['role'],
        'tenant_id': user.get('tenant_id'),
    }
    if user.get('employee_ref'):
        d['employee_ref'] = user['employee_ref']
    if user.get('emp_code'):
        d['emp_code'] = user['emp_code']
    return d


@auth_bp.route('/login', methods=['POST'])
@limiter.limit('10 per minute')
def login():
    # FIX #8: validate body before use
    data = request.json or {}
    if not data.get('company') or not data.get('email') or not data.get('password'):
        return jsonify({'error': 'company, email and password are required'}), 400

    # Login runs before any JWT/tenant context exists, so it resolves the
    # tenant explicitly from the company slug and queries the raw db
    # directly rather than through get_db() (see tenant_scope.py docstring).
    db = current_app.db
    company = db.companies.find_one({'slug': data['company'].strip().lower()})
    if not company or company.get('status') == 'suspended':
        return jsonify({'error': 'Invalid credentials'}), 401
    tenant_id = str(company['_id'])

    user = db.users.find_one({'tenant_id': tenant_id, 'email': data['email']})

    if user and is_locked(user):
        return jsonify({'error': 'Account temporarily locked due to too many failed attempts. Try again later.'}), 403

    # FIX #8: always run checkpw to prevent email enumeration via timing
    pwd_bytes = data['password'].encode()
    check_hash = user['password'] if user else _DUMMY_HASH
    if not user or not bcrypt.checkpw(pwd_bytes, check_hash):
        if user:
            record_failed_login(db, user['_id'])
            log_audit(db, tenant_id, None, 'auth.login_failed', entity_type='user', entity_id=user['_id'])
        return jsonify({'error': 'Invalid credentials'}), 401
    # Block deactivated accounts (exited employees)
    if user.get('is_active') == False:
        return jsonify({'error': 'Account deactivated. Please contact HR.'}), 403
    # Belt-and-suspenders: check employee record directly
    if user.get('employee_ref'):
        emp = db.employees.find_one({'_id': ObjectId(user['employee_ref']), 'tenant_id': tenant_id})
        if emp and emp.get('status') == 'exited':
            db.users.update_one({'_id': user['_id']}, {'$set': {'is_active': False}})
            return jsonify({'error': 'Account deactivated. Please contact HR.'}), 403

    reset_failed_login(db, user['_id'])
    log_audit(db, tenant_id, user, 'auth.login_succeeded')

    token = create_access_token(
        identity=str(user['_id']),
        additional_claims={'tenant_id': tenant_id, 'role': user['role']},
    )
    resp = serialize_user(user)
    resp['must_reset_password'] = bool(user.get('must_reset_password'))
    return jsonify({'token': token, 'user': resp})


@auth_bp.route('/me', methods=['GET'])
@tenant_scoped
def me():
    db   = get_db()
    user = g.caller
    data = serialize_user(user)
    data['permissions'] = sorted(g.caller_permissions or [])
    if g.caller_role:
        data['role_name'] = g.caller_role.get('name')
    # Merge employee record fields so frontend always has them
    if user.get('employee_ref'):
        try:
            emp = db.employees.find_one({'_id': ObjectId(user['employee_ref'])})
            if emp:
                if emp.get('joining_date'): data['joining_date']  = emp['joining_date']
                if emp.get('designation'):  data['designation']   = emp['designation']
                if emp.get('department'):   data['department']    = emp['department']
                if emp.get('employee_id'):  data['employee_code'] = emp['employee_id']
                if emp.get('manager_id'):
                    mgr_emp = db.employees.find_one({'_id': ObjectId(emp['manager_id'])})
                    if mgr_emp: data['manager_name'] = mgr_emp.get('name', '')
        except Exception:
            pass
    # Also merge personal profile fields saved by the user
    for field in ('phone', 'personal_email', 'gender', 'blood_group',
                  'birthday', 'address', 'emergency_contact_name',
                  'emergency_contact_phone', 'emergency_contact_relation'):
        if user.get(field):
            data[field] = user[field]
    return jsonify(data)


@auth_bp.route('/users', methods=['GET'])
@require_role('admin', 'hr', 'hr_head')
def list_users():
    db    = get_db()
    role  = request.args.get('role')
    role_id = request.args.get('role_id')
    query = {}
    if role:    query['role'] = role
    if role_id: query['role_id'] = role_id
    users = list(db.users.find(query, {'password': 0}))
    roles_by_id = {str(r['_id']): r for r in db.roles.find({})}
    for u in users:
        u['_id'] = str(u['_id'])
        role_doc = roles_by_id.get(u.get('role_id'))
        u['role_name'] = role_doc['name'] if role_doc else u.get('role')
    return jsonify(users)


@auth_bp.route('/users', methods=['POST'])
@require_role('admin')
def create_user():
    """Invite-based provisioning: no password is set by the creator. A
    random unusable placeholder is stored, an invite token is emailed, and
    the account activates only once the invitee sets their own password
    via /accept-invite. Falls back to returning the invite link in the
    response when email isn't configured (dev/demo environments)."""
    db   = get_db()
    data = request.json or {}
    if not data.get('email') or not data.get('name'):
        return jsonify({'error': 'name and email are required'}), 400
    if db.users.find_one({'email': data['email']}):
        return jsonify({'error': 'Email already exists'}), 400

    from feature_gating import check_seat_limit, SeatLimitExceeded
    # companies aren't tenant-scoped data — must bypass the TenantScopedDB
    # wrapper (see tenant_scope.py / payslips.py's _get_payroll_policy).
    company = current_app.db.companies.find_one({'_id': ObjectId(g.tenant_id)})
    try:
        check_seat_limit(current_app.db, db, g.tenant_id, company)
    except SeatLimitExceeded as e:
        return jsonify({'error': str(e)}), 403

    role_fields = {}
    if data.get('role_id'):
        from roles_service import resolve_role
        role_doc = resolve_role(db, g.tenant_id, role_id=data['role_id'])
        if not role_doc:
            return jsonify({'error': 'Invalid role_id'}), 400
        role_fields = {'role': role_doc['base_role'], 'role_id': str(role_doc['_id']), 'role_key': role_doc['key']}
    else:
        role_fields = build_user_role_fields(db, g.tenant_id, data.get('role', 'hr'))

    company_name = company.get('name', 'your company') if company else 'your company'

    invite_token = generate_token()
    placeholder = bcrypt.hashpw(generate_token().encode(), bcrypt.gensalt())
    user = {
        'name':       data['name'],
        'email':      data['email'],
        'password':   placeholder,
        'is_active':  True,
        'must_reset_password': True,
        'invite_token': invite_token,
        'invite_expires_at': token_expiry(),
        'created_at': datetime.utcnow(),
        **role_fields,
    }
    result = db.users.insert_one(user)

    frontend_url = os.getenv('FRONTEND_URL', 'http://localhost:3000')
    accept_url = f'{frontend_url}/#/accept-invite?token={invite_token}'
    emailed = send_invite_email(data['email'], data['name'], company_name, accept_url)

    log_audit(db, g.tenant_id, g.caller, 'user.invited', entity_type='user', entity_id=result.inserted_id,
              details={'email': data['email'], 'role_key': role_fields.get('role_key')})

    resp = {'id': str(result.inserted_id), 'message': 'Invite sent' if emailed else 'User created — email not configured, share the invite link manually'}
    if not emailed:
        resp['invite_url'] = accept_url
    return jsonify(resp), 201


@auth_bp.route('/accept-invite', methods=['POST'])
@limiter.limit('10 per minute')
def accept_invite():
    data = request.json or {}
    token = data.get('token')
    new_password = data.get('password', '')
    if not token:
        return jsonify({'error': 'token is required'}), 400

    policy_error = validate_password_policy(new_password)
    if policy_error:
        return jsonify({'error': policy_error}), 400

    db = current_app.db
    user = db.users.find_one({'invite_token': token})
    if not user or not user.get('invite_expires_at') or user['invite_expires_at'] < datetime.utcnow():
        return jsonify({'error': 'Invite link is invalid or has expired'}), 400

    new_hash = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt())
    db.users.update_one({'_id': user['_id']}, {'$set': {
        'password': new_hash, 'must_reset_password': False,
        'invite_token': None, 'invite_expires_at': None,
        'updated_at': datetime.utcnow(),
    }})
    log_audit(db, user['tenant_id'], user, 'user.activated', entity_type='user', entity_id=user['_id'])
    return jsonify({'message': 'Account activated — you can now log in'})


@auth_bp.route('/forgot-password', methods=['POST'])
@limiter.limit('5 per minute')
def forgot_password():
    """Always returns the same generic message regardless of whether the
    account exists, to avoid leaking which emails are registered."""
    data = request.json or {}
    company_slug = (data.get('company') or '').strip().lower()
    email = (data.get('email') or '').strip()
    generic_response = jsonify({'message': 'If that account exists, a password reset email has been sent.'})

    if not company_slug or not email:
        return jsonify({'error': 'company and email are required'}), 400

    db = current_app.db
    company = db.companies.find_one({'slug': company_slug})
    if not company:
        return generic_response
    tenant_id = str(company['_id'])
    user = db.users.find_one({'tenant_id': tenant_id, 'email': email})
    if not user:
        return generic_response

    reset_token = generate_token()
    db.users.update_one({'_id': user['_id']}, {'$set': {
        'password_reset_token': reset_token, 'password_reset_expires_at': token_expiry(),
    }})
    frontend_url = os.getenv('FRONTEND_URL', 'http://localhost:3000')
    reset_url = f'{frontend_url}/#/reset-password?token={reset_token}'
    send_password_reset_email(email, user.get('name', ''), company.get('name', 'your company'), reset_url)
    log_audit(db, tenant_id, user, 'auth.password_reset_requested', entity_type='user', entity_id=user['_id'])
    return generic_response


@auth_bp.route('/reset-password', methods=['POST'])
@limiter.limit('10 per minute')
def reset_password():
    data = request.json or {}
    token = data.get('token')
    new_password = data.get('password', '')
    if not token:
        return jsonify({'error': 'token is required'}), 400

    policy_error = validate_password_policy(new_password)
    if policy_error:
        return jsonify({'error': policy_error}), 400

    db = current_app.db
    user = db.users.find_one({'password_reset_token': token})
    if not user or not user.get('password_reset_expires_at') or user['password_reset_expires_at'] < datetime.utcnow():
        return jsonify({'error': 'Reset link is invalid or has expired'}), 400

    new_hash = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt())
    db.users.update_one({'_id': user['_id']}, {'$set': {
        'password': new_hash, 'must_reset_password': False,
        'password_reset_token': None, 'password_reset_expires_at': None,
        'failed_login_attempts': 0, 'locked_until': None,
        'updated_at': datetime.utcnow(),
    }})
    log_audit(db, user['tenant_id'], user, 'auth.password_reset_completed', entity_type='user', entity_id=user['_id'])
    return jsonify({'message': 'Password reset — you can now log in'})


@auth_bp.route('/change-password', methods=['PUT'])
@tenant_scoped
def change_password():
    db   = get_db()
    data = request.json or {}

    current_password = data.get('current_password', '')
    new_password     = data.get('new_password', '')

    if not current_password or not new_password:
        return jsonify({'error': 'current_password and new_password are required'}), 400
    policy_error = validate_password_policy(new_password)
    if policy_error:
        return jsonify({'error': policy_error}), 400

    user = g.caller
    if not bcrypt.checkpw(current_password.encode(), user['password']):
        return jsonify({'error': 'Current password is incorrect'}), 400

    new_hash = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt())
    db.users.update_one({'_id': user['_id']}, {'$set': {
        'password': new_hash, 'must_reset_password': False, 'updated_at': datetime.utcnow(),
    }})
    log_audit(db, g.tenant_id, user, 'auth.password_changed', entity_type='user', entity_id=user['_id'])

    return jsonify({'message': 'Password changed successfully'})


@auth_bp.route('/profile', methods=['GET'])
@tenant_scoped
def get_profile():
    user = dict(g.caller)
    db   = get_db()
    user.pop('password', None)
    user['_id'] = str(user['_id'])
    user['permissions'] = sorted(g.caller_permissions or [])
    if g.caller_role:
        user['role_name'] = g.caller_role.get('name')
        user['role_key']  = g.caller_role.get('key')
    # Also pull employee record if linked
    if user.get('employee_ref'):
        emp = db.employees.find_one({'_id': ObjectId(user['employee_ref'])})
        if emp:
            # Only set if value actually exists — skip empty strings
            if emp.get('joining_date'): user['joining_date']  = emp['joining_date']
            if emp.get('designation'):  user['designation']   = emp['designation']
            if emp.get('department'):   user['department']    = emp['department']
            if emp.get('employee_id'):  user['employee_code'] = emp['employee_id']
            if emp.get('manager_id'):
                mgr_emp = db.employees.find_one({'_id': ObjectId(emp['manager_id'])})
                if mgr_emp: user['manager_name'] = mgr_emp.get('name', '')
    return jsonify(user)


@auth_bp.route('/profile', methods=['PUT'])
@tenant_scoped
def update_profile():
    db   = get_db()
    uid  = get_jwt_identity()
    data = request.json or {}

    allowed = {
        'name', 'phone', 'personal_email', 'address',
        'birthday', 'anniversary', 'emergency_contact_name',
        'emergency_contact_phone', 'emergency_contact_relation',
        'blood_group', 'gender',
    }
    update = { k: v for k, v in data.items() if k in allowed }
    update['updated_at'] = datetime.utcnow()

    db.users.update_one({'_id': ObjectId(uid)}, {'$set': update})

    # Also update name in employee record if linked
    if 'name' in update and data.get('employee_ref'):
        db.employees.update_one(
            {'_id': ObjectId(data['employee_ref'])},
            {'$set': {'name': update['name']}}
        )

    user = db.users.find_one({'_id': ObjectId(uid)}, {'password': 0})
    if not user:
        return jsonify({'error': 'User not found after update'}), 404
    user['_id'] = str(user['_id'])
    # Merge employee record so frontend user object stays complete
    if user.get('employee_ref'):
        try:
            emp = db.employees.find_one({'_id': ObjectId(user['employee_ref'])})
            if emp:
                user['joining_date']  = emp.get('joining_date',  '')
                user['designation']   = emp.get('designation',   '')
                user['department']    = emp.get('department',    '')
                user['employee_code'] = emp.get('employee_id',   '')
        except Exception:
            pass
    return jsonify({'message': 'Profile updated', 'user': user})
