"""
letters.py 
 Complete Offer Letter module
New features vs previous version:
  - CTC breakdown calculator (Basic/HRA/DA/DA/PF/GHI/Other)
  - letter_subtype: 'new' | 'revised'
  - Direct-to-HR-Head approval flow (no manager stage)
  - HR Head inline edit before approval
  - Send email to candidate after approval
  - Confirm join + Create employee login ID (role='employee')
  - GridFS storage for generated DOCX/PDF files
"""

from flask import Blueprint, request, jsonify, current_app, send_file, g
from flask_jwt_extended import get_jwt_identity
from datetime import datetime
from bson import ObjectId
import os, bcrypt, logging, base64, io, traceback, tempfile, gridfs
from io import BytesIO
import subprocess
import shutil
from docx import Document as DocxDocument
from html.parser import HTMLParser
from services.email_service import is_configured as email_is_configured, try_send_email
from services.letter_generator import generate_letter_docx, generate_letter_pdf
from services.gridfs_storage import save_file_to_gridfs, serve_from_gridfs, delete_from_gridfs

from auth_utils import tenant_scoped, require_role
from tenant_scope import get_db
from workflow_engine import start_workflow, advance_workflow, get_instance_for_entity, WorkflowError

letters_bp = Blueprint('letters', __name__)
log = logging.getLogger(__name__)

ACTIVE_STATUSES    = {'draft', 'pending_hr_head', 'rejected', 'approved', 'issued', 'joined'}
COMPLETED_STATUSES = {'id_created', 'withdrawn'}
DELETABLE_STATUSES = {'draft', 'rejected'}
DELETE_ROLES       = {'admin', 'hr_head'}


def calculate_ctc_breakdown(annual_ctc, avail_pf=True, ghi_annual=0.0, metro=False):
    ctc          = float(annual_ctc)
    basic_a      = round(ctc * 0.50)
    basic_m      = round(basic_a / 12)
    hra_a        = round(basic_a * (0.50 if metro else 0.40))
    hra_m        = round(hra_a / 12)
    da_a         = round(basic_a * 0.20)
    da_m         = round(da_a / 12)
    pf_m         = 1800 if avail_pf else 0
    pf_a         = pf_m * 12
    ghi_a        = round(float(ghi_annual or 0))
    ghi_m        = round(ghi_a / 12)
    other_a      = max(0, int(ctc) - basic_a - hra_a - da_a - pf_a - ghi_a)
    other_m      = round(other_a / 12)
    gross_m      = basic_m + hra_m + da_m + other_m
    net_a        = basic_a + hra_a + da_a + other_a
    return {
        'ctc': ctc, 'basic': basic_a, 'hra': hra_a, 'da': da_a,
        'employer_pf': pf_a, 'ghi': ghi_a, 'other_allowances': other_a,
        'net_annual': net_a, 'gross_monthly': gross_m,
        'basic_monthly': basic_m, 'hra_monthly': hra_m, 'da_monthly': da_m,
        'employer_pf_monthly': pf_m, 'ghi_monthly': ghi_m,
        'other_allowances_monthly': other_m,
        'avail_pf': avail_pf, 'metro': metro,
    }


def _inr(n):
    return f"Rs.{int(n or 0):,}"


def _ctc_to_ctx(ctx, bd):
    prof_tax_m  = 200
    emp_pf_m    = bd['employer_pf_monthly'] if bd['avail_pf'] else 0
    total_ded_m = emp_pf_m + prof_tax_m
    total_ded_y = total_ded_m * 12
    net_pay_m   = bd['gross_monthly'] - total_ded_m
    net_pay_y   = net_pay_m * 12
    additions_m = bd['employer_pf_monthly'] + bd['ghi_monthly']
    additions_y = bd['employer_pf'] + bd['ghi']
    total_ctc_m = round(bd['ctc'] / 12)

    ctx.update({
        'ctc':                      str(int(bd['ctc'])),
        'basic':                    str(bd['basic']),
        'hra':                      str(bd['hra']),
        'da':                       str(bd['da']),
        'employer_pf':              str(bd['employer_pf']),
        'ghi':                      str(bd['ghi']),
        'other_allowances':         str(bd['other_allowances']),
        'gross_monthly':            str(bd['gross_monthly']),
        'net_annual':               str(bd['net_annual']),
        'basic_monthly':            str(bd['basic_monthly']),
        'hra_monthly':              str(bd['hra_monthly']),
        'da_monthly':               str(bd['da_monthly']),
        'employer_pf_monthly':      str(bd['employer_pf_monthly']),
        'other_allowances_monthly': str(bd['other_allowances_monthly']),
        'ctc_fmt':                  _inr(bd['ctc']),
        'basic_fmt':                _inr(bd['basic']),
        'hra_fmt':                  _inr(bd['hra']),
        'da_fmt':                   _inr(bd['da']),
        'employer_pf_fmt':          _inr(bd['employer_pf']),
        'ghi_fmt':                  _inr(bd['ghi']),
        'other_allowances_fmt':     _inr(bd['other_allowances']),
        'gross_monthly_fmt':        _inr(bd['gross_monthly']),
        'net_annual_fmt':           _inr(bd['net_annual']),
        'basic_m':       _inr(bd['basic_monthly']),
        'basic_y':       _inr(bd['basic']),
        'hra_m':         _inr(bd['hra_monthly']),
        'hra_y':         _inr(bd['hra']),
        'da_m':          _inr(bd['da_monthly']),
        'da_y':          _inr(bd['da']),
        'other_m':       _inr(bd['other_allowances_monthly']),
        'other_y':       _inr(bd['other_allowances']),
        'gross_m':       _inr(bd['gross_monthly']),
        'gross_y':       _inr(bd['net_annual']),
        'pf_employer_m': _inr(bd['employer_pf_monthly']) if bd['employer_pf_monthly'] else '-',
        'pf_employer_y': _inr(bd['employer_pf'])         if bd['employer_pf']         else '-',
        'additions_m':   _inr(additions_m)               if additions_m               else '-',
        'additions_y':   _inr(additions_y)               if additions_y               else '-',
        'total_ctc_m':   _inr(total_ctc_m),
        'total_ctc_y':   _inr(bd['ctc']),
        'pf_employee_m': _inr(emp_pf_m)                  if emp_pf_m                  else '-',
        'pf_employee_y': _inr(emp_pf_m * 12)             if emp_pf_m                  else '-',
        'prof_tax_m':    _inr(prof_tax_m),
        'prof_tax_y':    _inr(prof_tax_m * 12),
        'deductions_m':  _inr(total_ded_m),
        'deductions_y':  _inr(total_ded_y),
        'net_pay_m':     _inr(net_pay_m),
        'net_pay_y':     _inr(net_pay_y),
    })
    return ctx


def _enrich(letter, db):
    letter['_id'] = str(letter['_id'])
    try:
        emp = db.employees.find_one({'_id': ObjectId(letter['employee_id'])})
        letter['employee_name'] = emp.get('name', 'Unknown') if emp else 'Unknown'
        letter['employee_code'] = emp.get('employee_id', '')  if emp else ''
        letter['designation']   = emp.get('designation', '')  if emp else ''
        letter['emp_email']     = emp.get('email', '')        if emp else ''
    except Exception:
        letter['employee_name'] = letter['employee_code'] = letter['designation'] = letter['emp_email'] = ''
    letter.pop('docx_path', None)
    letter.pop('pdf_path', None)
    return letter


def _next_version(db, emp_id):
    latest = db.letters.find_one({'employee_id': emp_id, 'letter_type': 'offer'}, sort=[('version', -1)])
    return (latest['version'] + 1) if latest else 1


def _get_template_path(tmpl, tmp_dir):
    """Write template to a temp file and return its path.
    Supports both GridFS-stored templates (new) and disk-stored templates (legacy)."""
    path = os.path.join(tmp_dir, tmpl.get('filename', 'template.docx'))

    if tmpl.get('gridfs_id'):
        # New: fetch from GridFS
        fs = gridfs.GridFS(current_app.db, collection='templates_fs')
        grid_out = fs.get(ObjectId(tmpl['gridfs_id']))
        with open(path, 'wb') as f:
            f.write(grid_out.read())
        return path

    elif tmpl.get('file_path') and os.path.exists(tmpl['file_path']):
        # Legacy: file still on disk
        return tmpl['file_path']

    else:
        raise ValueError(
            f"Template '{tmpl.get('name', 'unknown')}' has no accessible file. "
            "Please re-upload the template."
        )


def _gen_files(emp, tmpl, ctx, db, emp_id, app):
    ver  = _next_version(db, emp_id)
    year = datetime.now().strftime('%Y')
    out  = os.path.join(app.config['STORAGE_ROOT'], 'letters', year)
    os.makedirs(out, exist_ok=True)
    base = f"{emp.get('employee_id', emp_id)}_offer_v{ver}"
    dp   = os.path.join(out, base + '.docx')
    pp   = os.path.join(out, base + '.pdf')

    # Get template from GridFS to temp file
    tmpl_path = _get_template_path(tmpl, out)
    generate_letter_docx(tmpl_path, ctx, dp)
    pr = generate_letter_pdf(dp, pp)

    # Save to GridFS
    docx_gid = save_file_to_gridfs(dp, base + '.docx')
    pdf_gid  = save_file_to_gridfs(pr, base + '.pdf') if pr else None

    return ver, dp, pr, docx_gid, pdf_gid


@letters_bp.route('/', methods=['GET'])
@tenant_scoped
def list_letters():
    db     = get_db()
    caller = g.caller
    include_relieving = request.args.get('include_relieving', 'false').lower() == 'true'
    query = {} if include_relieving else {'letter_type': 'offer'}

    if caller and caller.get('role') in ('employee', 'manager'):
        query['employee_id'] = caller.get('employee_ref', '__none__')

    status = request.args.get('status')
    tab    = request.args.get('tab')
    emp_id = request.args.get('employee_id')

    if status:
        query['status'] = status
    elif tab == 'active':
        query['status'] = {'$in': list(ACTIVE_STATUSES)}
    elif tab == 'completed':
        query['status'] = {'$in': list(COMPLETED_STATUSES)}

    if emp_id and caller and caller.get('role') != 'employee':
        query['employee_id'] = emp_id

    return jsonify([_enrich(l, db) for l in db.letters.find(query).sort('created_at', -1)])


@letters_bp.route('/<lid>/preview-context', methods=['GET'])
@tenant_scoped
def preview_context(lid):
    db = get_db()
    letter = db.letters.find_one({'_id': ObjectId(lid)})
    if not letter:
        return jsonify({'error': 'Not found'}), 404
    return jsonify({
        'context':     letter.get('context', {}),
        'breakdown':   letter.get('breakdown', {}),
        'status':      letter.get('status'),
        'version':     letter.get('version', 1),
        'template_id': letter.get('template_id'),
    })


@letters_bp.route('/<lid>/preview-pdf', methods=['GET'])
@tenant_scoped
def preview_pdf(lid):
    db = get_db()
    letter = db.letters.find_one({'_id': ObjectId(lid)})
    if not letter:
        return jsonify({'error': 'Not found'}), 404

    # Serve from GridFS if available
    if letter.get('pdf_gridfs_id'):
        return serve_from_gridfs(
            letter['pdf_gridfs_id'],
            download_name=os.path.basename(letter.get('pdf_path', 'letter.pdf')),
            mimetype='application/pdf',
            as_attachment=False,
        )

    # Fallback: disk
    pdf_path  = letter.get('pdf_path')
    docx_path = letter.get('docx_path')

    if pdf_path and os.path.exists(pdf_path):
        if docx_path and os.path.exists(docx_path):
            if os.path.getmtime(docx_path) <= os.path.getmtime(pdf_path):
                return send_file(pdf_path, mimetype='application/pdf')
        else:
            return send_file(pdf_path, mimetype='application/pdf')

    if docx_path and os.path.exists(docx_path):
        out_pdf = docx_path.replace('.docx', '_preview.pdf')
        result  = generate_letter_pdf(docx_path, out_pdf)
        if result and os.path.exists(result):
            gid = save_file_to_gridfs(result, os.path.basename(result))
            db.letters.update_one(
                {'_id': ObjectId(lid)},
                {'$set': {'pdf_path': result, 'pdf_gridfs_id': gid, 'updated_at': datetime.utcnow()}}
            )
            return send_file(result, mimetype='application/pdf')
        log.warning(f'PDF generation failed for letter {lid} - serving DOCX fallback')
        return jsonify({
            'error': 'pdf_unavailable',
            'docx_url': f'/api/letters/{lid}/download?format=docx',
        }), 202

    if docx_path and not os.path.exists(docx_path):
        # Try GridFS
        if letter.get('docx_gridfs_id'):
            return serve_from_gridfs(
                letter['docx_gridfs_id'],
                download_name=os.path.basename(docx_path),
                mimetype='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                as_attachment=False,
            )
        return jsonify({'error': f'DOCX file missing: {docx_path}'}), 404

    return jsonify({'error': 'No document available for preview - regenerate the letter'}), 404


@letters_bp.route('/<lid>/preview-with-signatures', methods=['POST'])
@tenant_scoped
def preview_with_signatures(lid):
    db     = get_db()
    letter = db.letters.find_one({'_id': ObjectId(lid)})
    if not letter:
        return jsonify({'error': 'Not found'}), 404

    data           = request.json or {}
    hr_sig         = data.get('hr_signature', '')
    chairman_sig   = data.get('chairman_signature', '')

    tmpl = db.templates.find_one({'_id': ObjectId(letter['template_id'])})
    if not tmpl:
        return jsonify({'error': 'Template not found'}), 404

    ctx = {**letter.get('context', {})}
    if hr_sig:       ctx['hr_signature']       = hr_sig
    if chairman_sig: ctx['chairman_signature'] = chairman_sig

    tmp_dir  = tempfile.mkdtemp()
    try:
        tmpl_path = _get_template_path(tmpl, tmp_dir)
        tmp_docx  = os.path.join(tmp_dir, 'sig_preview.docx')
        tmp_pdf   = os.path.join(tmp_dir, 'sig_preview.pdf')
        generate_letter_docx(tmpl_path, ctx, tmp_docx)
        result = generate_letter_pdf(tmp_docx, tmp_pdf)
        if result and os.path.exists(result):
            return send_file(result, mimetype='application/pdf')
        return jsonify({'error': 'pdf_unavailable',
                        'docx_url': f'/api/letters/{lid}/download?format=docx'}), 202
    except Exception as e:
        log.error(f'Signature preview failed: {e}')
        return jsonify({'error': str(e)}), 500
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


@letters_bp.route('/<lid>/update-draft', methods=['POST'])
@tenant_scoped
def update_draft(lid):
    db   = get_db()
    data = request.json or {}

    letter = db.letters.find_one({'_id': ObjectId(lid)})
    if not letter:
        return jsonify({'error': 'Not found'}), 404
    if letter.get('status') not in ('draft', 'rejected'):
        return jsonify({'error': 'Only draft or rejected letters can be edited'}), 400

    new_fields = data.get('fields', {})
    if not new_fields:
        return jsonify({'error': 'fields required'}), 400

    ctx = {**letter.get('context', {}), **new_fields}
    ctx['date'] = ctx.get('date') or datetime.now().strftime('%d-%m-%Y')

    emp  = db.employees.find_one({'_id': ObjectId(letter['employee_id'])})
    tmpl = db.templates.find_one({'_id': ObjectId(letter['template_id'])})
    if not emp or not tmpl:
        return jsonify({'error': 'Employee or template not found'}), 404

    try:
        emp_id = str(emp['_id'])
        ver, dp, pr, docx_gid, pdf_gid = _gen_files(emp, tmpl, ctx, db, emp_id, current_app)
    except Exception as e:
        return jsonify({'error': f'Regeneration failed: {e}'}), 500

    db.letters.update_one({'_id': ObjectId(lid)}, {'$set': {
        'context':       ctx,
        'docx_path':     dp,
        'pdf_path':      pr,
        'docx_gridfs_id': docx_gid,
        'pdf_gridfs_id':  pdf_gid,
        'version':       ver,
        'status':        'draft',
        'updated_at':    datetime.utcnow(),
    }})
    return jsonify({'message': 'Draft updated', 'version': ver})


@letters_bp.route('/ctc-breakdown', methods=['POST'])
@tenant_scoped
def ctc_breakdown():
    data = request.json or {}
    try:
        ctc = float(data.get('annual_ctc', 0) or 0)
    except (ValueError, TypeError):
        return jsonify({'error': 'annual_ctc must be a number'}), 400
    if ctc <= 0:
        return jsonify({'error': 'annual_ctc must be positive'}), 400
    bd = calculate_ctc_breakdown(
        ctc,
        avail_pf   = bool(data.get('avail_pf', True)),
        ghi_annual = float(data.get('ghi_annual', 0) or 0),
        metro      = bool(data.get('metro', False)),
    )
    return jsonify(bd)


def _format_acceptance_date(date_str):
    try:
        for fmt in ('%Y-%m-%d', '%d-%m-%Y', '%d/%m/%Y'):
            try:
                dt = datetime.strptime(date_str, fmt)
                break
            except ValueError:
                continue
        else:
            return date_str
        day = dt.day
        if 11 <= day <= 13:
            suffix = 'th'
        else:
            suffix = {1: 'st', 2: 'nd', 3: 'rd'}.get(day % 10, 'th')
        return f"{day}{suffix} {dt.strftime('%B %Y')}"
    except Exception:
        return date_str


@letters_bp.route('/generate-new', methods=['POST'])
@tenant_scoped
def generate_new():
    db   = get_db()
    uid  = get_jwt_identity()
    data = request.json or {}

    tmpl_id = data.get('template_id')
    fields  = data.get('fields', {})

    if not tmpl_id:
        return jsonify({'error': 'template_id is required'}), 400
    if not fields:
        return jsonify({'error': 'fields dict is required'}), 400

    tmpl = db.templates.find_one({'_id': ObjectId(tmpl_id)})
    if not tmpl:  return jsonify({'error': 'Template not found'}), 404
    if not tmpl.get('is_active'): return jsonify({'error': 'Template is inactive'}), 400

    tmpl_placeholders = [p.lower() for p in (tmpl.get('placeholders') or [])]
    field_keys = {k.lower(): k for k in fields.keys()}

    CTC_AUTO_FIELDS = {
        'basic','hra','da','employer_pf','ghi','other_allowances',
        'gross_monthly','net_annual','ctc_fmt','basic_fmt','hra_fmt','da_fmt',
        'employer_pf_fmt','ghi_fmt','other_allowances_fmt','gross_monthly_fmt',
        'net_annual_fmt','basic_monthly','hra_monthly','da_monthly',
        'employer_pf_monthly','other_allowances_monthly',
        'basic_m','basic_y','hra_m','hra_y','da_m','da_y',
        'other_m','other_y','gross_m','gross_y',
        'pf_employer_m','pf_employer_y','additions_m','additions_y',
        'total_ctc_m','total_ctc_y','pf_employee_m','pf_employee_y',
        'prof_tax_m','prof_tax_y','deductions_m','deductions_y',
        'net_pay_m','net_pay_y',
    }

    missing = [
        p for p in tmpl_placeholders
        if p not in field_keys
        and p not in ('date', 'employee_id')
        and p not in CTC_AUTO_FIELDS
    ]

    if missing:
        return jsonify({'error': f'Missing fields: {", ".join(missing)}'}), 400

    from routes.employees import _next_emp_id
    emp_id_code = _next_emp_id(db)

    def _pick(*keys, default=''):
        for k in keys:
            v = fields.get(k)
            if v and str(v).strip():
                return str(v).strip()
        return default

    emp_data = {
        'name':             _pick('candidate_name', 'employee_name', 'name', 'full_name', 'applicant_name', default='Candidate'),
        'designation':      _pick('designation', 'post', 'position', 'job_title', 'role', default=''),
        'department':       _pick('department', 'dept', 'division', default=''),
        'email':            _pick('email', 'candidate_email', 'employee_email', default=''),
        'joining_date':     _pick('joining_date', 'date_of_joining', 'doj', 'start_date', default=''),
        'address':          _pick('address', 'residential_address', 'permanent_address', default=''),
        'probation_period': _pick('probation_period', 'probation', default='6'),
        'notice_period':    _pick('notice_period', 'notice', default='60'),
        'employee_id':      emp_id_code,
        'status':           'active',
        'visible':          False,
        'created_at':       datetime.utcnow(),
        'created_by':       uid,
    }

    emp_res = db.employees.insert_one(emp_data)
    emp_id  = str(emp_res.inserted_id)
    emp     = db.employees.find_one({'_id': emp_res.inserted_id})

    ctx = {k.lower(): v for k, v in fields.items()}
    ctx['employee_id'] = emp_id_code
    ctx['date']        = fields.get('date') or datetime.now().strftime('%d-%m-%Y')

    if ctx.get('acceptance_date'):
        ctx['acceptance_date'] = _format_acceptance_date(ctx['acceptance_date'])
    if ctx.get('joining_date'):
        ctx['joining_date'] = _format_acceptance_date(ctx['joining_date'])
    if ctx.get('date'):
        ctx['date'] = _format_acceptance_date(ctx['date'])

    bd = {}
    raw_ctc = 0
    try:
        raw_ctc  = float(ctx.get('ctc') or 0)
        if raw_ctc > 0:
            avail_pf = data.get('avail_pf', True)
            bd  = calculate_ctc_breakdown(raw_ctc, avail_pf=avail_pf, ghi_annual=0, metro=False)
            ctx = _ctc_to_ctx(ctx, bd)
    except Exception as e:
        log.warning(f'CTC breakdown injection failed: {e}')

    try:
        ver, dp, pr, docx_gid, pdf_gid = _gen_files(emp, tmpl, ctx, db, emp_id, current_app)
    except Exception as e:
        tb = traceback.format_exc()
        log.error(f'Document generation failed:\n{tb}')
        db.employees.delete_one({'_id': emp_res.inserted_id})
        return jsonify({'error': f'Document generation failed: {e}', 'traceback': tb}), 500

    result = db.letters.insert_one({
        'employee_id':    emp_id,
        'template_id':    tmpl_id,
        'letter_type':    'offer',
        'letter_subtype': 'new',
        'status':         'draft',
        'approval_history': [],
        'docx_path':       dp,     'pdf_path':       pr,
        'docx_gridfs_id':  docx_gid, 'pdf_gridfs_id': pdf_gid,
        'context':    ctx, 'breakdown': bd,
        'version':    ver, 'generated_by': uid,
        'candidate_email': emp_data['email'],
        'created_at': datetime.utcnow(),
    })
    return jsonify({
        'id':            str(result.inserted_id),
        'employee_id':   emp_id,
        'employee_code': emp_id_code,
        'version':       ver,
        'has_pdf':       pr is not None,
    }), 201


@letters_bp.route('/generate', methods=['POST'])
@tenant_scoped
def generate():
    db   = get_db()
    uid  = get_jwt_identity()
    data = request.json or {}

    emp_id  = data.get('employee_id')
    tmpl_id = data.get('template_id')
    if not emp_id or not tmpl_id:
        return jsonify({'error': 'employee_id and template_id required'}), 400

    emp  = db.employees.find_one({'_id': ObjectId(emp_id)})
    tmpl = db.templates.find_one({'_id': ObjectId(tmpl_id)})
    if not emp:  return jsonify({'error': 'Employee not found'}), 404
    if not tmpl: return jsonify({'error': 'Template not found'}), 404
    if not tmpl.get('is_active'): return jsonify({'error': 'Template is inactive'}), 400

    try:
        ctc = float(data.get('annual_ctc') or emp.get('ctc', 0) or 0)
    except (ValueError, TypeError):
        ctc = 0.0

    bd  = calculate_ctc_breakdown(ctc,
            avail_pf=bool(data.get('avail_pf', True)),
            ghi_annual=float(data.get('ghi_annual', 0) or 0),
            metro=bool(data.get('metro', False)))

    ctx = {
        'employee_name': emp.get('name', ''),
        'employee_id': emp.get('employee_id', ''),
        'designation': emp.get('designation', ''),
        'department': emp.get('department', ''),
        'joining_date': data.get('joining_date') or emp.get('joining_date', ''),
        'address': emp.get('address', ''),
        'probation_period': str(emp.get('probation_period', '6')),
        'notice_period': str(emp.get('notice_period', '60')),
        'company_name': data.get('company_name', 'Acme Corp'),
        'hr_signatory_name': data.get('hr_signatory_name', ''),
        'hr_signatory_designation': data.get('hr_signatory_designation', 'HR Manager'),
        'date': datetime.now().strftime('%d-%m-%Y'),
        **data.get('extra_fields', {}),
    }
    ctx = _ctc_to_ctx(ctx, bd)

    if ctc > 0:
        db.employees.update_one({'_id': ObjectId(emp_id)}, {'$set': {'ctc': ctc}})

    try:
        ver, dp, pr, docx_gid, pdf_gid = _gen_files(emp, tmpl, ctx, db, emp_id, current_app)
    except Exception as e:
        return jsonify({'error': f'Document generation failed: {e}'}), 500

    result = db.letters.insert_one({
        'employee_id': emp_id, 'template_id': tmpl_id,
        'letter_type': 'offer', 'letter_subtype': 'new',
        'status': 'draft', 'approval_history': [],
        'docx_path': dp, 'pdf_path': pr,
        'docx_gridfs_id': docx_gid, 'pdf_gridfs_id': pdf_gid,
        'context': ctx, 'breakdown': bd,
        'version': ver, 'generated_by': uid,
        'candidate_email': data.get('candidate_email') or emp.get('email', ''),
        'created_at': datetime.utcnow(),
    })
    return jsonify({'id': str(result.inserted_id), 'version': ver,
                    'has_pdf': pr is not None, 'breakdown': bd}), 201


@letters_bp.route('/revise', methods=['POST'])
@tenant_scoped
def revise():
    db   = get_db()
    uid  = get_jwt_identity()
    data = request.json or {}

    orig_id    = data.get('original_letter_id')
    emp_id_raw = data.get('employee_id')

    if orig_id:
        orig = db.letters.find_one({'_id': ObjectId(orig_id)})
        if not orig: return jsonify({'error': 'Original letter not found'}), 404
        emp_id = orig['employee_id']
    elif emp_id_raw:
        orig   = {}
        emp_id = emp_id_raw
    else:
        return jsonify({'error': 'original_letter_id or employee_id required'}), 400

    emp = db.employees.find_one({'_id': ObjectId(emp_id)})
    if not emp: return jsonify({'error': 'Employee not found'}), 404

    tmpl_id = data.get('template_id') or orig.get('template_id')
    tmpl    = db.templates.find_one({'_id': ObjectId(tmpl_id)})
    if not tmpl: return jsonify({'error': 'Template not found'}), 404

    obd = orig.get('breakdown', {}) if isinstance(orig, dict) else {}
    try:
        ctc = float(data.get('annual_ctc') or obd.get('ctc', 0) or 0)
    except (ValueError, TypeError):
        ctc = 0.0

    bd  = calculate_ctc_breakdown(ctc,
            avail_pf=bool(data.get('avail_pf', obd.get('avail_pf', True))),
            ghi_annual=float(data.get('ghi_annual', obd.get('ghi', 0)) or 0),
            metro=bool(data.get('metro', obd.get('metro', False))))

    oc  = orig.get('context', {})
    full_address = emp.get('address', oc.get('address', ''))
    addr_parts   = [p.strip() for p in full_address.split(',') if p.strip()]

    emp_profile = {
        'candidate_name':  emp.get('name', ''),
        'employee_name':   emp.get('name', ''),
        'full_name':       emp.get('name', ''),
        'name':            emp.get('name', ''),
        'address':         full_address,
        'address_line1':   addr_parts[0] if len(addr_parts) > 0 else '',
        'address_line2':   addr_parts[1] if len(addr_parts) > 1 else '',
        'city':            addr_parts[2] if len(addr_parts) > 2 else emp.get('city', ''),
        'pincode':         emp.get('pincode', oc.get('pincode', '')),
        'state':           emp.get('state',   oc.get('state',   '')),
        'phone':           emp.get('phone',          oc.get('phone', '')),
        'mobile':          emp.get('phone',          oc.get('mobile', '')),
        'email':           emp.get('email',          oc.get('email', '')),
        'candidate_email': emp.get('email',          oc.get('candidate_email', '')),
        'personal_email':  emp.get('personal_email', oc.get('personal_email', '')),
        'department':      emp.get('department',  oc.get('department', '')),
        'employee_id':     emp.get('employee_id', oc.get('employee_id', '')),
        'emp_code':        emp.get('employee_id', oc.get('emp_code', '')),
    }

    ctx = {
        **oc,
        **emp_profile,
        'designation':     data.get('designation') or oc.get('designation', ''),
        'joining_date':    data.get('joining_date') or oc.get('joining_date', ''),
        'company_name':    data.get('company_name') or oc.get('company_name', 'Acme Corp'),
        'hr_signatory_name':        data.get('hr_signatory_name') or oc.get('hr_signatory_name', ''),
        'hr_signatory_designation': data.get('hr_signatory_designation') or oc.get('hr_signatory_designation', 'HR Manager'),
        'date': _format_acceptance_date(datetime.now().strftime('%d-%m-%Y')),
        **data.get('extra_fields', {}),
    }
    ctx = _ctc_to_ctx(ctx, bd)

    try:
        ver, dp, pr, docx_gid, pdf_gid = _gen_files(emp, tmpl, ctx, db, emp_id, current_app)
    except Exception as e:
        return jsonify({'error': f'Document generation failed: {e}'}), 500

    result = db.letters.insert_one({
        'employee_id': emp_id, 'template_id': tmpl_id,
        'letter_type': 'offer', 'letter_subtype': 'revised',
        'original_letter_id': orig_id,
        'status': 'draft', 'approval_history': [],
        'docx_path': dp, 'pdf_path': pr,
        'docx_gridfs_id': docx_gid, 'pdf_gridfs_id': pdf_gid,
        'context': ctx, 'breakdown': bd,
        'version': ver, 'generated_by': uid,
        'candidate_email': data.get('candidate_email') or orig.get('candidate_email', '') or emp.get('email', ''),
        'created_at': datetime.utcnow(),
    })
    return jsonify({'id': str(result.inserted_id), 'version': ver,
                    'has_pdf': pr is not None, 'breakdown': bd}), 201


@letters_bp.route('/<lid>/docx-to-html', methods=['GET'])
@tenant_scoped
def docx_to_html(lid):
    db = get_db()
    letter = db.letters.find_one({'_id': ObjectId(lid)})
    if not letter:
        return jsonify({'error': 'Not found'}), 404

    docx_path = letter.get('docx_path')
    # If disk file missing, restore from GridFS
    if (not docx_path or not os.path.exists(docx_path)) and letter.get('docx_gridfs_id'):
        tmp = tempfile.NamedTemporaryFile(suffix='.docx', delete=False)
        fs = gridfs.GridFS(current_app.db, collection='files_fs')
        grid_out = fs.get(ObjectId(letter['docx_gridfs_id']))
        tmp.write(grid_out.read())
        tmp.flush()
        docx_path = tmp.name

    if not docx_path or not os.path.exists(docx_path):
        return jsonify({'error': 'DOCX not found'}), 404

    try:
        doc = DocxDocument(docx_path)
        blocks = []
        for i, para in enumerate(doc.paragraphs):
            blocks.append({
                'id':    f'p_{i}',
                'type':  'para',
                'text':  para.text,
                'style': para.style.name if para.style else 'Normal',
                'bold':  any(r.bold for r in para.runs if r.text.strip()),
                'align': str(para.alignment) if para.alignment else 'LEFT',
            })
        for ti, table in enumerate(doc.tables):
            for ri, row in enumerate(table.rows):
                for ci, cell in enumerate(row.cells):
                    blocks.append({
                        'id':    f't_{ti}_r_{ri}_c_{ci}',
                        'type':  'cell',
                        'text':  cell.text,
                        'table': ti, 'row': ri, 'col': ci,
                        'bold':  False,
                    })
        return jsonify({'blocks': blocks})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@letters_bp.route('/<lid>/save-html', methods=['POST'])
@tenant_scoped
def save_html(lid):
    db = get_db()
    letter = db.letters.find_one({'_id': ObjectId(lid)})
    if not letter:
        return jsonify({'error': 'Not found'}), 404
    if letter.get('status') not in ('draft', 'rejected'):
        return jsonify({'error': 'Only draft or rejected letters can be edited'}), 400

    docx_path = letter.get('docx_path')
    if not docx_path or not os.path.exists(docx_path):
        return jsonify({'error': 'DOCX not found'}), 404

    data    = request.json or {}
    changes = { b['id']: b['text'] for b in data.get('blocks', []) }
    if not changes:
        return jsonify({'message': 'Nothing changed'}), 200

    try:
        doc = DocxDocument(docx_path)
        for i, para in enumerate(doc.paragraphs):
            bid = f'p_{i}'
            if bid not in changes: continue
            new_text = changes[bid]
            if para.text == new_text: continue
            if not para.runs: continue
            para.runs[0].text = new_text
            for r in para.runs[1:]: r.text = ''
        for ti, table in enumerate(doc.tables):
            for ri, row in enumerate(table.rows):
                for ci, cell in enumerate(row.cells):
                    bid = f't_{ti}_r_{ri}_c_{ci}'
                    if bid not in changes: continue
                    new_text = changes[bid]
                    if cell.text == new_text: continue
                    if cell.paragraphs and cell.paragraphs[0].runs:
                        cell.paragraphs[0].runs[0].text = new_text
                        for r in cell.paragraphs[0].runs[1:]: r.text = ''
                    elif cell.paragraphs:
                        cell.paragraphs[0].text = new_text
        doc.save(docx_path)

        pdf_path = letter.get('pdf_path') or docx_path.replace('.docx', '.pdf')
        pr = generate_letter_pdf(docx_path, pdf_path)

        # Update GridFS
        docx_gid = save_file_to_gridfs(docx_path, os.path.basename(docx_path))
        pdf_gid  = save_file_to_gridfs(pr, os.path.basename(pr)) if pr else letter.get('pdf_gridfs_id')

        db.letters.update_one({'_id': ObjectId(lid)}, {'$set': {
            'pdf_path': pr, 'docx_gridfs_id': docx_gid, 'pdf_gridfs_id': pdf_gid,
            'updated_at': datetime.utcnow(),
        }})
        return jsonify({'message': 'Saved successfully', 'has_pdf': pr is not None})
    except Exception as e:
        log.error(f'save_html error: {e}')
        return jsonify({'error': str(e)}), 500


@letters_bp.route('/<lid>/extract-content', methods=['GET'])
@tenant_scoped
def extract_content(lid):
    db = get_db()
    letter = db.letters.find_one({'_id': ObjectId(lid)})
    if not letter:
        return jsonify({'error': 'Not found'}), 404

    docx_path = letter.get('docx_path')
    if not docx_path or not os.path.exists(docx_path):
        return jsonify({'error': 'DOCX file not found'}), 404

    doc = DocxDocument(docx_path)
    blocks = []
    for i, para in enumerate(doc.paragraphs):
        blocks.append({'id': f'para_{i}', 'type': 'paragraph', 'text': para.text,
                       'style': para.style.name if para.style else 'Normal'})
    for ti, table in enumerate(doc.tables):
        for ri, row in enumerate(table.rows):
            for ci, cell in enumerate(row.cells):
                blocks.append({'id': f'table_{ti}_row_{ri}_cell_{ci}', 'type': 'table_cell',
                               'text': cell.text, 'table_index': ti, 'row_index': ri, 'cell_index': ci})
    return jsonify({'blocks': blocks})


@letters_bp.route('/<lid>/save-content', methods=['POST'])
@tenant_scoped
def save_content(lid):
    db = get_db()
    letter = db.letters.find_one({'_id': ObjectId(lid)})
    if not letter:
        return jsonify({'error': 'Not found'}), 404
    if letter.get('status') not in ('draft', 'rejected'):
        return jsonify({'error': 'Only draft or rejected letters can be edited'}), 400

    docx_path = letter.get('docx_path')
    if not docx_path or not os.path.exists(docx_path):
        return jsonify({'error': 'DOCX file not found'}), 404

    data   = request.json or {}
    blocks = data.get('blocks', [])
    if not blocks:
        return jsonify({'error': 'blocks required'}), 400

    doc = DocxDocument(docx_path)
    for block in blocks:
        bid = block.get('id', '')
        new_text = block.get('text', '')
        if bid.startswith('para_'):
            idx = int(bid.split('_')[1])
            if idx < len(doc.paragraphs):
                para = doc.paragraphs[idx]
                if para.runs:
                    para.runs[0].text = new_text
                    for r in para.runs[1:]: r.text = ''
                else:
                    para.text = new_text
        elif bid.startswith('table_'):
            parts = bid.split('_')
            ti = int(parts[1]); ri = int(parts[3]); ci = int(parts[5])
            if ti < len(doc.tables):
                table = doc.tables[ti]
                if ri < len(table.rows) and ci < len(table.rows[ri].cells):
                    cell = table.rows[ri].cells[ci]
                    if cell.paragraphs and cell.paragraphs[0].runs:
                        cell.paragraphs[0].runs[0].text = new_text
                        for r in cell.paragraphs[0].runs[1:]: r.text = ''
                    elif cell.paragraphs:
                        cell.paragraphs[0].text = new_text
    doc.save(docx_path)

    pdf_path = letter.get('pdf_path') or docx_path.replace('.docx', '.pdf')
    pr = generate_letter_pdf(docx_path, pdf_path)

    docx_gid = save_file_to_gridfs(docx_path, os.path.basename(docx_path))
    pdf_gid  = save_file_to_gridfs(pr, os.path.basename(pr)) if pr else letter.get('pdf_gridfs_id')

    db.letters.update_one({'_id': ObjectId(lid)}, {'$set': {
        'pdf_path': pr, 'docx_gridfs_id': docx_gid, 'pdf_gridfs_id': pdf_gid,
        'updated_at': datetime.utcnow(),
    }})
    return jsonify({'message': 'Saved and PDF regenerated', 'has_pdf': pr is not None})


@letters_bp.route('/<lid>', methods=['GET'])
@tenant_scoped
def get_letter(lid):
    db = get_db()
    l  = db.letters.find_one({'_id': ObjectId(lid)})
    return (jsonify(_enrich(l, db)) if l else (jsonify({'error': 'Not found'}), 404))


@letters_bp.route('/<lid>/submit', methods=['POST'])
@tenant_scoped
def submit(lid):
    db     = get_db()
    caller = g.caller
    l = db.letters.find_one({'_id': ObjectId(lid)})
    if not l: return jsonify({'error': 'Letter not found'}), 404
    if l['status'] != 'draft':
        return jsonify({'error': 'Only draft letters can be submitted'}), 400

    _, pending_status = start_workflow(db, g.tenant_id, 'offer_letter', 'letter', lid, caller,
                                        remarks='Submitted for approval')
    db.letters.update_one({'_id': ObjectId(lid)}, {
        '$set': {'status': pending_status, 'updated_at': datetime.utcnow()},
        '$push': {'approval_history': {
            'user_id': str(caller['_id']), 'user_name': caller.get('name', ''),
            'action': 'submit', 'remarks': 'Submitted for approval',
            'timestamp': datetime.utcnow().isoformat(),
        }},
    })
    return jsonify({'message': 'Submitted for approval'})


@letters_bp.route('/<lid>/hr-action', methods=['POST'])
@tenant_scoped
def hr_action(lid):
    db     = get_db()
    uid    = get_jwt_identity()
    caller = g.caller

    l = db.letters.find_one({'_id': ObjectId(lid)})
    if not l: return jsonify({'error': 'Letter not found'}), 404

    instance = get_instance_for_entity(db, 'letter', lid)
    if not instance:
        return jsonify({'error': f"Cannot act on status '{l['status']}' — no approval in progress"}), 400

    data    = request.json or {}
    act     = data.get('action')
    remarks = data.get('remarks', '').strip()
    edits   = data.get('edits', {})

    if act not in ('approve', 'reject'):
        return jsonify({'error': "action must be 'approve' or 'reject'"}), 400

    try:
        new_status = advance_workflow(
            db, g.tenant_id, instance, act, caller,
            g.caller_permissions, caller.get('role_id'), remarks=remarks,
        )
    except WorkflowError as e:
        return jsonify({'error': str(e)}), 400

    ops = {
        '$set':  {'status': new_status, 'updated_at': datetime.utcnow()},
        '$push': {'approval_history': {
            'user_id': uid, 'user_name': caller.get('name', ''),
            'role': caller.get('role'), 'action': act,
            'from': l['status'], 'to': new_status,
            'remarks': remarks, 'timestamp': datetime.utcnow().isoformat(),
        }},
    }

    # Final-approval-only actions (doc regeneration, employee record sync):
    # only run once the letter is fully approved, not on an intermediate
    # stage's approve in a multi-stage chain.
    is_final_approval = act == 'approve' and new_status == 'approved'

    if is_final_approval:
        hr_sig       = data.get('hr_signature', '')
        chairman_sig = data.get('chairman_signature', '')
        new_ctx = {**l.get('context', {}), **edits, 'date': datetime.now().strftime('%d-%m-%Y')}
        if hr_sig:       new_ctx['hr_signature']       = hr_sig
        if chairman_sig: new_ctx['chairman_signature'] = chairman_sig

        tmpl = db.templates.find_one({'_id': ObjectId(l['template_id'])})
        if tmpl and tmpl.get('gridfs_id'):
            try:
                tmp_dir   = tempfile.mkdtemp()
                tmpl_path = _get_template_path(tmpl, tmp_dir)
                generate_letter_docx(tmpl_path, new_ctx, l['docx_path'])
                pr = generate_letter_pdf(l['docx_path'], l.get('pdf_path', l['docx_path'].replace('.docx', '.pdf')))
                docx_gid = save_file_to_gridfs(l['docx_path'], os.path.basename(l['docx_path']))
                pdf_gid  = save_file_to_gridfs(pr, os.path.basename(pr)) if pr else l.get('pdf_gridfs_id')
                ops['$set']['context']        = new_ctx
                ops['$set']['pdf_path']       = pr
                ops['$set']['docx_gridfs_id'] = docx_gid
                ops['$set']['pdf_gridfs_id']  = pdf_gid
                ops['$set']['edited_by_hr_head'] = True
            except Exception as e:
                log.warning(f'Inline edit doc regen failed: {e}')
            finally:
                shutil.rmtree(tmp_dir, ignore_errors=True)

    if is_final_approval:
        final_ctx = ops['$set'].get('context', l.get('context', {}))
        emp_update = {}
        if edits.get('joining_date') or final_ctx.get('joining_date'):
            emp_update['joining_date'] = edits.get('joining_date') or final_ctx.get('joining_date')
        if edits.get('designation') or final_ctx.get('designation'):
            emp_update['designation'] = edits.get('designation') or final_ctx.get('designation')
        if edits.get('department') or final_ctx.get('department'):
            emp_update['department'] = edits.get('department') or final_ctx.get('department')
        if emp_update:
            emp_update['updated_at'] = datetime.utcnow()
            try:
                db.employees.update_one({'_id': ObjectId(l['employee_id'])}, {'$set': emp_update})
            except Exception as e:
                log.warning(f'Employee record sync failed: {e}')

    db.letters.update_one({'_id': ObjectId(lid)}, ops)
    return jsonify({'message': f'Letter {act}d', 'new_status': new_status})


def _embed_signature_in_pdf(pdf_path: str, signature_b64: str) -> str:
    try:
        from pypdf import PdfWriter, PdfReader
        from reportlab.pdfgen import canvas as rl_canvas
        from PIL import Image

        header, _, b64data = signature_b64.partition(',')
        img_bytes = base64.b64decode(b64data if b64data else signature_b64)
        img = Image.open(io.BytesIO(img_bytes)).convert('RGBA')

        data = img.getdata()
        new_data = []
        for r, g, b, a in data:
            if r > 230 and g > 230 and b > 230:
                new_data.append((r, g, b, 0))
            else:
                new_data.append((r, g, b, a))
        img.putdata(new_data)

        png_buf = io.BytesIO()
        img.save(png_buf, format='PNG')
        png_buf.seek(0)

        reader = PdfReader(pdf_path)
        last_page = reader.pages[-1]
        page_w = float(last_page.mediabox.width)
        page_h = float(last_page.mediabox.height)

        sig_w_pt = 4 * 28.35
        aspect   = img.width / img.height if img.height else 1
        sig_h_pt = sig_w_pt / aspect
        if sig_h_pt > 2.5 * 28.35:
            sig_h_pt = 2.5 * 28.35
            sig_w_pt = sig_h_pt * aspect

        sig_x = page_w - sig_w_pt - 2 * 28.35
        sig_y = 2.5 * 28.35

        overlay_buf = io.BytesIO()
        c = rl_canvas.Canvas(overlay_buf, pagesize=(page_w, page_h))
        tmp_png = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
        tmp_png.write(png_buf.read())
        tmp_png.flush()
        c.drawImage(tmp_png.name, sig_x, sig_y, sig_w_pt, sig_h_pt, mask='auto')
        c.save()
        tmp_png.close()
        os.unlink(tmp_png.name)
        overlay_buf.seek(0)

        overlay_reader = PdfReader(overlay_buf)
        writer = PdfWriter()
        for i, page in enumerate(reader.pages):
            if i == len(reader.pages) - 1:
                page.merge_page(overlay_reader.pages[0])
            writer.add_page(page)

        signed_path = pdf_path.replace('.pdf', '_signed.pdf')
        with open(signed_path, 'wb') as out:
            writer.write(out)
        return signed_path

    except ImportError as e:
        log.warning(f'Signature embedding skipped missing library: {e}')
        return pdf_path
    except Exception as e:
        log.warning(f'Signature embedding failed: {e}')
        return pdf_path


@letters_bp.route('/<lid>/send-email', methods=['POST'])
@require_role('hr_head', 'admin')
def send_email(lid):
    db     = get_db()
    uid    = get_jwt_identity()
    caller = g.caller

    l = db.letters.find_one({'_id': ObjectId(lid)})
    if not l: return jsonify({'error': 'Letter not found'}), 404
    if l['status'] != 'approved':
        return jsonify({'error': 'Only approved letters can be emailed'}), 400

    data      = request.json or {}
    to_email  = data.get('to_email') or l.get('candidate_email', '')
    if not to_email:
        return jsonify({'error': 'Recipient email is required'}), 400

    ctx       = l.get('context', {})
    emp_name  = ctx.get('candidate_name') or ctx.get('employee_name') or 'Candidate'
    company   = ctx.get('company_name', 'Infopace Management Pvt Ltd')
    desig     = ctx.get('designation', '')
    sig_name  = ctx.get('hr_signatory_name', 'Aarpitha S')
    sig_desig = ctx.get('hr_signatory_designation', 'HR Associate')
    custom_msg = data.get('message', '').strip()

    body = f"""Dear {emp_name},

            Please find attached your Offer Letter from {company} for the position of {desig}.

            We kindly request you to review the document carefully and go through the terms and conditions mentioned in the letter.

            {f'Personal Note from HR:{chr(10)}{custom_msg}{chr(10)}' if custom_msg else ''}

            To confirm your acceptance, please sign and return a copy of the Offer Letter via email or submit it in person on your date of joining.

            If you have any questions or require further clarification, please feel free to reach out to us.

            We look forward to having you as part of the {company} team.

            Warm regards,

            {sig_name}
            {sig_desig}
            {company}
        """

    if not email_is_configured():
        return jsonify({'error': 'Email is not configured. Set RESEND_API_KEY, BREVO_API_KEY or '
                                 'SENDGRID_API_KEY (with EMAIL_FROM), or SMTP_HOST/SMTP_USER.'}), 500

    sent    = False
    err_msg = ''
    tmp_dir = None

    try:
        hr_sig        = data.get('hr_signature', '')
        chairman_sig  = data.get('chairman_signature', '')
        pdf_to_attach = None

        if hr_sig or chairman_sig:
            tmpl = db.templates.find_one({'_id': ObjectId(l['template_id'])})
            if tmpl and tmpl.get('gridfs_id'):
                try:
                    tmp_dir   = tempfile.mkdtemp()
                    tmpl_path = _get_template_path(tmpl, tmp_dir)
                    signed_ctx = dict(l.get('context', {}))
                    if hr_sig:       signed_ctx['hr_signature']       = hr_sig
                    if chairman_sig: signed_ctx['chairman_signature'] = chairman_sig
                    signed_docx = os.path.join(tmp_dir, 'signed.docx')
                    signed_pdf  = os.path.join(tmp_dir, 'signed.pdf')
                    generate_letter_docx(tmpl_path, signed_ctx, signed_docx)
                    result = generate_letter_pdf(signed_docx, signed_pdf)
                    if result and os.path.exists(result):
                        pdf_to_attach = result
                except Exception as sig_err:
                    log.warning(f'Signed PDF generation failed, falling back: {sig_err}')

        # Fallback: use GridFS PDF
        if not pdf_to_attach and l.get('pdf_gridfs_id'):
            tmp_dir = tmp_dir or tempfile.mkdtemp()
            pdf_tmp = os.path.join(tmp_dir, 'letter.pdf')
            fs = gridfs.GridFS(db, collection='files_fs')
            grid_out = fs.get(ObjectId(l['pdf_gridfs_id']))
            with open(pdf_tmp, 'wb') as f:
                f.write(grid_out.read())
            pdf_to_attach = pdf_tmp
        elif not pdf_to_attach and l.get('pdf_path') and os.path.exists(l['pdf_path']):
            pdf_to_attach = l['pdf_path']

        attachments = []
        if pdf_to_attach and os.path.exists(pdf_to_attach):
            with open(pdf_to_attach, 'rb') as f:
                attachments.append({
                    'filename': f'Offer_Letter_{emp_name.replace(" ", "_")}.pdf',
                    'content':  f.read(),
                    'mimetype': 'application/pdf',
                })

        # try_send_email picks the transport: the provider HTTP API where one
        # is configured (the only thing that works where outbound SMTP is
        # blocked), SMTP otherwise. Its error is the one shown to the HR user
        # who clicked send, so it says what to change rather than "failed".
        sent, err_msg = try_send_email(to_email, f'Offer Letter {desig} at {company}', body,
                                       from_label='Infopace Management Pvt Ltd - HR Team',
                                       attachments=attachments)

    except Exception as e:
        err_msg = f'Email failed: {str(e)}'
    finally:
        if tmp_dir:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    if not sent:
        return jsonify({'error': err_msg}), 500

    db.letters.update_one({'_id': ObjectId(lid)}, {
        '$set': {
            'status': 'issued',
            'signature_used': bool(data.get('hr_signature') or data.get('chairman_signature')),
            'candidate_email': to_email,
            'email_sent_at': datetime.utcnow().isoformat(),
            'updated_at': datetime.utcnow(),
        },
        '$push': {'approval_history': {
            'user_id': uid, 'user_name': caller.get('name', ''),
            'action': 'issued', 'from': 'approved', 'to': 'issued',
            'remarks': f'Offer letter emailed to {to_email}',
            'timestamp': datetime.utcnow().isoformat(),
        }},
    })

    return jsonify({'message': f'Offer letter successfully emailed to {to_email}',
                    'email_sent': True, 'to_email': to_email})


@letters_bp.route('/<lid>/confirm-join', methods=['POST'])
@tenant_scoped
def confirm_join(lid):
    db  = get_db()
    uid = get_jwt_identity()
    l   = db.letters.find_one({'_id': ObjectId(lid)})
    if not l: return jsonify({'error': 'Letter not found'}), 404
    if l['status'] not in ('approved', 'issued'):
        return jsonify({'error': 'Can only confirm joining for approved/issued letters'}), 400
    db.letters.update_one({'_id': ObjectId(lid)}, {
        '$set':  {'status': 'joined', 'join_confirmed_at': datetime.utcnow().isoformat(), 'updated_at': datetime.utcnow()},
        '$push': {'approval_history': {
            'user_id': uid, 'action': 'join_confirmed',
            'from': l['status'], 'to': 'joined',
            'remarks': 'Candidate confirmed readiness to join',
            'timestamp': datetime.utcnow().isoformat(),
        }},
    })
    return jsonify({'message': 'Joining confirmed. Click "Create ID" to generate login credentials.'})


@letters_bp.route('/<lid>/create-id', methods=['POST'])
@require_role('hr_head', 'admin')
def create_id(lid):
    db     = get_db()
    uid    = get_jwt_identity()
    caller = g.caller

    l = db.letters.find_one({'_id': ObjectId(lid)})
    if not l: return jsonify({'error': 'Letter not found'}), 404
    if l['status'] != 'joined':
        return jsonify({'error': 'Candidate must confirm joining first (status must be joined)'}), 400

    emp = db.employees.find_one({'_id': ObjectId(l['employee_id'])})
    if not emp: return jsonify({'error': 'Employee record not found'}), 404

    if db.users.find_one({'employee_ref': str(emp['_id'])}):
        return jsonify({'error': 'Login ID already created for this employee'}), 400

    data        = request.json or {}
    login_email = data.get('email') or l.get('candidate_email') or emp.get('email') or ''
    emp_code    = emp.get('employee_id', str(emp['_id']))
    manager_id  = data.get('manager_id', '')

    if not login_email:
        login_email = f"{emp_code.lower()}@company.com"

    from roles_service import build_user_role_fields
    from security_utils import generate_token, token_expiry
    from services.email_service import send_invite_email
    from audit import log_audit
    from feature_gating import check_seat_limit, SeatLimitExceeded

    company = current_app.db.companies.find_one({'_id': ObjectId(g.tenant_id)})
    try:
        check_seat_limit(current_app.db, db, g.tenant_id, company)
    except SeatLimitExceeded as e:
        return jsonify({'error': str(e)}), 403

    role_fields = build_user_role_fields(db, g.tenant_id, data.get('role', 'employee'))
    invite_token = generate_token()
    placeholder  = bcrypt.hashpw(generate_token().encode(), bcrypt.gensalt())

    user_res = db.users.insert_one({
        'name': emp.get('name', ''), 'email': login_email,
        'password': placeholder, **role_fields,
        'is_active': True, 'must_reset_password': True,
        'invite_token': invite_token, 'invite_expires_at': token_expiry(),
        'employee_ref': str(emp['_id']), 'emp_code': emp_code,
        'created_at': datetime.utcnow(), 'created_by': uid,
    })

    company_name = company.get('name', 'the company') if company else 'the company'
    frontend_url = os.getenv('FRONTEND_URL', 'http://localhost:3000')
    accept_url = f'{frontend_url}/#/accept-invite?token={invite_token}'
    emailed = send_invite_email(login_email, emp.get('name', ''), company_name, accept_url)
    log_audit(db, g.tenant_id, caller, 'user.invited', entity_type='user', entity_id=user_res.inserted_id,
              details={'email': login_email, 'via': 'offer_letter_create_id'})

    manager_name = ''
    if manager_id:
        mgr = db.users.find_one({'_id': ObjectId(manager_id)})
        manager_name = mgr.get('name', '') if mgr else ''

    db.employees.update_one({'_id': emp['_id']}, {'$set': {
        'employee_type': 'joining', 'login_created': True,
        'login_user_id': str(user_res.inserted_id),
        'login_email': login_email, 'updated_at': datetime.utcnow(),
        'visible': True,
        'manager_id':   manager_id,
        'manager_name': manager_name,
    }})

    db.letters.update_one({'_id': ObjectId(lid)}, {
        '$set':  {'status': 'id_created', 'login_created': True,
                  'login_user_id': str(user_res.inserted_id), 'updated_at': datetime.utcnow()},
        '$push': {'approval_history': {
            'user_id': uid, 'user_name': caller.get('name', ''),
            'action': 'id_created', 'remarks': f'Login: {login_email}',
            'timestamp': datetime.utcnow().isoformat(),
        }},
    })

    resp = {
        'message': 'Employee login ID created and invite ' + ('emailed' if emailed else 'link generated — SMTP not configured'),
        'login_email': login_email, 'emp_code': emp_code,
        'user_id': str(user_res.inserted_id),
    }
    if not emailed:
        resp['invite_url'] = accept_url
    return jsonify(resp), 201


@letters_bp.route('/<lid>/send-welcome-email', methods=['POST'])
@require_role('hr_head', 'admin')
def send_welcome_email(lid):
    """Sends a plain welcome note. Login credentials are never included
    here — they go out exactly once, via the invite email sent by
    create-id (or resent below if the invite is still unaccepted)."""
    db     = get_db()
    caller = g.caller

    l = db.letters.find_one({'_id': ObjectId(lid)})
    if not l: return jsonify({'error': 'Letter not found'}), 404

    data         = request.json or {}
    to_email     = data.get('email', '')
    emp_name     = data.get('employee_name') or l.get('employee_name', 'Employee')
    frontend_url = os.getenv('FRONTEND_URL', 'http://localhost:3000')

    if not to_email:
        return jsonify({'error': 'Email is required'}), 400

    company = current_app.db.companies.find_one({'_id': ObjectId(g.tenant_id)})
    company_name = company.get('name', 'the company') if company else 'the company'

    user = db.users.find_one({'email': to_email})
    pending_invite = user and user.get('invite_token') and user.get('invite_expires_at', datetime.min) > datetime.utcnow()

    if pending_invite:
        accept_url = f'{frontend_url}/#/accept-invite?token={user["invite_token"]}'
        body = f"""Dear {emp_name},

Thank you for joining us! We are excited to have you on board.

Set your password to activate your account: {accept_url}

Document Instructions:
  - Upload soft copies of all required documents through the portal.
  - Bring hard copies on your joining date for submission to HR.

Regards,
{company_name} HR Team
"""
    else:
        body = f"""Dear {emp_name},

Thank you for joining us! We are excited to have you on board.

Please log in and complete your profile at: {frontend_url}/#/profile

Document Instructions:
  - Upload soft copies of all required documents through the portal.
  - Bring hard copies on your joining date for submission to HR.

Regards,
{company_name} HR Team
"""
    from services.email_service import send_email
    sent = send_email(to_email, f'Welcome to the Team, {emp_name}!', body, from_label=f'{company_name} HR Team')
    if not sent:
        return jsonify({'error': 'SMTP not configured'}), 500
    return jsonify({'message': 'Welcome email sent successfully'})


@letters_bp.route('/<lid>/download', methods=['GET'])
@tenant_scoped
def download(lid):
    db  = get_db()
    fmt = request.args.get('format', 'docx')
    l   = db.letters.find_one({'_id': ObjectId(lid)})
    if not l: return jsonify({'error': 'Not found'}), 404
    if fmt == 'pdf' and l.get('status') not in ('approved', 'issued', 'joined', 'id_created'):
        return jsonify({'error': 'PDF only available for approved/issued letters'}), 403

    # Serve from GridFS first
    if fmt == 'pdf' and l.get('pdf_gridfs_id'):
        return serve_from_gridfs(l['pdf_gridfs_id'],
                                 download_name=os.path.basename(l.get('pdf_path', 'letter.pdf')),
                                 mimetype='application/pdf')
    if l.get('docx_gridfs_id'):
        return serve_from_gridfs(l['docx_gridfs_id'],
                                 download_name=os.path.basename(l.get('docx_path', 'letter.docx')),
                                 mimetype='application/vnd.openxmlformats-officedocument.wordprocessingml.document')

    # Fallback: disk
    if fmt == 'pdf' and l.get('pdf_path') and os.path.exists(l['pdf_path']):
        return send_file(l['pdf_path'], as_attachment=True, download_name=os.path.basename(l['pdf_path']))
    if l.get('docx_path') and os.path.exists(l['docx_path']):
        return send_file(l['docx_path'], as_attachment=True, download_name=os.path.basename(l['docx_path']))

    return jsonify({'error': 'File not found'}), 404


@letters_bp.route('/<lid>', methods=['DELETE'])
@require_role(*DELETE_ROLES)
def delete_letter(lid):
    db     = get_db()
    uid    = get_jwt_identity()
    caller = g.caller
    l = db.letters.find_one({'_id': ObjectId(lid)})
    if not l: return jsonify({'error': 'Letter not found'}), 404
    if l.get('status') not in DELETABLE_STATUSES:
        return jsonify({'error': f"Cannot delete a '{l['status']}' letter. Only draft/rejected can be deleted."}), 400

    # Delete from GridFS
    delete_from_gridfs(l.get('docx_gridfs_id'))
    delete_from_gridfs(l.get('pdf_gridfs_id'))

    # Delete from disk if present
    for pk in ('docx_path', 'pdf_path'):
        fp = l.get(pk)
        if fp and os.path.exists(fp):
            try: os.remove(fp)
            except OSError: pass

    db.letters.delete_one({'_id': ObjectId(lid)})
    return jsonify({'message': f"Deleted by {caller.get('name', uid)} at {datetime.utcnow().isoformat()}"})