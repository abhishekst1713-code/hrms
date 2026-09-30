"""
exit.py — Full workflow:
  Employee  → POST /api/exit/resign                     submit resignation
  Manager   → POST /api/exit/resign                     submit OWN resignation (same route)
  Manager   → GET  /api/exit/pending-approvals          team pending resignations (excludes self)
  Manager   → POST /api/exit/<id>/approve-resignation   approve team member (cannot approve self)
  Manager   → POST /api/exit/<id>/reject-resignation    reject team member (cannot reject self)
  HR/Admin  → GET  /api/exit/                           all exit pipeline
  HR/Admin  → POST /api/exit/<id>/clearance             tick clearances
  HR/Admin  → POST /api/exit/relieving/generate         generate letter (gated)
  Anyone    → GET  /api/exit/relieving/<id>/download    download letter
  Employee  → GET  /api/exit/my-status                  own status + letter link

All files stored in MongoDB GridFS — no local disk dependency.
"""

from flask import Blueprint, request, jsonify, current_app, send_file, g
from flask_jwt_extended import get_jwt_identity
from datetime import datetime, timedelta
from calendar import monthrange
from bson import ObjectId
from io import BytesIO
import logging
import os, re, tempfile, zipfile, gridfs
from services.email_service import try_send_email
from services.letter_generator import generate_letter_docx, generate_letter_pdf

from auth_utils import tenant_scoped, require_role, require_permission
from tenant_scope import get_db
from workflow_engine import start_workflow, advance_workflow, get_instance_for_entity, WorkflowError

log = logging.getLogger(__name__)

exit_bp = Blueprint('exit', __name__)

CLEARANCE_KEYS = ['it_assets', 'finance', 'admin', 'hr_docs', 'access_cards']
EXIT_PIPELINE  = ['resignation_pending', 'notice_period',
                  'clearance_pending', 'clearance_complete', 'exited']


# ─── Helpers ──────────────────────────────────────────────────────────────────

def get_fs():
    return gridfs.GridFS(current_app.db, collection='files_fs')


def get_template_fs():
    return gridfs.GridFS(current_app.db, collection='templates_fs')


def _get_template_bytes(tmpl):
    """Get template bytes from GridFS (new) or disk (legacy)."""
    if tmpl.get('gridfs_id'):
        fs = get_template_fs()
        grid_out = fs.get(ObjectId(tmpl['gridfs_id']))
        return grid_out.read()
    elif tmpl.get('file_path') and os.path.exists(tmpl['file_path']):
        with open(tmpl['file_path'], 'rb') as f:
            return f.read()
    else:
        raise ValueError(f"Template '{tmpl.get('name')}' file not found. Please re-upload it.")


def _ordinal(n):
    if 11 <= (n % 100) <= 13:
        return 'th'
    return {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')


def _fmt_letter_date(date_str):
    """15th December 2025 — used for the header {{date}} placeholder."""
    if not date_str:
        return date_str
    for fmt in ('%Y-%m-%d', '%d-%m-%Y', '%d/%m/%Y'):
        try:
            d = datetime.strptime(str(date_str).strip(), fmt)
            return f"{d.day}{_ordinal(d.day)} {d.strftime('%B %Y')}"
        except ValueError:
            pass
    return date_str


def _fmt_dot_date(date_str):
    """DD.MM.YYYY — used for joining_date / last_working_day / resignation_date."""
    if not date_str:
        return date_str
    for fmt in ('%Y-%m-%d', '%d-%m-%Y', '%d/%m/%Y'):
        try:
            d = datetime.strptime(str(date_str).strip(), fmt)
            return d.strftime('%d.%m.%Y')
        except ValueError:
            pass
    return date_str


def _s(doc):
    doc['_id'] = str(doc['_id'])
    return doc


# ─── Employee / Manager: submit own resignation ───────────────────────────────

@exit_bp.route('/resign', methods=['POST'])
@require_role('employee', 'manager')
def submit_resignation():
    db  = get_db()
    uid = get_jwt_identity()
    u = g.caller

    emp_ref = u.get('employee_ref')
    if not emp_ref:
        return jsonify({'error': 'No employee record linked to this account'}), 400

    emp = db.employees.find_one({'_id': ObjectId(emp_ref)})
    if not emp:
        return jsonify({'error': 'Employee record not found'}), 404
    if emp.get('status') != 'active':
        return jsonify({'error': f"Cannot resign — current status is '{emp.get('status')}'"}), 400

    data = request.json or {}
    resignation_date = data.get('resignation_date')
    if not resignation_date:
        return jsonify({'error': 'resignation_date is required'}), 400

    exit_reason = data.get('exit_reason', '').strip()
    if not exit_reason:
        return jsonify({'error': 'exit_reason is required'}), 400

    try:
        notice_days = int(emp.get('notice_period', 60))
        lwd = (datetime.strptime(resignation_date, '%Y-%m-%d')
               + timedelta(days=notice_days)).strftime('%Y-%m-%d')
    except Exception:
        lwd = None

    _, pending_status = start_workflow(db, g.tenant_id, 'exit_resignation', 'employee_exit', emp_ref, u,
                                        remarks=data.get('exit_reason', ''))

    db.employees.update_one({'_id': ObjectId(emp_ref)}, {'$set': {
        'status':           pending_status,
        'resignation_date': resignation_date,
        'last_working_day': data.get('last_working_day') or lwd,
        'exit_reason':      data.get('exit_reason', ''),
        'clearances':       {k: False for k in CLEARANCE_KEYS},
        'resigned_by_uid':  uid,
        'updated_at':       datetime.utcnow(),
    }})

    return jsonify({'message': 'Resignation submitted for approval.'})


# ─── Employee / Manager: own status ──────────────────────────────────────────

@exit_bp.route('/my-status', methods=['GET'])
@tenant_scoped
def my_status():
    db = get_db()
    u  = g.caller

    emp_ref = u.get('employee_ref')
    if not emp_ref:
        return jsonify({'in_exit_pipeline': False, 'status': u.get('role', 'active')})

    emp = db.employees.find_one({'_id': ObjectId(emp_ref)})
    if not emp:
        return jsonify({'error': 'Employee not found'}), 404

    result = {
        'in_exit_pipeline': emp.get('status') in EXIT_PIPELINE,
        'status':           emp.get('status'),
        'resignation_date': emp.get('resignation_date'),
        'last_working_day': emp.get('last_working_day'),
        'exit_reason':      emp.get('exit_reason'),
        'clearances':       emp.get('clearances', {}),
        'cleared_count':    sum(1 for v in emp.get('clearances', {}).values() if v),
        'total_clearances': len(CLEARANCE_KEYS),
    }

    if emp.get('status') == 'exited':
        letter = db.letters.find_one(
            {'employee_id': emp_ref, 'letter_type': 'relieving'},
            sort=[('created_at', -1)]
        )
        if letter:
            result['relieving_letter_id'] = str(letter['_id'])
            # GridFS: has file if gridfs_id exists
            result['has_pdf']  = bool(letter.get('pdf_gridfs_id'))
            result['has_docx'] = bool(letter.get('docx_gridfs_id'))

    return jsonify(result)


# ─── Manager: pending approvals ───────────────────────────────────────────────

@exit_bp.route('/pending-approvals', methods=['GET'])
@require_role('manager', 'hr_head', 'admin')
def pending_approvals():
    db = get_db()
    u  = g.caller

    role = u.get('role')

    if role == 'manager':
        mgr_ref = u.get('employee_ref', '')
        query = {'status': 'resignation_pending'}
        if mgr_ref:
            query['_id'] = {'$ne': ObjectId(mgr_ref)}
    else:
        query = {'status': 'resignation_pending'}

    employees = list(db.employees.find(query, sort=[('updated_at', -1)]))
    return jsonify([_s(e) for e in employees])


# ─── Manager: approve ────────────────────────────────────────────────────────

@exit_bp.route('/<emp_id>/approve-resignation', methods=['POST'])
@tenant_scoped
def approve_resignation(emp_id):
    db  = get_db()
    uid = get_jwt_identity()
    u   = g.caller

    emp = db.employees.find_one({'_id': ObjectId(emp_id)})
    if not emp:
        return jsonify({'error': 'Employee not found'}), 404

    instance = get_instance_for_entity(db, 'employee_exit', emp_id)
    if not instance:
        return jsonify({'error': f"Status is '{emp.get('status')}' — no resignation approval in progress"}), 400

    try:
        new_status = advance_workflow(
            db, g.tenant_id, instance, 'approve', u,
            g.caller_permissions, u.get('role_id'),
            remarks='Resignation approved', subject_employee_ref=emp_id,
        )
    except WorkflowError as e:
        return jsonify({'error': str(e)}), 403 if 'own' in str(e) or 'authorized' in str(e) else 400

    db.employees.update_one({'_id': ObjectId(emp_id)}, {'$set': {
        'status':                   new_status,
        'resignation_approved_by':  uid,
        'resignation_approved_at':  datetime.utcnow().isoformat(),
        'updated_at':               datetime.utcnow(),
    }})

    return jsonify({'message': 'Resignation approved.', 'new_status': new_status})


# ─── Manager: reject ─────────────────────────────────────────────────────────

@exit_bp.route('/<emp_id>/reject-resignation', methods=['POST'])
@tenant_scoped
def reject_resignation(emp_id):
    db  = get_db()
    uid = get_jwt_identity()
    u   = g.caller

    emp = db.employees.find_one({'_id': ObjectId(emp_id)})
    if not emp:
        return jsonify({'error': 'Employee not found'}), 404

    instance = get_instance_for_entity(db, 'employee_exit', emp_id)
    if not instance:
        return jsonify({'error': f"Status is '{emp.get('status')}' — no resignation approval in progress"}), 400

    data = request.json or {}
    try:
        new_status = advance_workflow(
            db, g.tenant_id, instance, 'reject', u,
            g.caller_permissions, u.get('role_id'),
            remarks=data.get('reason', '') or 'Rejected', subject_employee_ref=emp_id,
        )
    except WorkflowError as e:
        return jsonify({'error': str(e)}), 403 if 'own' in str(e) or 'authorized' in str(e) else 400

    db.employees.update_one({'_id': ObjectId(emp_id)}, {'$set': {
        'status':                   new_status,
        'resignation_date':         None,
        'last_working_day':         None,
        'exit_reason':              '',
        'clearances':               {},
        'resignation_rejected_by':  uid,
        'rejection_reason':         data.get('reason', ''),
        'updated_at':               datetime.utcnow(),
    }})

    return jsonify({'message': 'Resignation rejected. Employee restored to active.'})


# ─── HR/Manager: list exit pipeline ──────────────────────────────────────────

@exit_bp.route('/', methods=['GET'])
@tenant_scoped
def list_exit_employees():
    db = get_db()
    u  = g.caller

    role = u.get('role')

    if role == 'manager':
        query = {
            'status': {'$in': ['notice_period', 'clearance_pending', 'clearance_complete', 'exited']},
        }
    elif role in ('hr_head', 'admin', 'hr'):
        query = {'status': {'$in': ['notice_period', 'clearance_pending', 'clearance_complete', 'exited']}}
    else:
        emp_ref = u.get('employee_ref', '')
        query = {'_id': ObjectId(emp_ref), 'status': {'$in': EXIT_PIPELINE}}

    employees = list(db.employees.find(query, sort=[('updated_at', -1)]))
    return jsonify([_s(e) for e in employees])


# ─── HR: clearance update ────────────────────────────────────────────────────

@exit_bp.route('/<emp_id>/clearance', methods=['POST'])
@require_role('hr_head', 'admin')
def update_clearance(emp_id):
    db = get_db()
    u  = g.caller

    emp = db.employees.find_one({'_id': ObjectId(emp_id)})
    if not emp:
        return jsonify({'error': 'Employee not found'}), 404
    if emp.get('status') not in ('notice_period', 'clearance_pending', 'clearance_complete'):
        return jsonify({'error': 'Employee is not in clearance stage'}), 400

    data    = request.json or {}
    updates = {k: bool(v) for k, v in data.items() if k in CLEARANCE_KEYS}
    if not updates:
        return jsonify({'error': 'No valid clearance keys provided'}), 400

    current   = emp.get('clearances', {k: False for k in CLEARANCE_KEYS})
    merged    = {**current, **updates}
    all_clear = all(merged.get(k) for k in CLEARANCE_KEYS)
    new_status = 'clearance_complete' if all_clear else 'clearance_pending'

    db.employees.update_one({'_id': ObjectId(emp_id)}, {'$set': {
        'clearances': merged,
        'status':     new_status,
        'updated_at': datetime.utcnow(),
    }})

    return jsonify({'all_cleared': all_clear, 'status': new_status, 'clearances': merged})


# ─── HR: preview relieving letter ────────────────────────────────────────────

@exit_bp.route('/relieving/preview', methods=['POST'])
@require_role('hr_head', 'admin', 'hr')
def preview_relieving():
    db = get_db()
    u  = g.caller

    data         = request.json or {}
    emp_id       = data.get('employee_id')
    tmpl_id      = data.get('template_id')
    extra_fields = data.get('extra_fields', {})

    if not emp_id or not tmpl_id:
        return jsonify({'error': 'employee_id and template_id are required'}), 400

    emp = db.employees.find_one({'_id': ObjectId(emp_id)})
    if not emp:
        return jsonify({'error': 'Employee not found'}), 404

    tmpl = db.templates.find_one({'_id': ObjectId(tmpl_id)})
    if not tmpl:
        return jsonify({'error': 'Template not found'}), 404

    # ── Get template bytes from GridFS or disk ─────────────────────────────
    try:
        tmpl_bytes = _get_template_bytes(tmpl)
    except ValueError as e:
        return jsonify({'error': str(e)}), 404

    # ── Build context ──────────────────────────────────────────────────────
    ctx = {
        'employee_name':    emp.get('name', ''),
        'employee_id':      emp.get('employee_id', ''),
        'designation':      emp.get('designation', ''),
        'department':       emp.get('department', ''),
        'joining_date':     _fmt_dot_date(emp.get('joining_date', '')),
        'last_working_day': _fmt_dot_date(emp.get('last_working_day', '')),
        'resignation_date': _fmt_dot_date(emp.get('resignation_date', '')),
        'exit_reason':      emp.get('exit_reason', ''),
        'date':             _fmt_letter_date(datetime.now().strftime('%Y-%m-%d')),
    }
    for k, v in extra_fields.items():
        if v and str(v).strip():
            ctx[k] = str(v).strip()

    # ── Scan template for all {{placeholders}} ─────────────────────────────
    try:
        with zipfile.ZipFile(BytesIO(tmpl_bytes)) as z:
            xml_text = re.sub(r'<[^>]+>', '', z.read('word/document.xml').decode('utf-8'))
        all_placeholders = sorted(set(re.findall(r'\{\{(\w+)\}\}', xml_text)))
    except Exception as e:
        return jsonify({'error': f'Could not read template: {e}'}), 500

    # ── Check for missing fields ───────────────────────────────────────────
    auto_fields = {'date'}
    missing = [
        p for p in all_placeholders
        if p not in auto_fields and not str(ctx.get(p, '')).strip()
    ]

    if missing:
        return jsonify({
            'missing_fields': missing,
            'current_ctx':    {k: v for k, v in ctx.items() if k in all_placeholders},
        }), 422

    # ── Generate preview in tempdir, stream back ───────────────────────────
    with tempfile.TemporaryDirectory() as tmp:
        tmpl_path = os.path.join(tmp, 'template.docx')
        docx_path = os.path.join(tmp, 'preview.docx')
        pdf_path  = os.path.join(tmp, 'preview.pdf')

        with open(tmpl_path, 'wb') as f:
            f.write(tmpl_bytes)

        try:
            generate_letter_docx(tmpl_path, ctx, docx_path)
        except Exception as e:
            return jsonify({'error': f'Document generation failed: {e}'}), 500

        pdf_result = generate_letter_pdf(docx_path, pdf_path)

        if pdf_result and os.path.exists(pdf_result):
            with open(pdf_result, 'rb') as f:
                pdf_bytes = f.read()
            return send_file(BytesIO(pdf_bytes), mimetype='application/pdf',
                             as_attachment=False, download_name='preview.pdf')

        if os.path.exists(docx_path):
            with open(docx_path, 'rb') as f:
                docx_bytes = f.read()
            return send_file(BytesIO(docx_bytes),
                             mimetype='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                             as_attachment=False, download_name='preview.docx')

    return jsonify({'error': 'Preview generation failed'}), 500


# ─── HR: generate relieving letter ───────────────────────────────────────────

@exit_bp.route('/relieving/generate', methods=['POST'])
@require_role('hr_head', 'admin')
def generate_relieving():
    db  = get_db()
    uid = get_jwt_identity()
    u   = g.caller

    data    = request.json or {}
    emp_id  = data.get('employee_id')
    tmpl_id = data.get('template_id')

    if not emp_id or not tmpl_id:
        return jsonify({'error': 'employee_id and template_id are required'}), 400

    emp = db.employees.find_one({'_id': ObjectId(emp_id)})
    if not emp:
        return jsonify({'error': 'Employee not found'}), 404

    # COMPLIANCE GATE
    clearances = emp.get('clearances', {})
    missing    = [k for k in CLEARANCE_KEYS if not clearances.get(k)]
    if missing:
        return jsonify({'error': 'Clearance gate blocked.', 'missing_clearances': missing}), 403

    tmpl = db.templates.find_one({'_id': ObjectId(tmpl_id)})
    if not tmpl:
        return jsonify({'error': 'Template not found'}), 404

    try:
        tmpl_bytes = _get_template_bytes(tmpl)
    except ValueError as e:
        return jsonify({'error': str(e)}), 404

    ctx = {
        'employee_name':    emp.get('name', ''),
        'employee_id':      emp.get('employee_id', ''),
        'designation':      emp.get('designation', ''),
        'department':       emp.get('department', ''),
        'joining_date':     _fmt_dot_date(emp.get('joining_date', '')),
        'last_working_day': _fmt_dot_date(emp.get('last_working_day', '')),
        'resignation_date': _fmt_dot_date(emp.get('resignation_date', '')),
        'exit_reason':      emp.get('exit_reason', ''),
        'date':             _fmt_letter_date(datetime.now().strftime('%Y-%m-%d')),
        **data.get('extra_fields', {}),
    }

    fs   = get_fs()
    base = f"{emp.get('employee_id', emp_id)}_relieving"

    with tempfile.TemporaryDirectory() as tmp:
        tmpl_path = os.path.join(tmp, 'template.docx')
        docx_path = os.path.join(tmp, base + '.docx')
        pdf_path  = os.path.join(tmp, base + '.pdf')

        with open(tmpl_path, 'wb') as f:
            f.write(tmpl_bytes)

        try:
            generate_letter_docx(tmpl_path, ctx, docx_path)
        except Exception as e:
            return jsonify({'error': f'Document generation failed: {e}'}), 500

        # Save DOCX to GridFS
        with open(docx_path, 'rb') as f:
            docx_gid = str(fs.put(f.read(), filename=base + '.docx'))

        # Try PDF
        pdf_gid    = None
        pdf_bytes  = None
        pdf_result = generate_letter_pdf(docx_path, pdf_path)
        if pdf_result and os.path.exists(pdf_result):
            with open(pdf_result, 'rb') as f:
                pdf_bytes = f.read()
            pdf_gid = str(fs.put(pdf_bytes, filename=base + '.pdf'))

    doc = {
        'employee_id':    emp_id,
        'template_id':    tmpl_id,
        'letter_type':    'relieving',
        'status':         'issued',
        'docx_gridfs_id': docx_gid,
        'pdf_gridfs_id':  pdf_gid,
        'context':        ctx,
        'version':        1,
        'generated_by':   uid,
        'created_at':     datetime.utcnow(),
    }
    result = db.letters.insert_one(doc)

    db.employees.update_one(
        {'_id': ObjectId(emp_id)},
        {'$set': {'status': 'exited', 'updated_at': datetime.utcnow()}}
    )

    db.users.update_one(
        {'employee_ref': emp_id},
        {'$set': {'is_active': False, 'deactivated_at': datetime.utcnow()}}
    )

    from webhook_dispatch import dispatch_event
    dispatch_event(db, 'employee.exited', {
        'employee_id': emp_id, 'name': emp.get('name'), 'designation': emp.get('designation'),
        'last_working_day': emp.get('last_working_day'),
    })

    # ── Send email if candidate_email provided ─────────────────────────────
    candidate_email = data.get('candidate_email', '').strip()
    email_sent = False
    if candidate_email and pdf_bytes:
        body = (
            f"Dear {emp.get('name', '')},\n\n"
            f"Please find attached your relieving letter. "
            f"We wish you all the best in your future endeavours.\n\n"
            f"Regards,\n{data.get('hr_signatory_name', 'HR Team')}\n"
            f"{data.get('hr_signatory_designation', 'HR Manager')}"
        )
        filename = f"{emp.get('name', 'employee').replace(' ', '_')}_relieving_letter.pdf"
        email_sent, mail_err = try_send_email(
            candidate_email,
            f"Your Relieving Letter — {emp.get('name', '')}",
            body,
            from_label='HR Team',
            attachments=[{'filename': filename, 'content': pdf_bytes,
                          'mimetype': 'application/pdf'}],
        )
        if not email_sent:
            log.warning('Relieving letter email failed: %s (%s)', candidate_email, mail_err)

    return jsonify({
        'id':         str(result.inserted_id),
        'has_pdf':    pdf_gid is not None,
        'email_sent': email_sent,
        'message':    'Relieving letter generated successfully.' + (' Email sent to candidate.' if email_sent else ''),
    }), 201


# ─── Get login email ──────────────────────────────────────────────────────────

@exit_bp.route('/<emp_id>/login-email', methods=['GET'])
@tenant_scoped
def get_login_email(emp_id):
    db = get_db()
    user = db.users.find_one({'employee_ref': emp_id}, {'email': 1})
    if user:
        return jsonify({'email': user.get('email', '')})
    emp = db.employees.find_one({'_id': ObjectId(emp_id)})
    if emp:
        return jsonify({'email': emp.get('login_email', emp.get('email', ''))})
    return jsonify({'email': ''})


# ─── Download relieving letter ────────────────────────────────────────────────

@exit_bp.route('/relieving/<letter_id>/download', methods=['GET'])
@tenant_scoped
def download_relieving(letter_id):
    db = get_db()
    u  = g.caller

    letter = db.letters.find_one({'_id': ObjectId(letter_id), 'letter_type': 'relieving'})
    if not letter:
        return jsonify({'error': 'Relieving letter not found'}), 404

    if u.get('role') in ('employee', 'manager'):
        emp_ref = u.get('employee_ref', '')
        if letter.get('employee_id') != emp_ref:
            return jsonify({'error': 'Access denied'}), 403

    fmt  = request.args.get('format', 'pdf')
    ctx  = letter.get('context', {})
    name = ctx.get('employee_name', 'employee').replace(' ', '_')
    fs   = get_fs()

    # GridFS first
    if fmt == 'pdf' and letter.get('pdf_gridfs_id'):
        try:
            grid_out = fs.get(ObjectId(letter['pdf_gridfs_id']))
            return send_file(BytesIO(grid_out.read()), as_attachment=True,
                             download_name=f'{name}_relieving_letter.pdf',
                             mimetype='application/pdf')
        except Exception:
            pass

    if letter.get('docx_gridfs_id'):
        try:
            grid_out = fs.get(ObjectId(letter['docx_gridfs_id']))
            return send_file(BytesIO(grid_out.read()), as_attachment=True,
                             download_name=f'{name}_relieving_letter.docx',
                             mimetype='application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        except Exception:
            pass

    # Legacy disk fallback
    if fmt == 'pdf' and letter.get('pdf_path') and os.path.exists(letter['pdf_path']):
        return send_file(letter['pdf_path'], as_attachment=True,
                         download_name=f'{name}_relieving_letter.pdf')
    if letter.get('docx_path') and os.path.exists(letter['docx_path']):
        return send_file(letter['docx_path'], as_attachment=True,
                         download_name=f'{name}_relieving_letter.docx')

    return jsonify({'error': 'File not found. Please regenerate the relieving letter.'}), 404


# ─── Full & Final settlement ──────────────────────────────────────────────────
# Pro-rates the employee's last salary from their monthly basic/HRA/DA/
# allowances against last_working_day; leave-encashment days and any
# recoverable deductions (unreturned assets, notice-period shortfall) are
# HR-entered rather than auto-derived, since the leave-balance schema is
# per-category and its "encashable" definition is a policy choice this
# endpoint shouldn't guess at.

@exit_bp.route('/<emp_id>/fnf-settlement', methods=['GET'])
@require_permission('fnf.manage')
def get_fnf_settlement(emp_id):
    db = get_db()
    settlement = db.fnf_settlements.find_one({'employee_id': emp_id})
    if not settlement:
        return jsonify({'error': 'No settlement computed yet'}), 404
    settlement['_id'] = str(settlement['_id'])
    return jsonify(settlement)


@exit_bp.route('/<emp_id>/fnf-settlement', methods=['POST'])
@require_permission('fnf.manage')
def compute_fnf_settlement(emp_id):
    db = get_db()
    u = g.caller
    emp = db.employees.find_one({'_id': ObjectId(emp_id)})
    if not emp:
        return jsonify({'error': 'Employee not found'}), 404

    data = request.json or {}
    leave_days = float(data.get('leave_encashment_days', 0) or 0)
    recoverable = float(data.get('recoverable_deductions', 0) or 0)
    deduction_notes = data.get('deduction_notes', '')

    last_working_day = emp.get('last_working_day')
    if not last_working_day:
        return jsonify({'error': 'Employee has no last_working_day on record — cannot pro-rate'}), 400

    try:
        lwd = datetime.strptime(last_working_day, '%Y-%m-%d')
    except ValueError:
        return jsonify({'error': f'Unrecognized last_working_day format: {last_working_day!r}, expected YYYY-MM-DD'}), 400

    monthly_gross = sum(float(emp.get(f) or 0) for f in ('basic', 'hra', 'da', 'allowances'))
    days_in_month = monthrange(lwd.year, lwd.month)[1]
    prorated_salary = round(monthly_gross * lwd.day / days_in_month)

    per_day_salary = monthly_gross / days_in_month if days_in_month else 0
    leave_encashment_amount = round(per_day_salary * leave_days)

    total_payable = prorated_salary + leave_encashment_amount - recoverable

    now = datetime.utcnow()
    doc = {
        'employee_id': emp_id, 'last_working_day': last_working_day,
        'prorated_salary': prorated_salary,
        'leave_encashment_days': leave_days, 'leave_encashment_amount': leave_encashment_amount,
        'recoverable_deductions': recoverable, 'deduction_notes': deduction_notes,
        'total_payable': round(total_payable), 'status': 'draft',
        'computed_by': str(u['_id']), 'created_at': now, 'updated_at': now,
    }
    db.fnf_settlements.update_one({'employee_id': emp_id}, {'$set': doc}, upsert=True)
    saved = db.fnf_settlements.find_one({'employee_id': emp_id})
    saved['_id'] = str(saved['_id'])
    return jsonify(saved)


@exit_bp.route('/<emp_id>/fnf-settlement/finalize', methods=['POST'])
@require_permission('fnf.manage')
def finalize_fnf_settlement(emp_id):
    db = get_db()
    settlement = db.fnf_settlements.find_one({'employee_id': emp_id})
    if not settlement:
        return jsonify({'error': 'No settlement computed yet'}), 404
    db.fnf_settlements.update_one({'employee_id': emp_id}, {'$set': {
        'status': 'finalized', 'updated_at': datetime.utcnow(),
    }})
    return jsonify({'message': 'Settlement finalized'})


