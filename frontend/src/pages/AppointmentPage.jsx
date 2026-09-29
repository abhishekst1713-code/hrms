/**
 * AppointmentPage.jsx — Final Enhanced Version
 *
 * Fixes applied from screenshots:
 *  ✓ Image 1 (HR Review): Now shows full Form Q table, not bare 4-field summary
 *  ✓ Image 2 (List): Tab bar cleaned up, better spacing
 *  ✓ No {{placeholder}} text visible anywhere
 *  ✓ Date fields use calendar picker (type="date")
 *  ✓ Employee: 3-step flow with Form Q preview before submit
 *  ✓ HR: Full Form Q table preview + approve/reject
 *  ✓ ApprovalsPage section also updated with Form Q preview for HR
 */

import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

// ─── Injected CSS ─────────────────────────────────────────────────────────────
const STYLES = `
  input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(0) brightness(0.4); cursor: pointer; opacity: 1; }

  .tab-bar {
    display: flex;
    gap: 4px;
    background: var(--surface-2);
    border-radius: 10px;
    padding: 4px;
    width: fit-content;
  }
  .tab-btn {
    padding: 7px 16px;
    border-radius: 7px;
    border: none;
    background: transparent;
    color: var(--text-dim);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all .15s;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .tab-btn:hover {
    background: var(--surface);
    color: var(--text);
  }
  .tab-btn.active {
    background: var(--surface);
    color: var(--text);
    font-weight: 700;
    box-shadow: 0 1px 4px rgba(0,0,0,.15);
  }

  .ao-field { background: var(--surface); border: 1.5px solid var(--border); border-radius: 10px; padding: 18px 20px; transition: border-color .15s; margin-bottom: 0; }
  .ao-field:focus-within { border-color: var(--accent); }
  .ao-field-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--text-dim); font-family: monospace; margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
  .ao-field-num { background: var(--surface-2); border-radius: 4px; padding: 1px 7px; font-size: 10px; color: var(--text-dim); }
  .ao-field-input { width: 100%; background: transparent; border: none; outline: none; font-size: 14px; color: var(--text); font-family: inherit; resize: vertical; line-height: 1.6; }
  .fq-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .fq-table td { padding: 9px 14px; border: 1px solid var(--border); vertical-align: top; line-height: 1.55; }
  .fq-table .fq-hdr td { background: var(--surface-2); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .8px; color: var(--text-dim); }
  .fq-table .fq-sl { width: 36px; text-align: center; font-family: monospace; font-size: 11px; color: var(--text-dim); }
  .fq-table .fq-part { width: 36%; font-size: 12px; color: var(--text-dim); }
  .fq-table .fq-val { font-weight: 500; white-space: pre-wrap; word-break: break-word; }
  .fq-table .fq-val.fq-empty { color: var(--text-dim); font-style: italic; font-weight: 400; opacity: .5; }
  .ao-pill { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; font-family: monospace; }
`;

// ─── Status config ────────────────────────────────────────────────────────────
const STATUS = {
  draft: { label: 'Draft', cls: 'badge-gray' },
  pending_hr_head: { label: 'Pending HR Head', cls: 'badge-amber' },
  approved: { label: 'Approved', cls: 'badge-green' },
  rejected: { label: 'Rejected', cls: 'badge-red' },
  draft: { label: 'Draft', cls: 'badge-gray' },
};

// ─── Form Q row definitions ───────────────────────────────────────────────────
const FORM_Q_ROWS = [
  { sl: '1', part: 'Name And Address of The Establishment', key: 'establishment_name', multi: true },
  { sl: '2', part: 'Name And Address of The Employer', key: 'employer_name', multi: true },
  { sl: '3', part: 'Name of The Employee', key: 'employee_name' },
  { sl: '4', part: 'Postal Address of The Employee', key: 'postal_address', multi: true },
  { sl: '5', part: 'Permanent Address of The Employee', key: 'permanent_address', multi: true },
  { sl: '6', part: "Father's / Husband's Name", key: 'guardian_name' },
  { sl: '7', part: 'Date of Birth', key: 'date_of_birth', date: true },
  { sl: '8', part: 'Date of Entry into Employment', key: 'date_of_joining', date: true },
  { sl: '9', part: 'Designation', key: 'designation' },
  { sl: '10', part: 'Nature of Work Entrusted', key: 'nature_of_work', multi: true },
  { sl: '11', part: 'Serial Number in The Register of Employment', key: 'register_serial_no' },
  { sl: '12', part: 'Rates of Wages Payable', key: '__wages__', wages: true },
];

// All fillable field definitions (used in Step 2)
const ALL_FIELDS = [
  { key: 'establishment_name', label: 'Name & Address of the Establishment', multi: true, rows: 3 },
  { key: 'employer_name', label: 'Name & Address of the Employer', multi: true, rows: 3 },
  { key: 'employee_name', label: 'Name of the Employee', profile: 'name' },
  { key: 'postal_address', label: 'Postal Address of the Employee', multi: true, rows: 3, profile: 'address' },
  { key: 'permanent_address', label: 'Permanent Address of the Employee', multi: true, rows: 3, profile: 'address' },
  { key: 'guardian_name', label: "Father's / Husband's Name", profile: 'father_name' },
  { key: 'date_of_birth', label: 'Date of Birth', date: true, profile: 'date_of_birth' },
  { key: 'date_of_joining', label: 'Date of Entry into Employment', date: true, profile: 'joining_date' },
  { key: 'designation', label: 'Designation', profile: 'designation' },
  { key: 'nature_of_work', label: 'Nature of Work Entrusted', multi: true, rows: 3 },
  { key: 'register_serial_no', label: 'Serial No. in Register of Employment', profile: 'employee_id' },
  { key: 'wage_basic', label: 'Basic Wage (₹)' },
  { key: 'wage_vda', label: 'VDA (₹)' },
  { key: 'wage_other_allowances', label: 'Other Allowances (if any)' },
  { key: 'wage_total', label: 'Total Wages (₹)' },
  { key: 'place', label: 'Place of Issue', profile: 'work_location' },
];

// Auto-set server side — never shown as inputs
const AUTO_KEYS = new Set(['date', 'reference_number', 'employee_id', 'employee_id_code', 'approval_date']);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function Badge({ status }) {
  const c = STATUS[status] || { label: status, cls: 'badge-gray' };
  return <span className={`badge ${c.cls}`}>{c.label}</span>;
}

function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return d; }
}

function fmtDisp(d) {
  if (!d) return '—';
  try { const [y, m, day] = d.split('-'); return `${day}-${m}-${y}`; } catch { return d; }
}

// ─── Step Bar ─────────────────────────────────────────────────────────────────
const STEPS = [
  { key: 'template', label: 'Select Template' },
  { key: 'fields', label: 'Fill Details' },
  { key: 'preview', label: 'Preview & Submit' },
];

function StepBar({ current }) {
  const idx = STEPS.findIndex(s => s.key === current);
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 28 }}>
      {STEPS.map((s, i) => {
        const done = i < idx, active = i === idx;
        return (
          <React.Fragment key={s.key}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, flex: 1 }}>
              <div style={{
                width: 34, height: 34, borderRadius: '50%',
                background: done ? 'var(--green)' : active ? 'var(--accent)' : 'var(--surface-2)',
                color: (done || active) ? '#fff' : 'var(--text-dim)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: 14,
                boxShadow: active ? '0 0 0 4px rgba(99,102,241,.18)' : 'none',
                transition: 'all .2s',
              }}>
                {done ? '✓' : i + 1}
              </div>
              <div style={{ fontSize: 11, fontWeight: active ? 700 : 500, textAlign: 'center', whiteSpace: 'nowrap', color: active ? 'var(--text)' : done ? 'var(--green)' : 'var(--text-dim)' }}>
                {s.label}
              </div>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{ flex: 2, height: 2, marginBottom: 22, background: done ? 'var(--green)' : 'var(--border)', transition: 'background .3s' }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Form Q Preview Table ─────────────────────────────────────────────────────
// Used in Step 3 (employee) and HR review panel — mirrors official form layout
function FormQTable({ fields }) {
  const wageVal = [
    fields.wage_basic && `I) Basic: ₹${fields.wage_basic}`,
    fields.wage_vda && `II) VDA: ₹${fields.wage_vda}`,
    fields.wage_other_allowances && `III) Other Allowances: ₹${fields.wage_other_allowances}`,
    fields.wage_total && `Total: ₹${fields.wage_total}`,
  ].filter(Boolean).join('\n');

  return (
    <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
      {/* Form Q heading */}
      <div style={{ textAlign: 'center', padding: '14px 16px 10px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
        <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: .5 }}>Form 'Q'</div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>[See Rule 24(9-A)] &nbsp;·&nbsp; Appointment Order</div>
      </div>
      <table className="fq-table"><tbody>
        <tr className="fq-hdr"><td className="fq-sl">Sl.</td><td className="fq-part">Particulars</td><td>Details</td></tr>
        {FORM_Q_ROWS.map(row => {
          let val = '';
          if (row.wages) {
            val = wageVal;
          } else {
            val = fields[row.key] || '';
            if (row.date && val) val = fmtDisp(val);
          }
          return (
            <tr key={row.sl}>
              <td className="fq-sl">{row.sl}</td>
              <td className="fq-part">{row.part}</td>
              <td className={`fq-val${!val ? ' fq-empty' : ''}`}>{val || '—'}</td>
            </tr>
          );
        })}
      </tbody></table>
      {/* Footer row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, borderTop: '1px solid var(--border)', fontSize: 13 }}>
        <div style={{ padding: '9px 14px', borderRight: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'monospace', textTransform: 'uppercase', marginBottom: 3 }}>Place</div>
          <div style={{ fontWeight: 500 }}>{fields.place || '—'}</div>
        </div>
        <div style={{ padding: '9px 14px' }}>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'monospace', textTransform: 'uppercase', marginBottom: 3 }}>Date</div>
          <div style={{ fontWeight: 500 }}>{fields.date ? fmtDisp(fields.date) : new Date().toLocaleDateString('en-IN')}</div>
        </div>
      </div>
    </div>
  );
}

function TemplatePreview({ templateId, fields }) {
  const [pdfUrl, setPdfUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true); setError('');
    axios.post('/api/appointment-orders/preview-template',
      { template_id: templateId, fields },
      { responseType: 'blob' }
    )
      .then(r => {
        const url = URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
        setPdfUrl(url);
      })
      .catch(() => setError('Could not generate preview.'))
      .finally(() => setLoading(false));

    return () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); };
  }, []);

  if (loading) return (
    <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-dim)' }}>
      ⏳ Generating document preview…
    </div>
  );
  if (error) return (
    <div className="alert alert-error">{error}</div>
  );
  return (
    <iframe src={pdfUrl} style={{ width: '100%', height: 500, border: '1px solid var(--border)', borderRadius: 8 }} />
  );
}

// ─── Create Modal (Employee/Manager) ─────────────────────────────────────────
// ─── Create Modal (HR only) ───────────────────────────────────────────────────
function CreateModal({ onClose, onCreated }) {
  const [step, setStep] = useState('template');
  const [templates, setTemplates] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loadingTpl, setLoadingTpl] = useState(true);
  const [selTpl, setSelTpl] = useState(null);
  const [selEmp, setSelEmp] = useState(null);
  const [fields, setFields] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    axios.get('/api/templates/?type=appointment_order')
      .then(r => setTemplates(r.data.filter(t => t.is_active)))
      .catch(() => setTemplates([]))
      .finally(() => setLoadingTpl(false));
    axios.get('/api/employees/')
      .then(r => setEmployees(r.data))
      .catch(() => setEmployees([]));
  }, []);

  function TemplatePreview({ templateId, fields }) {
    const [pdfUrl, setPdfUrl] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
      setLoading(true); setError('');
      axios.post('/api/appointment-orders/preview-template',
        { template_id: templateId, fields },
        { responseType: 'blob' }
      )
        .then(r => {
          const url = URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
          setPdfUrl(url);
        })
        .catch(() => setError('Could not generate preview.'))
        .finally(() => setLoading(false));

      return () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); };
    }, []);

    if (loading) return (
      <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-dim)' }}>
        ⏳ Generating document preview…
      </div>
    );
    if (error) return (
      <div className="alert alert-error">{error}</div>
    );
    return (
      <iframe src={pdfUrl} style={{ width: '100%', height: 500, border: '1px solid var(--border)', borderRadius: 8 }} />
    );
  }
  const selectTemplate = (tpl) => {
    setSelTpl(tpl);
    const phs = (tpl.placeholders || []).filter(p => !AUTO_KEYS.has(p));
    const init = {};
    phs.forEach(p => { init[p] = ''; });
    // Auto-fill from selected employee
    if (selEmp) {
      if ('employee_name' in init) init.employee_name = selEmp.name || '';
      if ('designation' in init) init.designation = selEmp.designation || '';
      if ('date_of_joining' in init) init.date_of_joining = selEmp.joining_date || '';
      if ('register_serial_no' in init) init.register_serial_no = selEmp.employee_id || '';
    }
    setFields(init);
    setStep('fields');
  };

  // Only show fields that are in the template placeholders
  const visibleFields = ALL_FIELDS.filter(f => f.key in fields);
  const filled = visibleFields.filter(f => (fields[f.key] || '').trim()).length;
  const allFilled = filled === visibleFields.length && visibleFields.length > 0;

  const set = (k, v) => setFields(prev => ({ ...prev, [k]: v }));

  const goPreview = () => {
    const empty = visibleFields.filter(f => !(fields[f.key] || '').trim()).map(f => f.label);
    if (empty.length) { setError(`Please fill: ${empty.slice(0, 3).join(', ')}${empty.length > 3 ? ` + ${empty.length - 3} more` : ''}`); return; }
    setError(''); setStep('preview');
  };

  const submitToHR = async () => {
    if (!selEmp) { setError('Please select an employee first'); return; }
    setError(''); setSubmitting(true);
    try {
      const res = await axios.post('/api/appointment-orders/', {
        template_id: selTpl._id,
        employee_id: selEmp._id,
        fields,
      });
      await axios.post(`/api/appointment-orders/${res.data.id}/submit`);
      onCreated();
    } catch (e) {
      setError(e.response?.data?.error || 'Submission failed');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <style>{STYLES}</style>
      <div className="modal" style={{ maxWidth: 680, width: '96%', maxHeight: '92vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            {/* <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1.5, fontFamily: 'monospace', marginBottom: 4 }}>Form Q · [See Rule 24(9-A)]</div> */}
            <h2 style={{ margin: 0, fontSize: 21 }}>New Appointment Order</h2>
          </div>
          <button className="btn-icon" onClick={onClose} style={{ fontSize: 18, marginTop: 4 }}>✕</button>
        </div>

        <StepBar current={step} />
        {error && <div className="alert alert-error" style={{ marginBottom: 20 }}>{error}</div>}

        {/* ── STEP 1: SELECT TEMPLATE ─────────────────────────────────── */}
        {/* ── STEP 1: SELECT EMPLOYEE + TEMPLATE ──────────────────────── */}
        {step === 'template' && (
          <div>
            {/* Employee selector */}
            <div className="form-group" style={{ marginBottom: 20 }}>
              <label className="form-label">Select Employee *</label>
              <select
                value={selEmp?._id || ''}
                onChange={e => {
                  const emp = employees.find(em => em._id === e.target.value);
                  setSelEmp(emp || null);
                  setSelTpl(null); // reset template when employee changes
                }}
                style={{ width: '100%' }}
              >
                <option value=''>— Choose an employee —</option>
                {employees.map(emp => (
                  <option key={emp._id} value={emp._id}>
                    {emp.name} · {emp.employee_id} · {emp.designation}
                  </option>
                ))}
              </select>
            </div>

            {/* Selected employee preview */}
            {selEmp && (
              <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 16px', marginBottom: 20, fontSize: 12 }}>
                <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 8 }}>Employee Details</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
                  {[
                    ['Name', selEmp.name],
                    ['ID', selEmp.employee_id],
                    ['Designation', selEmp.designation],
                    ['Department', selEmp.department],
                    ['Joining Date', selEmp.joining_date],
                  ].filter(([, v]) => v).map(([k, v]) => (
                    <div key={k}>
                      <span style={{ color: 'var(--text-dim)' }}>{k}: </span>
                      <span style={{ fontWeight: 500 }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Template selector */}
            {loadingTpl ? (
              <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-dim)' }}>Loading templates…</div>
            ) : templates.length === 0 ? (
              <div className="empty-state">
                <div style={{ fontSize: 36, marginBottom: 10 }}>📋</div>
                <div style={{ fontWeight: 600 }}>No appointment order templates</div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>Ask Admin to upload an Appointment Order template in the Templates section.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {!selEmp && (
                  <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-dim)', fontSize: 13 }}>
                    ↑ Select an employee first to choose a template
                  </div>
                )}
                {selEmp && templates.map(tpl => {
                  const fillable = (tpl.placeholders || []).filter(p => !AUTO_KEYS.has(p)).length;
                  return (
                    <div key={tpl._id} onClick={() => selectTemplate(tpl)}
                      style={{ background: 'var(--surface)', border: '2px solid var(--border)', borderRadius: 12, padding: '18px 22px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, transition: 'all .15s' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.background = 'var(--accent-dim)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--surface)'; }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                          <span style={{ fontSize: 18 }}>📄</span>
                          <span style={{ fontWeight: 700, fontSize: 15 }}>{tpl.name}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'monospace' }}>v{tpl.version}</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{fillable} field{fillable !== 1 ? 's' : ''} to complete</div>
                      </div>
                      <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>→</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── STEP 2: FILL FIELDS ─────────────────────────────────────── */}
        {step === 'fields' && selTpl && (
          <div>
            {/* Progress */}
            <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '11px 16px', marginBottom: 22, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 13 }}>
                <strong style={{ color: allFilled ? 'var(--green)' : 'var(--accent)' }}>{filled}</strong>
                <span style={{ color: 'var(--text-dim)' }}> / {visibleFields.length} fields completed</span>
              </div>
              <div style={{ height: 6, width: 140, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 3, width: `${visibleFields.length ? (filled / visibleFields.length) * 100 : 0}%`, background: allFilled ? 'var(--green)' : 'var(--accent)', transition: 'width .3s' }} />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {visibleFields.map((f, idx) => (
                <div key={f.key} className="ao-field">
                  <div className="ao-field-label">
                    <span className="ao-field-num">{idx + 1}</span>
                    {f.label}
                    <span style={{ color: 'var(--red)', marginLeft: 2 }}>*</span>
                  </div>
                  {f.date ? (
                    <input type="date" className="ao-field-input" value={fields[f.key] || ''} onChange={e => set(f.key, e.target.value)} style={{ cursor: 'pointer' }} />
                  ) : f.multi ? (
                    <textarea className="ao-field-input" rows={f.rows || 3} value={fields[f.key] || ''} onChange={e => set(f.key, e.target.value)} />
                  ) : (
                    <input type="text" className="ao-field-input" value={fields[f.key] || ''} onChange={e => set(f.key, e.target.value)} />
                  )}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              <button className="btn btn-secondary" onClick={() => setStep('template')}>← Back</button>
              <button className="btn btn-primary" onClick={goPreview} disabled={!allFilled} style={{ flex: 1 }}>
                Preview Form Q →
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: FORM Q PREVIEW ──────────────────────────────────── */}
        {step === 'preview' && selTpl && (
          <div>
            <TemplatePreview templateId={selTpl._id} fields={fields} />

            <div style={{ background: 'rgba(99,102,241,.07)', border: '1px solid rgba(99,102,241,.2)', borderRadius: 8, padding: '12px 16px', margin: '20px 0', fontSize: 13 }}>
              <strong>✉ Submit to HR Head for approval</strong>
              <div style={{ marginTop: 4, color: 'var(--text-dim)' }}>Once approved, you'll be able to download your signed appointment order as PDF or DOCX.</div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-secondary" onClick={() => setStep('fields')}>← Edit Details</button>
              <button className="btn btn-primary" onClick={submitToHR} disabled={submitting} style={{ flex: 1 }}>
                {submitting ? 'Submitting…' : '✔ Submit for HR Approval'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── HR Review Panel ──────────────────────────────────────────────────────────
// Shows full Form Q table + approve/reject workflow
function HRReviewPanel({ order, onClose, onDone, readOnly = false }) {
  const [tab, setTab] = useState('preview');  // 'preview' | 'action'
  const [action, setAction] = useState('');
  const [remarks, setRemarks] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pdfUrl, setPdfUrl] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(true);
  const [pdfError, setPdfError] = useState('');
  const d = order.details || {};

  useEffect(() => {
    setPdfLoading(true); setPdfError('');
    axios.get(`/api/appointment-orders/${order._id}/preview`, { responseType: 'blob' })
      .then(r => {
        const url = URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
        setPdfUrl(url);
      })
      .catch(() => setPdfError('Could not load document preview.'))
      .finally(() => setPdfLoading(false));
    return () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); };
  }, [order._id]);

  const submit = async () => {
    if (action === 'reject' && !remarks.trim()) { setError('Rejection reason is required'); return; }
    setLoading(true); setError('');
    try {
      await axios.post(`/api/appointment-orders/${order._id}/hr-action`, { action, remarks });
      onDone();
    } catch (e) {
      setError(e.response?.data?.error || 'Action failed');
      setLoading(false);
    }
  };

  const alreadyDone = ['approved', 'rejected'].includes(order.status);

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <style>{STYLES}</style>
      <div className="modal" style={{ maxWidth: 740, width: '96%', maxHeight: '92vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 4 }}>Form Q · HR Head Review</div>
            <h2 style={{ margin: 0, fontSize: 20 }}>Appointment Order</h2>
            <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600, color: 'var(--text)' }}>{order.employee_name || d.employee_name || '—'}</span>
              <span>·</span>
              <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{order.reference_number}</span>
              <span>·</span>
              <Badge status={order.status} />
            </div>
          </div>
          <button className="btn-icon" onClick={onClose} style={{ fontSize: 18, marginTop: 4 }}>✕</button>
        </div>

        {/* Sub-tabs — hidden for read-only (employee) view */}
        {!readOnly && (
          <div style={{ display: 'flex', gap: 4, marginBottom: 22, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 4, width: 'fit-content' }}>
            {[['preview', '📋 Form Preview'], ['action', alreadyDone ? '✓ Decision' : '⚖ Approve / Reject']].map(([k, label]) => (
              <button key={k} className={`btn btn-sm ${tab === k ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setTab(k)} style={{ fontSize: 12 }}>{label}</button>
            ))}
          </div>
        )}

        {/* ── Form Preview Tab ── */}
        {tab === 'preview' && (
          <div>
            {pdfLoading && (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-dim)', fontSize: 13 }}>
                ⏳ Generating document preview…
              </div>
            )}
            {pdfError && !pdfLoading && (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--red)', fontSize: 13 }}>
                ⚠ {pdfError}
              </div>
            )}
            {pdfUrl && !pdfLoading && (
              <iframe
                src={pdfUrl}
                style={{ width: '100%', height: 520, border: '1px solid var(--border)', borderRadius: 8 }}
                title="Appointment Order Preview"
              />
            )}

            {/* Approval trail */}
            {(order.approval_history || []).length > 0 && (
              <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', fontFamily: 'monospace', color: 'var(--text-dim)', marginBottom: 10 }}>Workflow History</div>
                {order.approval_history.map((h, i) => (
                  <div key={i} style={{ display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                    <span style={{ fontFamily: 'monospace', minWidth: 80, color: h.action === 'approve' ? 'var(--green)' : h.action === 'reject' ? 'var(--red)' : 'var(--accent)' }}>{h.action}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{h.user_name || h.role || '—'}</span>
                    <span style={{ color: 'var(--text-dim)', fontSize: 11, marginLeft: 'auto' }}>{h.timestamp?.slice(0, 10)}</span>
                    {h.remarks && <span style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>"{h.remarks}"</span>}
                  </div>
                ))}
              </div>
            )}

            {!alreadyDone && !readOnly && (
              <div style={{ marginTop: 20 }}>
                <button className="btn btn-primary" onClick={() => setTab('action')} style={{ width: '100%' }}>
                  Proceed to Approve / Reject →
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Action Tab ── */}
        {tab === 'action' && (
          <div>
            {order.status === 'approved' ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--green)' }}>
                <div style={{ fontSize: 48, marginBottom: 10 }}>✓</div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>This order has been approved</div>
                <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 6 }}>The employee can now download their appointment document.</div>
              </div>
            ) : order.status === 'rejected' ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--red)' }}>
                <div style={{ fontSize: 48, marginBottom: 10 }}>✗</div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>This order has been rejected</div>
              </div>
            ) : (
              <>
                {/* Quick summary grid */}
                <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '16px 20px', marginBottom: 20 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px 20px', fontSize: 13 }}>
                    {[
                      ['Employee', order.employee_name || d.employee_name],
                      ['Designation', d.designation],
                      ['Joining', d.date_of_joining ? fmtDisp(d.date_of_joining) : '—'],
                      ['Employee ID', d.register_serial_no],
                      ['Reference', order.reference_number],
                      ['Submitted', fmtDate(order.created_at)],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', fontFamily: 'monospace', marginBottom: 2 }}>{k}</div>
                        <div style={{ fontWeight: 500 }}>{v || '—'}</div>
                      </div>
                    ))}
                  </div>

                  {(d.wage_basic || d.wage_total) && (
                    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 10, textTransform: 'uppercase', fontFamily: 'monospace', color: 'var(--text-dim)', marginBottom: 8 }}>Wages</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, fontSize: 13 }}>
                        {[['Basic', d.wage_basic], ['VDA', d.wage_vda], ['Other', d.wage_other_allowances], ['Total', d.wage_total]].map(([k, v]) => (
                          <div key={k}>
                            <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'monospace' }}>{k}</div>
                            <div style={{ fontWeight: 600 }}>₹{v || '—'}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

                {/* Approve / Reject toggle */}
                <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                  {['approve', 'reject'].map(a => (
                    <button key={a}
                      className={`btn ${action === a ? (a === 'approve' ? 'btn-primary' : 'btn-danger') : 'btn-secondary'}`}
                      onClick={() => setAction(a)} style={{ flex: 1, padding: '12px 0' }}>
                      {a === 'approve' ? '✓ Approve' : '✗ Reject'}
                    </button>
                  ))}
                </div>

                {action && (
                  <>
                    <div className="form-group" style={{ marginBottom: 16 }}>
                      <label className="form-label">
                        Remarks
                        {action === 'reject' && <span style={{ color: 'var(--red)', fontSize: 10, marginLeft: 6 }}>(required)</span>}
                      </label>
                      <textarea className="form-input" rows={3} value={remarks} onChange={e => setRemarks(e.target.value)}
                        placeholder={action === 'reject' ? 'Reason for rejection…' : 'Optional comments…'} />
                    </div>
                    <button
                      className={`btn ${action === 'approve' ? 'btn-primary' : 'btn-danger'}`}
                      onClick={submit} disabled={loading}
                      style={{ width: '100%', padding: '12px 0', ...(action === 'approve' ? { background: 'var(--green)', borderColor: 'var(--green)' } : {}) }}>
                      {loading ? 'Processing…' : action === 'approve' ? '✓ Confirm Approval' : '✗ Confirm Rejection'}
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Edit & Resubmit Modal ────────────────────────────────────────────────────
// Opens pre-filled with rejected order's fields so employee can fix and resubmit
function EditResubmitModal({ order, onClose, onDone }) {
  const d = order.details || {};

  // Auto-set server-side keys — never shown as inputs
  const AUTO_KEYS_SET = new Set(['date', 'reference_number', 'employee_id', 'employee_id_code', 'approval_date']);

  // Build initFields ONLY from keys actually stored in this order's details
  // This guarantees we show exactly what was filled from the template — nothing more
  const initFields = {};
  Object.keys(d).forEach(key => {
    if (AUTO_KEYS_SET.has(key)) return;
    if (typeof d[key] !== 'string') return;
    initFields[key] = d[key];
  });

  // Ordered field list — use ALL_FIELDS metadata where key is known,
  // fall back to plain text for any template-specific key not in ALL_FIELDS
  const visibleFields = [
    ...ALL_FIELDS.filter(f => f.key in initFields),
    ...Object.keys(initFields)
      .filter(k => !ALL_FIELDS.some(f => f.key === k))
      .map(k => ({ key: k, label: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) })),
  ];

  const [fields, setFields] = useState(initFields);
  const [step, setStep] = useState('edit');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const rejection = (order.approval_history || []).slice().reverse().find(h => h.action === 'reject');
  const set = (k, v) => setFields(prev => ({ ...prev, [k]: v }));

  const filled = visibleFields.filter(f => (fields[f.key] || '').trim()).length;

  const goPreview = () => {
    const empty = visibleFields.filter(f => !(fields[f.key] || '').trim()).map(f => f.label);
    if (empty.length) { setError(`Please fill: ${empty.slice(0, 3).join(', ')}${empty.length > 3 ? ` +${empty.length - 3} more` : ''}`); return; }
    setError(''); setStep('preview');
  };

  const resubmit = async () => {
    setError(''); setSubmitting(true);
    try {
      // Step 1: update fields (resets to draft)
      await axios.post(`/api/appointment-orders/${order._id}/update-fields`, { fields });
      // Step 2: resubmit draft → pending_hr_head
      await axios.post(`/api/appointment-orders/${order._id}/resubmit`);
      onDone('Appointment order resubmitted to HR Head for approval.');
    } catch (e) {
      setError(e.response?.data?.error || 'Resubmission failed');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <style>{STYLES}</style>
      <div className="modal" style={{ maxWidth: 680, width: '96%', maxHeight: '92vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 4 }}>Edit & Resubmit</div>
            <h2 style={{ margin: 0, fontSize: 21 }}>Appointment Order</h2>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4, fontFamily: 'monospace' }}>{order.reference_number}</div>
          </div>
          <button className="btn-icon" onClick={onClose} style={{ fontSize: 18, marginTop: 4 }}>✕</button>
        </div>

        {/* Rejection reason banner */}
        {rejection?.remarks && (
          <div style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: 13 }}>
            <div style={{ fontWeight: 700, color: 'var(--red)', marginBottom: 4 }}>✗ Rejected by HR Head</div>
            <div style={{ color: 'var(--text-dim)' }}>{rejection.remarks}</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>Please correct the details below and resubmit.</div>
          </div>
        )}

        {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

        {/* ── EDIT STEP ── */}
        {step === 'edit' && (
          <div>
            <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '11px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 13 }}>
                <strong style={{ color: filled === visibleFields.length ? 'var(--green)' : 'var(--accent)' }}>{filled}</strong>
                <span style={{ color: 'var(--text-dim)' }}> / {visibleFields.length} fields filled</span>
              </div>
              <div style={{ height: 6, width: 140, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 3, width: `${visibleFields.length ? (filled / visibleFields.length) * 100 : 0}%`, background: filled === visibleFields.length ? 'var(--green)' : 'var(--accent)', transition: 'width .3s' }} />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {visibleFields.map((f, idx) => (
                <div key={f.key} className="ao-field">
                  <div className="ao-field-label">
                    <span className="ao-field-num">{idx + 1}</span>
                    {f.label}
                    <span style={{ color: 'var(--red)', marginLeft: 2 }}>*</span>
                  </div>
                  {f.date ? (
                    <input type="date" className="ao-field-input" value={fields[f.key] || ''} onChange={e => set(f.key, e.target.value)} style={{ cursor: 'pointer' }} />
                  ) : f.multi ? (
                    <textarea className="ao-field-input" rows={f.rows || 3} value={fields[f.key] || ''} onChange={e => set(f.key, e.target.value)} />
                  ) : (
                    <input type="text" className="ao-field-input" value={fields[f.key] || ''} onChange={e => set(f.key, e.target.value)} />
                  )}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={goPreview}
                disabled={filled !== visibleFields.length} style={{ flex: 1 }}>
                Preview Before Resubmitting →
              </button>
            </div>
          </div>
        )}

        {/* ── PREVIEW STEP ── */}
        {step === 'preview' && (
          <div>
            <div style={{ background: 'rgba(63,207,142,.07)', border: '1px solid rgba(63,207,142,.2)', borderRadius: 8, padding: '10px 16px', marginBottom: 20, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>✓</span><span>All fields updated. Review before resubmitting to HR.</span>
            </div>
            {order?.template_id ? <TemplatePreview templateId={order.template_id} fields={fields} /> : <div className="alert alert-warning">Template preview is unavailable for this draft.</div>}
            <div style={{ background: 'rgba(99,102,241,.07)', border: '1px solid rgba(99,102,241,.2)', borderRadius: 8, padding: '12px 16px', margin: '20px 0', fontSize: 13 }}>
              <strong>📤 Resubmit to HR Head</strong>
              <div style={{ marginTop: 4, color: 'var(--text-dim)' }}>This will send your updated appointment order back to HR Head for review.</div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-secondary" onClick={() => setStep('edit')}>← Edit Again</button>
              <button className="btn btn-primary" onClick={resubmit} disabled={submitting} style={{ flex: 1 }}>
                {submitting ? 'Resubmitting…' : '↑ Resubmit for HR Approval'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Order Card ───────────────────────────────────────────────────────────────
function OrderCard({ order, isHR, isHRHead, isEmployee, onReview, onEdit }) {
  const [downloading, setDownloading] = useState(false);
  const d = order.details || {};

  const download = async (fmt) => {
    setDownloading(true);
    try {
      const r = await axios.get(`/api/appointment-orders/${order._id}/download?format=${fmt}`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([r.data]));
      const a = document.createElement('a'); a.href = url; a.download = `${order.reference_number}.${fmt}`; a.click();
      URL.revokeObjectURL(url);
    } catch { alert('Download failed. File may not be ready yet.'); }
    finally { setDownloading(false); }
  };

  const rejection = order.status === 'rejected'
    ? (order.approval_history || []).slice().reverse().find(h => h.action === 'reject')
    : null;

  return (
    <div className="card" style={{ padding: '18px 22px', borderColor: order.status === 'rejected' ? 'rgba(239,68,68,.3)' : undefined }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 16 }}>{order.employee_name || d.employee_name || '—'}</span>
            <Badge status={order.status} />
          </div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-dim)' }}>
            <span style={{ fontFamily: 'monospace' }}>{order.reference_number}</span>
            {d.designation && <span>{d.designation}</span>}
            {d.date_of_joining && <span>Joining: {fmtDisp(d.date_of_joining)}</span>}
            <span>Submitted: {fmtDate(order.created_at)}</span>
          </div>
          {/* Rejection reason + call to action */}
          {rejection?.remarks && (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--red)', background: 'rgba(239,68,68,.07)', padding: '8px 12px', borderRadius: 6, borderLeft: '3px solid var(--red)' }}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>✗ Rejected</div>
              <div>{rejection.remarks}</div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>

          {/* HR Head: review pending orders */}
          {isHRHead && order.status === 'pending_hr_head' && (
            <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => onReview(order)}>
              Review →
            </button>
          )}

          {/* HR: preview any order */}
          {isHR && order.status !== 'pending_hr_head' && (
            <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => onReview(order)}>
              👁 Preview
            </button>
          )}

          {/* HR: edit & resubmit rejected orders */}
          {isHR && order.status === 'rejected' && (
            <button className="btn btn-secondary" style={{ fontSize: 12, color: 'var(--amber)', borderColor: 'rgba(245,166,35,.4)' }}
              onClick={() => onEdit(order)}>
              ✎ Edit & Resubmit
            </button>
          )}

          {/* Employee: view Form Q read-only */}
          {isEmployee && (
            <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => onReview(order)}>
              👁 View
            </button>
          )}

          {/* Download approved — both HR and employee */}
          {order.status === 'approved' && (
            <>
              <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => download('pdf')} disabled={downloading}>⬇ PDF</button>
              <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => download('docx')} disabled={downloading}>⬇ DOCX</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AppointmentPage() {
  const { user } = useAuth();
  const role = user?.role || 'employee';
  const isHR = ['hr', 'hr_head', 'admin'].includes(role);
  const isHRHead = ['hr_head', 'admin'].includes(role);
  const canCreate = isHR; // only HR creates
  const isEmployee = role === 'employee';

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [reviewTarget, setReviewTarget] = useState(null);
  const [editTarget, setEditTarget] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    axios.get('/api/appointment-orders/').then(r => setOrders(r.data)).catch(() => setOrders([])).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const tabs = [
    { key: 'all', label: 'All', count: orders.length },
    { key: 'approved', label: 'Approved', count: orders.filter(o => o.status === 'approved').length },
    ...(isHR ? [
      { key: 'pending', label: 'Pending HR Approval', count: orders.filter(o => o.status === 'pending_hr_head').length },
      { key: 'draft', label: 'Drafts', count: orders.filter(o => o.status === 'draft').length },
      { key: 'rejected', label: 'Rejected', count: orders.filter(o => o.status === 'rejected').length },
    ] : []),
  ];

  const filtered = orders.filter(o => {
    if (activeTab === 'all') return true;
    if (activeTab === 'pending') return o.status === 'pending_hr_head';
    if (activeTab === 'approved') return o.status === 'approved';
    if (activeTab === 'rejected') return o.status === 'rejected';
    if (activeTab === 'draft') return o.status === 'draft';
    return true;
  });

  return (
    <div className="page-container">
      <style>{STYLES}</style>

      {/* Page header */}
      <div className="page-header">
        <div>
          {/* <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1.5, fontFamily: 'monospace', marginBottom: 4 }}>
            Form Q · [See Rule 24(9-A)]
          </div> */}
          <h1 className="page-title">Appointment Orders</h1>
        </div>
        {canCreate && (
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            + New Appointment Order
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="tab-bar" style={{ marginBottom: 24 }}>
        {tabs.map(t => (
          <button key={t.key} className={`tab-btn ${activeTab === t.key ? 'active' : ''}`} onClick={() => setActiveTab(t.key)}>
            {t.label}
            {t.count > 0 && (
              <span style={{ marginLeft: 6, borderRadius: 10, padding: '1px 8px', fontSize: 11, background: activeTab === t.key ? 'rgba(255,255,255,.2)' : 'var(--surface-2)' }}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Notification banner for employee — new approved order */}
      {isEmployee && orders.some(o => o.status === 'approved' && o.employee_notified === false) && (
        <div style={{
          background: 'rgba(63,207,142,.08)', border: '1px solid rgba(63,207,142,.25)',
          borderRadius: 10, padding: '14px 20px', marginBottom: 20,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>🎉</span>
            <div>
              <div style={{ fontWeight: 700, color: 'var(--green)', fontSize: 14 }}>Your Appointment Order has been approved!</div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>You can now download your signed appointment document.</div>
            </div>
          </div>
          <button className="btn btn-sm btn-secondary" onClick={async () => {
            const unread = orders.filter(o => o.status === 'approved' && o.employee_notified === false);
            await Promise.all(unread.map(o => axios.post(`/api/appointment-orders/${o._id}/mark-read`).catch(() => { })));
            setOrders(prev => prev.map(o => ({ ...o, employee_notified: true })));
          }}>
            Dismiss
          </button>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-dim)' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div style={{ fontSize: 44, marginBottom: 10 }}>📋</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {activeTab === 'pending' ? 'No orders pending approval' :
              activeTab === 'approved' ? 'No approved orders yet' :
                activeTab === 'draft' ? 'No draft orders' :
                  activeTab === 'rejected' ? 'No rejected orders' :
                    'No appointment orders found'}
          </div>
          {isHR && activeTab === 'all' && (
            <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>
              Click <strong>+ New Appointment Order</strong> to create one for an employee.
            </div>
          )}
          {isEmployee && activeTab === 'all' && (
            <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>
              Your appointment order will appear here once HR has created and submitted it for approval.
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.map(o => (
            <OrderCard
              key={o._id}
              order={o}
              isHR={isHR}
              isHRHead={isHRHead}
              isEmployee={isEmployee}
              onReview={setReviewTarget}
              onEdit={setEditTarget}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}

      {reviewTarget && (
        <HRReviewPanel
          order={reviewTarget}
          onClose={() => setReviewTarget(null)}
          onDone={() => { setReviewTarget(null); load(); }}
          readOnly={isEmployee}
        />
      )}

      {editTarget && isHR && (
        <EditResubmitModal
          order={editTarget}
          onClose={() => setEditTarget(null)}
          onDone={() => { setEditTarget(null); load(); }}
        />
      )}
    </div>
  );
}