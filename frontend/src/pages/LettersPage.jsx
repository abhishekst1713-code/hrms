// * LettersPage.jsx — Complete Offer Letter Module
//  * ─────────────────────────────────────────────
//  * Features:
//  *  • "Generate Offer Letter" → chooser: Create New | Revised
//  *  • Create New: employee picker → template picker → template's own placeholders
//  *    → CTC entry with live breakdown (Basic/HRA/DA/Employer PF/GHI/Other)
//  *  • Revised Letter: pick employee → pick their previous letter → new template + CTC
//  *  • HR submits draft → HR Head approval only (no manager stage)
//  *  • HR Head panel: inline edits → approve/reject → send email → confirm join → create ID
//  *  • Active / Completed tabs + status sub-filters
//  *  • Delete for admin/hr_head (draft + rejected only)
//  */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
const datePickerStyle = `
  input[type="date"]::-webkit-calendar-picker-indicator {
    cursor: pointer;
    opacity: 0.7;
    filter: none;
  }
  input[type="date"]::-webkit-calendar-picker-indicator:hover {
    opacity: 1;
  }
  input[type="date"]::-webkit-datetime-edit { padding: 0; }
  input[type="date"]::-webkit-inner-spin-button { display: none; }
  ::-webkit-calendar-picker-indicator { background-size: contain; }
`;
// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_CFG = {
  draft: { label: 'Draft', cls: 'badge-gray' },
  pending_hr_head: { label: 'Pending HR Head', cls: 'badge-amber' },
  approved: { label: 'Approved', cls: 'badge-green' },
  rejected: { label: 'Rejected', cls: 'badge-red' },
  issued: { label: 'Issued', cls: 'badge-green' },
  joined: { label: 'Joined', cls: 'badge-green' },
  id_created: { label: 'ID Created', cls: 'badge-green' },
  withdrawn: { label: 'Withdrawn', cls: 'badge-red' },
};

// These are injected automatically — never shown as manual input fields
const CTC_AUTO = new Set([
  // Old format placeholders
  'basic', 'hra', 'da', 'employer_pf', 'ghi', 'other_allowances',
  'gross_monthly', 'net_annual', 'ctc_fmt', 'basic_fmt', 'hra_fmt', 'da_fmt',
  'employer_pf_fmt', 'ghi_fmt', 'other_allowances_fmt', 'gross_monthly_fmt',
  'net_annual_fmt', 'basic_monthly', 'hra_monthly', 'da_monthly',
  'employer_pf_monthly', 'other_allowances_monthly',
  // New format placeholders (used in this template)
  'basic_m', 'basic_y', 'hra_m', 'hra_y', 'da_m', 'da_y',
  'other_m', 'other_y', 'gross_m', 'gross_y',
  'pf_employer_m', 'pf_employer_y', 'additions_m', 'additions_y',
  'total_ctc_m', 'total_ctc_y', 'pf_employee_m', 'pf_employee_y',
  'prof_tax_m', 'prof_tax_y', 'deductions_m', 'deductions_y',
  'net_pay_m', 'net_pay_y',
]);
const CTC_FIELD_NAMES = new Set(['ctc', 'annual_ctc', 'ctc_amount', 'total_ctc']);
const EMP_AUTO = new Set([
  // These are truly auto-filled from employee record (not shown as manual inputs)
  'employee_id', 'department', 'address',
  'probation_period', 'notice_period', 'joining_date',
]);
const SIG_AUTO = new Set([
  'company_name', 'hr_signatory_name', 'hr_signatory_designation', 'date',
  'hr_signature', 'chairman_signature',
]);

const DELETABLE = new Set(['draft', 'rejected']);
const DELETE_ROLES = new Set(['admin', 'hr_head']);
const HRHEAD_ROLES = new Set(['hr_head', 'admin', 'hr']);

// ─────────────────────────────────────────────────────────────────────────────
// SignaturePad — draw or upload a digital signature, returns base64 PNG
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Signature Pad — draw or upload, outputs base64 PNG
// ─────────────────────────────────────────────────────────────────────────────

const SIGNATURE_KEYS = new Set(['hr_signature', 'chairman_signature']);

function SignaturePad({ label, value, onChange }) {
  const canvasRef = useRef(null);
  const [mode, setMode] = useState('draw'); // 'draw' | 'upload'
  const [drawing, setDrawing] = useState(false);
  const [hasDrawing, setHasDrawing] = useState(false);
  const fileRef = useRef(null);

  // Initialize canvas
  useEffect(() => {
    if (mode !== 'draw') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, [mode]);

  const getPos = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if (e.touches) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDraw = (e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    setDrawing(true);
  };

  const draw = (e) => {
    if (!drawing) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const pos = getPos(e, canvas);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    setHasDrawing(true);
  };

  const endDraw = () => {
    if (!drawing) return;
    setDrawing(false);
    const canvas = canvasRef.current;
    onChange(canvas.toDataURL('image/png'));
  };

  const clearPad = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasDrawing(false);
    onChange('');
  };

  const handleUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => onChange(ev.target.result);
    reader.readAsDataURL(file);
  };

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', background: 'var(--surface-2)',
        borderBottom: '1px solid var(--border)',
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{label}</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {['draw', 'upload'].map(m => (
            <button key={m} type="button"
              className={`btn btn-sm ${mode === m ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: 11, padding: '3px 10px' }}
              onClick={() => { setMode(m); onChange(''); setHasDrawing(false); }}>
              {m === 'draw' ? '✏ Draw' : '⬆ Upload'}
            </button>
          ))}
          {value && (
            <button type="button" className="btn btn-sm btn-secondary"
              style={{ fontSize: 11, padding: '3px 10px', color: 'var(--red)', borderColor: 'rgba(240,82,82,.3)' }}
              onClick={() => { clearPad(); onChange(''); }}>
              ✕ Clear
            </button>
          )}
        </div>
      </div>

      {/* Draw mode */}
      {mode === 'draw' && (
        <div style={{ position: 'relative', background: '#fff' }}>
          <canvas
            ref={canvasRef}
            width={100} height={120}
            style={{ width: '80%', height: 120, cursor: 'crosshair', display: 'block', touchAction: 'none' }}
            onMouseDown={startDraw}
            onMouseMove={draw}
            onMouseUp={endDraw}
            onMouseLeave={endDraw}
            onTouchStart={startDraw}
            onTouchMove={draw}
            onTouchEnd={endDraw}
          />
          {!hasDrawing && !value && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              pointerEvents: 'none', color: '#bbb', fontSize: 13,
            }}>
              Draw signature here…
            </div>
          )}
        </div>
      )}

      {/* Upload mode */}
      {mode === 'upload' && (
        <div style={{ padding: 16, background: '#fff' }}>
          {value ? (
            <div style={{ textAlign: 'center' }}>
              <img src={value} alt="signature" style={{ maxHeight: 80, maxWidth: '100%', objectFit: 'contain' }} />
            </div>
          ) : (
            <div
              style={{ border: '2px dashed var(--border)', borderRadius: 6, padding: '20px 0', textAlign: 'center', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 13 }}
              onClick={() => fileRef.current?.click()}
            >
              Click to upload signature image (PNG/JPG)
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleUpload} />
        </div>
      )}

      {/* Status */}
      {value && (
        <div style={{ padding: '4px 12px', background: 'rgba(63,207,142,.06)', borderTop: '1px solid rgba(63,207,142,.2)', fontSize: 11, color: 'var(--green)' }}>
          ✓ Signature captured
        </div>
      )}
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const inr = (n) => n != null && n !== '' ? `₹${Number(n).toLocaleString('en-IN')}` : '—';

function Lbl({ children, req }) {
  return (
    <label className="form-label">
      {children}{req && <span style={{ color: 'var(--red)', marginLeft: 3 }}>*</span>}
    </label>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CTC Breakdown Table
// ─────────────────────────────────────────────────────────────────────────────

function BreakdownTable({ bd }) {
  if (!bd) return null;

  // ── Earnings ──
  const earningRows = [
    ['Basic Salary', bd.basic_monthly, bd.basic, '50% of Annual CTC'],
    ['HRA', bd.hra_monthly, bd.hra, bd.metro ? '50% of Basic (Metro)' : '40% of Basic'],
    ['DA (Dearness Allowance)', bd.da_monthly, bd.da, '20% of Basic'],
    ['Other Allowances', bd.other_allowances_monthly, bd.other_allowances, 'CTC minus all other components'],
    ['Employer PF Contribution', bd.avail_pf ? bd.employer_pf_monthly : null, bd.avail_pf ? bd.employer_pf : null, bd.avail_pf ? 'Fixed ₹1,800/month' : 'Not opted in'],
    ['Group Health Insurance', bd.ghi_monthly, bd.ghi, 'Annual premium entered'],
  ];



  // ── Deductions (Change 2) ──
  // Employee PF = same as employer PF (₹1,800/mo cap) when opted in, else 0
  const empPF_m = bd.avail_pf ? (bd.employer_pf_monthly ?? 0) : 0;
  const profTax_m = 200;   // Professional Tax fixed ₹200/month
  const totalDed_m = empPF_m + profTax_m;
  const netTakeHome_m = (bd.gross_monthly ?? 0) - totalDed_m;

  const thStyle = { padding: '5px 8px', textAlign: 'left', fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text-dim)', textTransform: 'uppercase' };
  const thR = { ...thStyle, textAlign: 'right' };
  const tdStyle = { padding: '6px 8px' };
  const tdR = { ...tdStyle, textAlign: 'right', fontFamily: 'var(--mono)' };

  return (
    <div style={{ marginTop: 10 }}>

      {/* ── EARNINGS table ── */}
      <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
        Earnings
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 6 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={thStyle}>Component</th>
            <th style={thR}>Monthly</th>
            <th style={thR}>Annual</th>
            <th style={thR}>Note</th>
          </tr>
        </thead>
        <tbody>
          {earningRows.map(([label, mo, yr, note]) => (
            <tr key={label} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={tdStyle}>{label}</td>
              <td style={{ ...tdR, color: 'var(--text-muted)' }}>{inr(mo)}</td>
              <td style={{ ...tdR, fontWeight: 500 }}>{inr(yr)}</td>
              <td style={{ ...tdR, fontSize: 10, color: 'var(--text-dim)', fontStyle: 'italic' }}>{note}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '2px solid var(--border-bright)', background: 'var(--surface)' }}>
            <td style={{ ...tdStyle, fontWeight: 700 }}>Gross Salary</td>
            <td style={{ ...tdR, fontWeight: 700, color: 'var(--green)' }}>{inr(bd.gross_monthly)}</td>
            <td style={{ ...tdR, fontWeight: 700, color: 'var(--green)' }}>{inr(bd.net_annual)}</td>
            <td />
          </tr>
          <tr style={{ background: 'var(--accent-dim)' }}>
            <td style={{ ...tdStyle, fontWeight: 700, color: 'var(--accent)' }} colSpan={2}>Total CTC (Annual)</td>
            <td style={{ ...tdR, fontWeight: 700, color: 'var(--accent)' }}>{inr(bd.ctc)}</td>
            <td />
          </tr>
        </tfoot>
      </table>

      {/* ── DEDUCTIONS block (Change 2) ── */}
      <div style={{ marginTop: 14, paddingTop: 10, borderTop: '2px dashed var(--border)' }}>
        <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--red)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
          Deductions
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 6 }}>
          <tbody>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={tdStyle}>Employee Provident Fund</td>
              <td style={{ ...tdR, color: 'var(--red)' }}>
                {bd.avail_pf ? `₹${empPF_m.toLocaleString('en-IN')}.00 / month` : '—  (not opted in)'}
              </td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={tdStyle}>Professional Tax</td>
              <td style={{ ...tdR, color: 'var(--red)' }}>₹{profTax_m.toLocaleString('en-IN')}.00 / month</td>
            </tr>
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid var(--border-bright)', background: 'var(--surface)' }}>
              <td style={{ ...tdStyle, fontWeight: 700 }}>Total Deductions</td>
              <td style={{ ...tdR, fontWeight: 700, color: 'var(--red)' }}>
                ₹{totalDed_m.toLocaleString('en-IN')}.00 / month
              </td>
            </tr>
          </tfoot>
        </table>

        {/* Net Take Home */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--green-dim)', border: '1px solid rgba(63,207,142,0.3)', borderRadius: 'var(--radius)', marginTop: 6 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--green)' }}>Net Take Home</div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
              Gross Monthly (₹{(bd.gross_monthly ?? 0).toLocaleString('en-IN')}) − Total Deductions (₹{totalDed_m.toLocaleString('en-IN')})
            </div>
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 16, color: 'var(--green)' }}>
            ₹{netTakeHome_m.toLocaleString('en-IN')}.00 / month
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CTC Section (input + auto-breakdown)
// ─────────────────────────────────────────────────────────────────────────────

function CTCSection({ state, onChange }) {
  const timerRef = useRef(null);
  const { ctc, pf, ghi, metro, bd, bdLoading } = state;

  const recalc = (overrides = {}) => {
    const merged = { ctc, pf, ghi, metro, ...overrides };
    if (!merged.ctc || isNaN(merged.ctc)) return;
    onChange({ bdLoading: true });
    axios.post('/api/letters/ctc-breakdown', {
      annual_ctc: parseFloat(merged.ctc),
      avail_pf: merged.pf,
      ghi_annual: parseFloat(merged.ghi || 0),
      metro: merged.metro,
    }).then(r => onChange({ bd: r.data, bdLoading: false }))
      .catch(() => onChange({ bdLoading: false }));
  };

  const handleCTC = (val) => {
    onChange({ ctc: val, bd: null });
    clearTimeout(timerRef.current);
    if (!val || isNaN(val)) return;
    timerRef.current = setTimeout(() => recalc({ ctc: val }), 600);
  };

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>CTC & Salary Breakdown</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div className="form-group" style={{ margin: 0 }}>
          <Lbl req>Annual CTC (₹)</Lbl>
          <input type="number" value={ctc} min="0" step="1000"
            onChange={e => handleCTC(e.target.value)}
            placeholder="e.g. 600000" />
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <Lbl>GHI Annual Premium (₹)</Lbl>
          <input type="number" value={ghi} min="0" step="500"
            onChange={e => { onChange({ ghi: e.target.value }); recalc({ ghi: e.target.value }); }}
            placeholder="0 if not applicable" />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 24, fontSize: 13, marginBottom: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
          <input type="checkbox" checked={pf} onChange={e => { onChange({ pf: e.target.checked }); recalc({ pf: e.target.checked }); }} style={{ width: 'auto' }} />
          <span>Avail Employer PF</span>
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>(fixed ₹1,800/mo)</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
          <input type="checkbox" checked={metro} onChange={e => { onChange({ metro: e.target.checked }); recalc({ metro: e.target.checked }); }} style={{ width: 'auto' }} />
          <span>Metro city</span>
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>(HRA 50% vs 40%)</span>
        </label>
      </div>

      {bdLoading && (
        <div style={{ textAlign: 'center', padding: '10px', color: 'var(--text-dim)', fontSize: 12 }}>
          <div className="spinner" style={{ width: 18, height: 18, display: 'inline-block', marginRight: 8, verticalAlign: 'middle' }} />
          Calculating breakdown…
        </div>
      )}

      {bd && (
        <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius)', padding: 12 }}>
          <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--accent)', textTransform: 'uppercase', marginBottom: 6 }}>
            Salary Structure Preview
          </div>
          <BreakdownTable bd={bd} />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Template Placeholder Fields
// (only renders fields not in CTC_AUTO, EMP_AUTO, or SIG_AUTO)
// ─────────────────────────────────────────────────────────────────────────────

function PlaceholderFields({ template, vals, onChange }) {
  if (!template) return null;

  const all = template.placeholders || [];
  const autoFill = all.filter(p => EMP_AUTO.has(p) || CTC_AUTO.has(p) || SIG_AUTO.has(p));
  const manual = all.filter(p => !EMP_AUTO.has(p) && !CTC_AUTO.has(p) && !SIG_AUTO.has(p));

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Auto-filled badge list */}
      {autoFill.length > 0 && (
        <div style={{ background: 'var(--green-dim)', border: '1px solid rgba(63,207,142,0.2)', borderRadius: 'var(--radius)', padding: '8px 12px', marginBottom: 12, fontSize: 12 }}>
          <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--green)', textTransform: 'uppercase', marginBottom: 6 }}>
            ✓ Auto-filled — no input needed
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {autoFill.map(p => (
              <span key={p} style={{ background: 'var(--surface)', border: '1px solid rgba(63,207,142,0.3)', borderRadius: 4, padding: '2px 8px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                {'{{'}{p}{'}}'}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Manual placeholder inputs */}
      {manual.length === 0 ? (
        <div style={{ padding: '12px 14px', background: 'var(--surface-2)', borderRadius: 'var(--radius)', fontSize: 12, color: 'var(--text-dim)', textAlign: 'center' }}>
          No additional fields to fill — all placeholders are auto-populated.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
            Fill In — template-specific placeholders
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {manual.filter(p => !SIGNATURE_KEYS.has(p)).map(p => (
              <div key={p} className="form-group" style={{ margin: 0 }}>
                <Lbl>{p.replace(/_/g, ' ')}</Lbl>
                <input value={vals[p] || ''}
                  onChange={e => onChange({ ...vals, [p]: e.target.value })}
                  placeholder={`{{${p}}}`} />
              </div>
            ))}
          </div>

          {/* Signature fields — full width with draw/upload pad */}
          {manual.filter(p => SIGNATURE_KEYS.has(p)).map(p => (
            <div key={p} style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6, fontWeight: 600 }}>
                {p.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} <span style={{ color: 'var(--red)' }}>*</span>
              </div>
              <SignaturePad
                label={p === 'hr_signature' ? 'HR Signature' : 'Chairman Signature'}
                value={vals[p] || ''}
                onChange={v => onChange({ ...vals, [p]: v })}
              />
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Template Card (shown after selection — lists all placeholders)
// ─────────────────────────────────────────────────────────────────────────────

function TemplateCard({ template }) {
  if (!template) return null;
  return (
    <div style={{ background: 'var(--accent-dim)', border: '1px solid rgba(79,142,247,0.2)', borderRadius: 'var(--radius)', padding: '10px 14px', marginBottom: 14, fontSize: 12 }}>
      <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--accent)', textTransform: 'uppercase', marginBottom: 6 }}>
        Placeholders in "{template.name}"
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {(template.placeholders || []).length === 0 && (
          <span style={{ color: 'var(--text-dim)' }}>No placeholders detected</span>
        )}
        {(template.placeholders || []).map(p => (
          <span key={p} style={{ background: 'var(--surface)', border: '1px solid rgba(79,142,247,0.3)', borderRadius: 4, padding: '2px 8px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--accent)' }}>
            {'{{'}{p}{'}}'}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Signatory fields (shared by Create New and Revised modals)
// ─────────────────────────────────────────────────────────────────────────────

function SignatoryFields({ vals, onChange, joiningDate, onJoiningDate, email, onEmail, hideJoining = false, hideLetterDetails = false }) {
  return (
    <>
      {!hideLetterDetails && (
        <>
          <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
            Letter Details
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: hideJoining ? '1fr' : '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <Lbl>Company Name</Lbl>
              <input value={vals.company_name || ''} onChange={e => onChange({ ...vals, company_name: e.target.value })} />
            </div>
            {!hideJoining && (
              <div className="form-group" style={{ margin: 0 }}>
                <Lbl>Joining Date</Lbl>
                <input type="date" value={joiningDate} onChange={e => onJoiningDate(e.target.value)} />
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <Lbl>Signatory Name</Lbl>
              <input value={vals.hr_signatory_name || ''} onChange={e => onChange({ ...vals, hr_signatory_name: e.target.value })} placeholder="e.g. Priya Sharma" />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <Lbl>Signatory Designation</Lbl>
              <input value={vals.hr_signatory_designation || ''} onChange={e => onChange({ ...vals, hr_signatory_designation: e.target.value })} />
            </div>
          </div>
        </>
      )}
      {/* <div className="form-group">
        <Lbl>Candidate Email</Lbl>
        <input type="email" value={email} onChange={e => onEmail(e.target.value)}
          placeholder="For sending the final approved letter" />
      </div> */}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry-point Chooser
// ─────────────────────────────────────────────────────────────────────────────

function Chooser({ onNew, onRevised, onClose }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 440 }}>
        <h2 className="modal-title">Generate Offer Letter</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
          Choose the type of offer letter to create.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
          {[
            { icon: '◈', title: 'Create New Offer Letter', desc: 'First-time offer for a new candidate or existing employee', color: 'var(--accent)', dim: 'var(--accent-dim)', fn: onNew },
            { icon: '↺', title: 'Revised Offer Letter', desc: 'Increment or promotion after probation — links to original letter', color: 'var(--amber)', dim: 'var(--amber-dim)', fn: onRevised },
          ].map(({ icon, title, desc, color, dim, fn }) => (
            <button key={title} onClick={fn} style={{ padding: '20px 16px', background: dim, border: `1px solid ${color}55`, borderRadius: 'var(--radius-lg)', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = color}
              onMouseLeave={e => e.currentTarget.style.borderColor = `${color}55`}>
              <div style={{ fontSize: 30, marginBottom: 10 }}>{icon}</div>
              <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 5 }}>{title}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>{desc}</div>
            </button>
          ))}
        </div>
        <div style={{ textAlign: 'center' }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Placeholder label helper — converts snake_case to Title Case human label
// ─────────────────────────────────────────────────────────────────────────────

function toLabel(key) {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// ─────────────────────────────────────────────────────────────────────────────
// RenderedDocument — displays the context key/values as a clean letter layout
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// Create New Offer Letter Modal
// Flow: Template picker → one input per placeholder (all manual) → Generate
// No auto-fill. Every {{placeholder}} in the template gets its own input field.
// ─────────────────────────────────────────────────────────────────────────────

// CTC placeholder names that trigger the breakdown panel
// ─────────────────────────────────────────────────────────────────────────────
// Letter Preview Modal — renders context as a formatted document view
// Used by both HR (before submit) and HR Head (during review)
// ─────────────────────────────────────────────────────────────────────────────

function LetterPreviewModal({ letter, onClose, onEditDone }) {
  const [mode, setMode] = useState('preview');
  const [pdfUrl, setPdfUrl] = useState(null);
  const [isGoogleViewer, setIsGoogleViewer] = useState(false);
  const [pdfKey, setPdfKey] = useState(0);
  const [fields, setFields] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const SKIP = new Set([
    'basic', 'hra', 'da', 'employer_pf', 'ghi', 'other_allowances',
    'gross_monthly', 'net_annual', 'ctc_fmt', 'basic_fmt', 'hra_fmt', 'da_fmt',
    'employer_pf_fmt', 'ghi_fmt', 'other_allowances_fmt', 'gross_monthly_fmt',
    'net_annual_fmt', 'basic_monthly', 'hra_monthly', 'da_monthly',
    'employer_pf_monthly', 'other_allowances_monthly',
    'basic_m', 'basic_y', 'hra_m', 'hra_y', 'da_m', 'da_y',
    'other_m', 'other_y', 'gross_m', 'gross_y',
    'pf_employer_m', 'pf_employer_y', 'additions_m', 'additions_y',
    'total_ctc_m', 'total_ctc_y', 'pf_employee_m', 'pf_employee_y',
    'prof_tax_m', 'prof_tax_y', 'deductions_m', 'deductions_y',
    'net_pay_m', 'net_pay_y', 'employee_id', 'date',
  ]);

  const loadPdf = () => {
    axios.get(`/api/letters/${letter._id}/preview-pdf`, {
      responseType: 'blob',
      headers: { ...axios.defaults.headers.common }
    }).then(r => {
      const ct = r.headers['content-type'] || '';
      if (ct.includes('application/json')) {
        r.data.text().then(text => {
          const json = JSON.parse(text);
          if (json.docx_url) {
            const viewer = `https://docs.google.com/gview?url=${encodeURIComponent(window.location.origin + json.docx_url)}&embedded=true`;
            setPdfUrl(viewer); setPdfKey(k => k + 1); setIsGoogleViewer(true);
          }
        });
      } else {
        setPdfUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(r.data); });
        setPdfKey(k => k + 1); setIsGoogleViewer(false);
      }
    }).catch(() => { });
  };

  useEffect(() => {
    loadPdf();
    axios.get(`/api/letters/${letter._id}/preview-context`)
      .then(r => {
        const ctx = r.data.context || {};
        const filtered = {};
        Object.entries(ctx).forEach(([k, v]) => { if (!SKIP.has(k)) filtered[k] = v; });
        setFields(filtered);
      }).catch(() => { });
    return () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); };
  }, [letter._id]);

  const save = async () => {
    setSaving(true); setError(''); setSuccess('');
    try {
      await axios.post(`/api/letters/${letter._id}/update-draft`, { fields });
      setSuccess('Saved! Refreshing preview…');
      setMode('preview');
      setTimeout(() => { loadPdf(); setSuccess(''); if (onEditDone) onEditDone(); }, 800);
    } catch (e) {
      setError(e.response?.data?.error || 'Save failed');
    } finally { setSaving(false); }
  };

  const isEditable = ['draft', 'rejected'].includes(letter.status);

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 860, maxHeight: '95vh', overflowY: 'auto', padding: 0 }}>

        {/* Toolbar */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '14px 20px', borderBottom: '1px solid var(--border)',
          background: 'var(--surface)', position: 'sticky', top: 0, zIndex: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 15 }}>
              {mode === 'edit' ? '✎ Edit Placeholder Values' : '◈ Offer Letter Preview'}
            </span>
            <span className={`badge ${letter.status === 'rejected' ? 'badge-red' :
              letter.status === 'draft' ? 'badge-gray' :
                letter.status === 'pending_hr_head' ? 'badge-amber' : 'badge-green'
              }`}>{letter.status?.replace(/_/g, ' ')}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {isEditable && mode === 'preview' && (
              <button className="btn btn-secondary btn-sm" onClick={() => setMode('edit')}>
                ✎ Edit Fields
              </button>
            )}
            {mode === 'edit' && (
              <>
                <button className="btn btn-secondary btn-sm" onClick={() => { setMode('preview'); setError(''); }}>
                  Cancel
                </button>
                <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
                  {saving ? 'Saving…' : '✓ Save & Preview'}
                </button>
              </>
            )}
            <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
          </div>
        </div>

        {error && <div className="alert alert-error" style={{ margin: '10px 20px 0' }}>{error}</div>}
        {success && <div className="alert alert-success" style={{ margin: '10px 20px 0' }}>{success}</div>}

        {/* EDIT MODE — placeholder fields */}
        {mode === 'edit' && (
          <div style={{ padding: 24 }}>
            <div style={{
              background: 'var(--accent-dim)', border: '1px solid rgba(79,142,247,0.2)',
              borderRadius: 'var(--radius)', padding: '10px 14px', marginBottom: 18, fontSize: 12, color: 'var(--accent)'
            }}>
              ✎ Edit any field below. The document will be <strong>regenerated from the original template</strong> — all formatting, alignment, logo, tables and layout are preserved automatically.
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {Object.entries(fields).map(([k, v]) => (
                <div key={k} className="form-group" style={{
                  margin: 0,
                  gridColumn: (k.includes('address') || k.includes('line') || String(v).length > 60) ? '1 / -1' : 'auto'
                }}>
                  <label className="form-label" style={{ textTransform: 'capitalize' }}>
                    {k.replace(/_/g, ' ')}
                  </label>
                  {String(v).length > 60 ? (
                    <textarea rows={3} value={v || ''}
                      onChange={e => setFields(f => ({ ...f, [k]: e.target.value }))}
                      style={{ width: '100%', resize: 'vertical' }} />
                  ) : (
                    <input
                      type={k.includes('date') ? 'date' : k === 'ctc' ? 'number' : 'text'}
                      value={v || ''}
                      onChange={e => setFields(f => ({ ...f, [k]: e.target.value }))}
                    />
                  )}
                </div>
              ))}
            </div>

            {/* CTC note */}
            {fields.ctc !== undefined && (
              <div style={{ marginTop: 14, padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 'var(--radius)', fontSize: 12, color: 'var(--text-dim)' }}>
                💡 If you change the CTC value, the entire salary breakdown table (Basic, HRA, DA, PF, Net Pay etc.) will be recalculated automatically.
              </div>
            )}
          </div>
        )}

        {/* PREVIEW MODE — PDF */}
        {mode === 'preview' && (
          <div style={{ width: '100%', height: '75vh', background: '#525659', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {pdfUrl ? (
              <iframe key={pdfKey} src={pdfUrl}
                style={{ width: '100%', height: '100%', border: 'none' }}
                title="Offer Letter Preview" />
            ) : (
              <div style={{ color: '#ccc', fontSize: 13 }}>Loading document…</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DirectEditModal({ letter, onClose, onEditDone }) {
  const [blocks, setBlocks] = useState([]);
  const [orig, setOrig] = useState({});   // original texts by id
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    setError('');
    axios.get(`/api/letters/${letter._id}/docx-to-html`)
      .then(r => {
        const blks = r.data.blocks || [];
        setBlocks(blks);
        // Store originals for diff on save
        const o = {};
        blks.forEach(b => { o[b.id] = b.text; });
        setOrig(o);
      })
      .catch(() => setError('Failed to load document'))
      .finally(() => setLoading(false));
  }, [letter._id]);

  const update = (id, val) =>
    setBlocks(prev => prev.map(b => b.id === id ? { ...b, text: val } : b));

  const save = async () => {
    setSaving(true); setError(''); setSuccess('');
    // Only send blocks that actually changed
    const changed = blocks.filter(b => b.text !== orig[b.id]);
    if (changed.length === 0) {
      setSaving(false);
      onClose();
      return;
    }
    try {
      await axios.post(`/api/letters/${letter._id}/save-html`, {
        blocks: changed.map(b => ({ id: b.id, text: b.text }))
      });
      setSuccess(`Saved ${changed.length} change${changed.length > 1 ? 's' : ''}!`);
      setTimeout(() => { if (onEditDone) onEditDone(); onClose(); }, 1000);
    } catch (e) {
      setError(e.response?.data?.error || 'Save failed');
    } finally { setSaving(false); }
  };

  const paraBlocks = blocks.filter(b =>
    b.type === 'para' && (b.text.trim() || orig[b.id]?.trim()) &&
    (!search || b.text.toLowerCase().includes(search.toLowerCase()) ||
      orig[b.id]?.toLowerCase().includes(search.toLowerCase()))
  );
  const cellBlocks = blocks.filter(b =>
    b.type === 'cell' &&
    (!search || b.text.toLowerCase().includes(search.toLowerCase()))
  );

  const changedCount = blocks.filter(b => b.text !== orig[b.id]).length;

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 900, maxHeight: '95vh', display: 'flex', flexDirection: 'column', padding: 0 }}>

        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '14px 20px', borderBottom: '1px solid var(--border)',
          background: 'var(--surface)', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 15 }}>
              ✎ Edit Document
            </span>
            <span className="badge badge-amber">Direct Edit</span>
            {changedCount > 0 && (
              <span style={{ fontSize: 11, color: 'var(--amber)', fontFamily: 'var(--mono)' }}>
                {changedCount} unsaved change{changedCount > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving || loading}>
              {saving ? 'Saving…' : `✓ Save${changedCount > 0 ? ` (${changedCount})` : ''}`}
            </button>
          </div>
        </div>

        {error && <div className="alert alert-error" style={{ margin: '10px 20px 0', flexShrink: 0 }}>{error}</div>}
        {success && <div className="alert alert-success" style={{ margin: '10px 20px 0', flexShrink: 0 }}>{success}</div>}

        {/* Notice */}
        <div style={{
          padding: '8px 20px', background: 'var(--amber-dim)',
          borderBottom: '1px solid rgba(245,166,35,0.2)',
          fontSize: 11, color: 'var(--amber)', flexShrink: 0,
        }}>
          ⚠ Edit text below. <strong>Only the text you change is saved</strong> — all formatting,
          alignment, bold, fonts, tables stay exactly as in the original Word document.
          Use <strong>Edit Fields</strong> for CTC/salary changes.
        </div>

        {/* Search */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <input
            placeholder="🔍 Search text in document…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 60 }}>
              <div className="spinner" style={{ width: 32, height: 32, margin: '0 auto 12px' }} />
              <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>Loading document…</div>
            </div>
          ) : (
            <>
              {/* Paragraphs */}
              {paraBlocks.length > 0 && (
                <div style={{ marginBottom: 28 }}>
                  <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
                    Paragraphs — {paraBlocks.length} blocks
                  </div>
                  {paraBlocks.map(b => {
                    const changed = b.text !== orig[b.id];
                    return (
                      <div key={b.id} style={{ marginBottom: 6, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        {/* Style tag */}
                        <div style={{
                          fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--text-dim)',
                          background: 'var(--surface-2)', border: '1px solid var(--border)',
                          borderRadius: 3, padding: '3px 6px', marginTop: 8,
                          whiteSpace: 'nowrap', minWidth: 70, textAlign: 'center',
                        }}>
                          {b.style?.includes('Heading') ? b.style.replace('Heading ', 'H') : 'Normal'}
                        </div>
                        <textarea
                          value={b.text}
                          onChange={e => update(b.id, e.target.value)}
                          rows={b.text.length > 100 ? 3 : 1}
                          style={{
                            flex: 1, resize: 'vertical', fontSize: 13,
                            fontWeight: b.bold ? 700 : 400,
                            padding: '7px 10px',
                            background: changed ? 'rgba(245,166,35,0.08)' : 'var(--surface-2)',
                            border: `1px solid ${changed ? 'var(--amber)' : 'var(--border)'}`,
                            borderRadius: 'var(--radius)', color: 'var(--text)',
                          }}
                        />
                        {changed && (
                          <button
                            onClick={() => update(b.id, orig[b.id])}
                            title="Undo change"
                            style={{ marginTop: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 14 }}>
                            ↩
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Table cells */}
              {cellBlocks.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
                    Table Cells — {cellBlocks.length} cells · structure &amp; alignment preserved
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    {cellBlocks.map(b => {
                      const changed = b.text !== orig[b.id];
                      return (
                        <div key={b.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <div style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--text-dim)' }}>
                            T{b.table + 1} · R{b.row + 1} · C{b.col + 1}
                          </div>
                          <input
                            value={b.text}
                            onChange={e => update(b.id, e.target.value)}
                            style={{
                              fontSize: 12, padding: '5px 8px',
                              background: changed ? 'rgba(245,166,35,0.08)' : 'var(--surface-2)',
                              border: `1px solid ${changed ? 'var(--amber)' : 'var(--border)'}`,
                              borderRadius: 'var(--radius)', color: 'var(--text)',
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}


function CreateNewModal({ templates, onClose, onDone }) {
  const { user } = useAuth();
  const [selTmpl, setSelTmpl] = useState(null);
  const [fields, setFields] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [ctcBd, setCtcBd] = useState(null);      // breakdown result
  const [ctcLoading, setCtcLoading] = useState(false);
  const [ctcPf, setCtcPf] = useState(true);
  const ctcTimer = useRef(null);

  const handleTemplateChange = (tid) => {
    const t = templates.find(x => x._id === tid) || null;
    setSelTmpl(t);
    setError('');
    setCtcBd(null);
    if (t) {
      const blanks = {};
      (t.placeholders || [])
        .filter(p => !CTC_AUTO.has(p) && !EMP_AUTO.has(p) && !SIG_AUTO.has(p))
        .forEach(p => { blanks[p] = ''; });
      // Include signature keys
      (t.placeholders || [])
        .filter(p => SIGNATURE_KEYS.has(p))
        .forEach(p => { blanks[p] = ''; });
      setFields(blanks);
    } else {
      setFields({});
    }
  };

  const setField = (key, val) => {
    setFields(prev => ({ ...prev, [key]: val }));
    // If this is a CTC field, fire the live breakdown after a short debounce
    if (CTC_FIELD_NAMES.has(key)) {
      clearTimeout(ctcTimer.current);
      setCtcBd(null);
      const num = parseFloat(val);
      if (!val || isNaN(num) || num <= 0) return;
      setCtcLoading(true);
      ctcTimer.current = setTimeout(() => {
        axios.post('/api/letters/ctc-breakdown', {
          annual_ctc: num, avail_pf: ctcPf, ghi_annual: 0, metro: false,
        })
          .then(r => setCtcBd(r.data))
          .catch(() => { })
          .finally(() => setCtcLoading(false));
      }, 500);
    }
  };

  // Only show manual fields — exclude all auto-calculated ones
  const placeholders = selTmpl
    ? (selTmpl.placeholders || []).filter(p =>
      !CTC_AUTO.has(p) && !EMP_AUTO.has(p) && !SIG_AUTO.has(p)
    )
    : [];
  const allFilled = placeholders.length > 0 && placeholders.every(p =>
    SIGNATURE_KEYS.has(p) ? (fields[p] && fields[p].length > 50) : fields[p]?.trim()
  );

  const go = async () => {
    const empty = placeholders.filter(p =>
      SIGNATURE_KEYS.has(p) ? (!fields[p] || fields[p].length < 50) : !fields[p]?.trim()
    );
    if (empty.length > 0) {
      setError(`Please fill: ${empty.map(toLabel).join(', ')}`);
      return;
    }
    setError(''); setLoading(true);
    try {
      const res = await axios.post('/api/letters/generate-new', {
        template_id: selTmpl._id,
        fields,
        avail_pf: ctcPf,
      });
      const name = fields.candidate_name || fields.employee_name || 'candidate';
      onDone(`Offer letter draft created (v${res.data.version}) for ${name}. Submit it to HR Head for approval.`);
    } catch (e) {
      setError(e.response?.data?.error || 'Generation failed');
    } finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 680, maxHeight: '92vh', overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 className="modal-title" style={{ margin: 0 }}>◈ Create New Offer Letter</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {/* Info banner */}
        <div style={{ background: 'var(--accent-dim)', border: '1px solid rgba(79,142,247,0.2)', borderRadius: 'var(--radius)', padding: '8px 14px', marginBottom: 16, fontSize: 12, color: 'var(--accent)' }}>
          Select a template — every <code style={{ fontFamily: 'var(--mono)' }}>{'{{placeholder}}'}</code> found inside it will appear as an input field below. Fill all fields manually, then click Generate.
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        {/* ── Step 1: Template picker ── */}
        <div className="form-group">
          <Lbl req>Select Template</Lbl>
          <select value={selTmpl?._id || ''} onChange={e => handleTemplateChange(e.target.value)}>
            <option value="">Choose template…</option>
            {templates.map(t => (
              <option key={t._id} value={t._id}>{t.name} (v{t.version})</option>
            ))}
          </select>
        </div>

        {/* ── Step 2: One input per placeholder ── */}
        {selTmpl && placeholders.length === 0 && (
          <div style={{ padding: '14px', background: 'var(--surface-2)', borderRadius: 'var(--radius)', fontSize: 12, color: 'var(--text-dim)', textAlign: 'center', marginBottom: 16 }}>
            No fillable placeholders detected in this template.
          </div>
        )}

        {selTmpl && placeholders.length > 0 && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16, marginBottom: 16 }}>

            {/* Section header with placeholder count */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Fill All Placeholders — {placeholders.length} field{placeholders.length !== 1 ? 's' : ''}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                <code style={{ fontFamily: 'var(--mono)', color: 'var(--amber)' }}>date</code> and{' '}
                <code style={{ fontFamily: 'var(--mono)', color: 'var(--amber)' }}>employee_id</code>{' '}
                are auto-set
              </div>
            </div>

            {/* Template placeholder chips for reference */}
            {/* <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 16 }}>
              {(selTmpl.placeholders || []).map(p => {
                const isAuto = p === 'date' || p === 'employee_id';
                const isFilled = !isAuto && fields[p]?.trim();
                return (
                  <span key={p} style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: 11, fontFamily: 'var(--mono)',
                    background: isAuto ? 'var(--amber-dim)' : isFilled ? 'var(--green-dim)' : 'var(--surface-2)',
                    color: isAuto ? 'var(--amber)' : isFilled ? 'var(--green)' : 'var(--text-dim)',
                    border: `1px solid ${isAuto ? 'rgba(245,166,35,0.3)' : isFilled ? 'rgba(63,207,142,0.3)' : 'var(--border)'}`,
                  }}>
                    {'{{'}{p}{'}}'}
                    {isAuto && ' ⚙'}
                    {isFilled && ' ✓'}
                  </span>
                );
              })}
            </div> */}

            {/* Input grid — 2 columns */}
            {/* Input grid — 2 columns */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {placeholders.filter(p => !SIGNATURE_KEYS.has(p)).map(p => {
                const isCTC = CTC_FIELD_NAMES.has(p);
                return (
                  <React.Fragment key={p}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <Lbl req>{toLabel(p)}</Lbl>
                      <input
                        type={p.includes('date') || p.includes('Date') ? 'date' : 'text'}
                        value={fields[p] || ''}
                        onChange={e => setField(p, e.target.value)}
                        placeholder={isCTC ? 'e.g. 600000' : ``}
                        style={fields[p]?.trim() ? { borderColor: 'var(--green)' } : {}}
                      />
                      {isCTC && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 8, fontSize: 13, cursor: 'pointer' }}>
                          <input type="checkbox" checked={ctcPf}
                            onChange={e => {
                              setCtcPf(e.target.checked);
                              // Recalculate immediately with new PF setting
                              const num = parseFloat(fields[p]);
                              if (!num || isNaN(num)) return;
                              setCtcLoading(true);
                              axios.post('/api/letters/ctc-breakdown', {
                                annual_ctc: num, avail_pf: e.target.checked, ghi_annual: 0, metro: false,
                              }).then(r => setCtcBd(r.data))
                                .catch(() => { })
                                .finally(() => setCtcLoading(false));
                            }}
                            style={{ width: 'auto' }} />
                          <span>Avail Employer PF</span>
                          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>(fixed ₹1,800/month)</span>
                        </label>
                      )}
                    </div>
                    {/* CTC breakdown panel — full width, appears right after ctc field */}
                    {isCTC && (ctcLoading || ctcBd) && (
                      <div style={{ gridColumn: '1 / -1', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 14, marginTop: -4 }}>
                        <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                          Salary Structure Preview
                        </div>
                        {ctcLoading
                          ? <div style={{ textAlign: 'center', padding: 10, fontSize: 12, color: 'var(--text-dim)' }}>
                            <div className="spinner" style={{ width: 16, height: 16, display: 'inline-block', marginRight: 8, verticalAlign: 'middle' }} />
                            Calculating…
                          </div>
                          : <BreakdownTable bd={ctcBd} />
                        }
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>

            {/* Signature pads — full width below the grid */}
            {['admin', 'hr_head'].includes(user?.role) && placeholders.filter(p => SIGNATURE_KEYS.has(p)).map(p => (
              <div key={p} style={{ marginTop: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
                  {toLabel(p)} <span style={{ color: 'var(--red)' }}>*</span>
                </div>
                <SignaturePad
                  label={p === 'hr_signature' ? 'HR Signature' : 'Chairman Signature'}
                  value={fields[p] || ''}
                  onChange={v => setField(p, v)}
                />
              </div>
            ))}

            {/* Progress indicator */}
            <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 2,
                  width: `${placeholders.length ? Math.round((placeholders.filter(p => fields[p]?.trim()).length / placeholders.length) * 100) : 0}%`,
                  background: allFilled ? 'var(--green)' : 'var(--accent)',
                  transition: 'width 0.2s',
                }} />
              </div>
              <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: allFilled ? 'var(--green)' : 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                {placeholders.filter(p => fields[p]?.trim()).length} / {placeholders.length}
              </span>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={go}
            disabled={loading || !selTmpl || !allFilled}>
            {loading ? 'Generating…' : '◈ Generate Draft'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Revised Offer Letter Modal
// ─────────────────────────────────────────────────────────────────────────────

function RevisedModal({ employees, templates, onClose, onDone }) {
  const [step, setStep] = useState(1);
  const [selEmp, setSelEmp] = useState(null);
  const [selTmpl, setSelTmpl] = useState(null);
  const [joining, setJoining] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sig, setSig] = useState({
    company_name: 'Infopace Management Pvt Ltd',
    hr_signatory_name: '',
    hr_signatory_designation: 'HR Manager',
  });
  const [ctcSt, setCtcSt] = useState({
    ctc: '', pf: true, ghi: '', metro: false, bd: null, bdLoading: false,
  });
  const [extraFields, setExtraFields] = useState({});

  // When employee selected — prefill email and joining
  useEffect(() => {
    if (!selEmp) return;
    setEmail(selEmp.email || '');
    setJoining(selEmp.joining_date || '');
  }, [selEmp]);

  // Filter placeholders — only show ones NOT auto-filled from employee profile
  const AUTO_FROM_PROFILE = new Set([
    // Name variants
    'candidate_name', 'employee_name', 'name', 'full_name', 'applicant_name',
    // Address variants
    'address', 'address_line1', 'address_line2', 'address_line_1', 'address_line_2',
    'city', 'state', 'pincode', 'pin_code', 'zip', 'zipcode',
    // Contact
    'phone', 'mobile', 'phone_number', 'mobile_number',
    'email', 'personal_email', 'work_email', 'candidate_email', 'employee_email',
    // Employment
    'department', 'dept', 'division', 'employee_id', 'emp_id', 'emp_code',
    // Revision-specific — handled by dedicated fields above
    'designation', 'ctc', 'acceptance_date', 'joining_date', 'date', 'effective_date',
    // CTC fields
    ...CTC_AUTO,
  ]);

  const manualPlaceholders = selTmpl
    ? (selTmpl.placeholders || []).filter(p =>
      !AUTO_FROM_PROFILE.has(p.toLowerCase()) &&
      p.toLowerCase() !== 'joining_date'
    )
    : [];

  const go = async () => {
    if (!selEmp) { setError('Select an employee'); return; }
    if (!selTmpl) { setError('Select a template'); return; }
    if (!ctcSt.ctc) { setError('New CTC is required'); return; }
    setError(''); setLoading(true);
    try {
      // Get most recent approved letter for this employee as original
      const lettersRes = await axios.get(`/api/letters/?employee_id=${selEmp._id}`);
      const letters = lettersRes.data || [];
      const original = letters.find(l => l.status === 'approved') || letters[0];

      const res = await axios.post('/api/letters/revise', {
        original_letter_id: original?._id || null,
        employee_id: selEmp._id,
        template_id: selTmpl._id,
        annual_ctc: parseFloat(ctcSt.ctc),
        avail_pf: ctcSt.pf,
        ghi_annual: parseFloat(ctcSt.ghi || 0),
        metro: ctcSt.metro,
        joining_date: joining,
        candidate_email: email,
        designation: extraFields.designation || selEmp.designation || '',
        company_name: sig.company_name,
        hr_signatory_name: sig.hr_signatory_name,
        hr_signatory_designation: sig.hr_signatory_designation,
        extra_fields: extraFields,
      });
      onDone(`Revised offer letter created (v${res.data.version}). Submit for approval.`);
    } catch (e) {
      setError(e.response?.data?.error || 'Revision failed');
    } finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 680, maxHeight: '92vh', overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 className="modal-title" style={{ margin: 0 }}>↺ Revised Offer Letter</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 4 }}>
              {[1, 2].map(s => (
                <div key={s} style={{
                  width: 22, height: 22, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700, fontFamily: 'var(--mono)',
                  background: step >= s ? 'var(--accent)' : 'var(--surface-2)',
                  color: step >= s ? 'white' : 'var(--text-dim)',
                  border: `1px solid ${step >= s ? 'var(--accent)' : 'var(--border)'}`,
                }}>{s}</div>
              ))}
            </div>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
          </div>
        </div>

        <div style={{ background: 'var(--amber-dim)', border: '1px solid rgba(245,166,35,0.25)', borderRadius: 'var(--radius)', padding: '8px 14px', marginBottom: 14, fontSize: 12, color: 'var(--amber)' }}>
          Employee profile details (name, address, department) are <strong>auto-filled</strong>. Only enter the new CTC, designation and date.
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        {/* ── Step 1: Select Employee ── */}
        {step === 1 && (
          <>
            <div className="form-group">
              <Lbl req>Select Employee</Lbl>
              <select value={selEmp?._id || ''}
                onChange={e => setSelEmp(employees.find(x => x._id === e.target.value) || null)}>
                <option value="">Choose employee…</option>
                {employees.map(emp => (
                  <option key={emp._id} value={emp._id}>
                    {emp.name} ({emp.employee_id}) — {emp.designation}
                  </option>
                ))}
              </select>
            </div>

            {/* Show employee profile preview */}
            {selEmp && (
              <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 14, marginTop: 10 }}>
                <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--accent)', textTransform: 'uppercase', marginBottom: 10 }}>
                  Auto-filled from profile
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                  {[
                    ['Name', selEmp.name],
                    ['Employee ID', selEmp.employee_id],
                    ['Department', selEmp.department],
                    ['Designation', selEmp.designation],
                    ['Email', selEmp.email],
                    ['Phone', selEmp.phone || '—'],
                    ['Address', selEmp.address || '—'],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <div style={{ color: 'var(--text-dim)', fontSize: 10 }}>{k}</div>
                      <div style={{ fontWeight: 500, color: 'var(--text)' }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={() => setStep(2)} disabled={!selEmp}>
                Select Template →
              </button>
            </div>
          </>
        )}

        {/* ── Step 2: Template + CTC + new role ── */}
        {step === 2 && (
          <>
            <div className="form-group">
              <Lbl req>Template for Revised Letter</Lbl>
              <select value={selTmpl?._id || ''}
                onChange={e => { setSelTmpl(templates.find(x => x._id === e.target.value) || null); setExtraFields({}); }}>
                <option value="">Choose template…</option>
                {templates.map(t => (
                  <option key={t._id} value={t._id}>{t.name} (v{t.version})</option>
                ))}
              </select>
            </div>

            {selTmpl && <TemplateCard template={selTmpl} />}

            {/* New CTC */}
            <CTCSection state={ctcSt} onChange={partial => setCtcSt(p => ({ ...p, ...partial }))} />

            {/* New Designation — always show */}
            <div className="form-group">
              <Lbl>New Designation <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>(leave blank to keep current: {selEmp?.designation})</span></Lbl>
              <input
                placeholder={selEmp?.designation || 'e.g. Senior Engineer'}
                value={extraFields.designation || ''}
                onChange={e => setExtraFields(p => ({ ...p, designation: e.target.value }))}
              />
            </div>

            {/* New Joining / Effective Date */}
            <div className="form-group">
              <Lbl>Effective Date</Lbl>
              <input type="date" value={joining}
                onChange={e => setJoining(e.target.value)} />
            </div>

            {/* Only show truly manual placeholders — only after template selected */}
            {selTmpl && manualPlaceholders.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 8 }}>
                  Additional fields from template
                </div>
                {manualPlaceholders.map(p => (
                  <div key={p} className="form-group">
                    <Lbl>{p.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</Lbl>
                    <input
                      type={p.toLowerCase().includes('date') ? 'date' : 'text'}
                      value={extraFields[p] || ''}
                      onChange={e => setExtraFields(prev => ({ ...prev, [p]: e.target.value }))}
                      placeholder={`Enter ${p}`}
                      style={p.toLowerCase().includes('date') ? { cursor: 'pointer' } : {}}
                    />
                  </div>
                ))}
              </div>
            )}

            <SignatoryFields
              vals={sig} onChange={setSig}
              hideJoining={true}
              email={email} onEmail={setEmail}
              hideLetterDetails={true}
            />

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setStep(1)}>← Back</button>
              <button className="btn btn-primary" onClick={go}
                disabled={loading || !selTmpl || !ctcSt.ctc}>
                {loading ? 'Generating…' : '↺ Generate Revised Letter'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HR Head Panel — approve/reject/edit/email/confirm/create-id
// ─────────────────────────────────────────────────────────────────────────────

export function HRHeadPanel({ letter, onClose, onDone }) {
  const { user } = useAuth();
  const canSign = ['admin', 'hr_head'].includes(user?.role);
  const [remarks, setRemarks] = useState('');
  const [email, setEmail] = useState(letter.emp_email || letter.candidate_email || '');
  const [message, setMessage] = useState('');
  const [edits, setEdits] = useState({});
  const [loading, setLoading] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [idLoading, setIdLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [previewPdfUrl, setPreviewPdfUrl] = useState(null);
  const [empRole, setEmpRole] = useState('employee');
  const [hrSignature, setHrSignature] = useState(null); // base64 PNG — HR
  const [chairmanSignature, setChairmanSignature] = useState(null); // base64 PNG — Chairman
  const [managerId, setManagerId] = useState('');
  const [managers, setManagers] = useState([]);
  const [emailSent, setEmailSent] = useState(false);

  // Load initial preview
  useEffect(() => {
    axios.get(`/api/letters/${letter._id}/preview-pdf`, {
      responseType: 'blob',
      headers: { ...axios.defaults.headers.common }
    }).then(r => {
      const ct = r.headers['content-type'] || '';
      if (ct.includes('application/json')) {
        r.data.text().then(text => {
          try {
            const json = JSON.parse(text);
            if (json.docx_url) {
              setPreviewPdfUrl(`https://docs.google.com/gview?url=${encodeURIComponent(window.location.origin + json.docx_url)}&embedded=true`);
            }
          } catch { }
        });
      } else {
        setPreviewPdfUrl(URL.createObjectURL(r.data));
      }
    }).catch(() => { });
  }, [letter._id]);

  // Refresh preview with signatures when both are drawn
  useEffect(() => {
    if (!hrSignature || !chairmanSignature) return;
    axios.post(`/api/letters/${letter._id}/preview-with-signatures`, {
      hr_signature: hrSignature,
      chairman_signature: chairmanSignature,
    }, { responseType: 'blob' })
      .then(r => {
        const ct = r.headers['content-type'] || '';
        if (ct.includes('application/pdf')) {
          setPreviewPdfUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(r.data); });
        }
      })
      .catch(() => { });
  }, [hrSignature, chairmanSignature]);

  useEffect(() => {
    axios.get('/api/auth/users?role=manager')
      .then(r => setManagers(r.data || []))
      .catch(() => { });
  }, []);
  // Derive current workflow phase from letter status
  const isRevised = letter.letter_subtype === 'revised';
  const phase = isRevised
    ? ({ pending_hr_head: 'review', approved: 'email', issued: 'done', joined: 'done' }[letter.status] || 'review')
    : ({ pending_hr_head: 'review', approved: 'email', issued: 'joining', joined: 'id', id_created: 'done' }[letter.status] || 'review');
  const phaseIdx = isRevised
    ? ['review', 'email'].indexOf(phase)
    : ['review', 'email', 'joining', 'id'].indexOf(phase);

  const ctx = letter.context || {};
  const bd = letter.breakdown || {};
  const CFG = STATUS_CFG[letter.status] || {};

  const act = async (action) => {
    if (action === 'reject' && !remarks.trim()) { setError('Rejection reason required'); return; }
    setLoading(true); setError('');
    try {
      await axios.post(`/api/letters/${letter._id}/hr-action`, {
        action, remarks,
        edits: Object.keys(edits).length ? edits : undefined,
        hr_signature: hrSignature || null,
        chairman_signature: chairmanSignature || null,
      });
      onDone(`Letter ${action}d.`);
    } catch (e) {
      setError(e.response?.data?.error || 'Action failed');
      setLoading(false);
    }
  };

  const sendEmail = async () => {
    if (!email) { setError('Email required'); return; }
    setLoading(true); setError('');
    try {
      const r = await axios.post(`/api/letters/${letter._id}/send-email`, {
        to_email: email,
        message,
        hr_signature: hrSignature,
        chairman_signature: chairmanSignature,
      });
      setSuccess(r.data.message);
      setTimeout(() => onDone(r.data.message || 'Offer letter issued and emailed.'), 1500);
    } catch (e) { setError(e.response?.data?.error || 'Failed'); }
    finally { setLoading(false); }
  };

  const confirmJoin = async () => {
    setLoading(true); setError('');
    try {
      await axios.post(`/api/letters/${letter._id}/confirm-join`, {});
      onDone('Joining confirmed — proceed to Create Employee ID.');
    } catch (e) { setError(e.response?.data?.error || 'Failed'); }
    finally { setLoading(false); }
  };

  const createID = async () => {
    if (!managerId) { setError('Please assign a manager before creating the ID.'); return; }
    setIdLoading(true); setError('');
    try {
      const r = await axios.post(`/api/letters/${letter._id}/create-id`, { email, role: empRole, manager_id: managerId });
      onDone(`Employee ID created. Login: ${r.data.login_email} · Default password: ${r.data.default_password}`);
    } catch (e) { setError(e.response?.data?.error || 'Failed'); }
    finally { setIdLoading(false); }
  };
  const sendWelcomeEmail = async () => {
    setEmailLoading(true); setError('');
    try {
      await axios.post(`/api/letters/${letter._id}/send-welcome-email`, {
        email,
        employee_name: letter.employee_name,
      });
      setSuccess('Welcome email sent successfully!');
      setEmailSent(true);
    } catch (e) { setError(e.response?.data?.error || 'Failed to send email'); }
    finally { setEmailLoading(false); }
  };

  const STEPS = isRevised
    ? [
      { key: 'review', label: 'Review' },
      { key: 'email', label: 'Issue' },
    ]
    : [
      { key: 'review', label: 'Review' },
      { key: 'email', label: 'Issue' },
      { key: 'joining', label: 'Joining' },
      { key: 'id', label: 'Create ID' },
    ];

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 620, maxHeight: '92vh', overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <h2 className="modal-title" style={{ margin: 0 }}>HR Head — Offer Review</h2>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              {letter.employee_name} · {letter.employee_code} · <span className={`badge ${CFG.cls}`}>{CFG.label}</span>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {/* Phase stepper */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 18, background: 'var(--surface-2)', borderRadius: 'var(--radius)', padding: 3 }}>
          {STEPS.map((s, i) => (
            <div key={s.key} style={{ flex: 1, textAlign: 'center', padding: '6px 2px', borderRadius: 6, fontSize: 11, fontWeight: 600, fontFamily: 'var(--mono)', background: i <= phaseIdx ? 'var(--accent)' : 'transparent', color: i <= phaseIdx ? 'white' : 'var(--text-dim)' }}>
              {i < phaseIdx ? '✓ ' : ''}{s.label}
            </div>
          ))}
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        {/* Letter summary */}
        <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius)', padding: 14, marginBottom: 14, fontSize: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 8 }}>
            {[['Employee', ctx.employee_name], ['Designation', ctx.designation], ['Department', ctx.department],
            ['Annual CTC', ctx.ctc ? inr(ctx.ctc) : '—'], ['Gross Monthly', ctx.gross_monthly ? inr(ctx.gross_monthly) : '—'], ['Joining', ctx.joining_date || '—']].map(([k, v]) => (
              <div key={k}><span style={{ color: 'var(--text-dim)' }}>{k}: </span><strong>{v || '—'}</strong></div>
            ))}
          </div>
          {Object.keys(bd).length > 0 && (
            <>
              <div style={{ height: 1, background: 'var(--border)', margin: '10px 0' }} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, fontSize: 11 }}>
                {[['Basic', bd.basic], ['HRA', bd.hra], ['DA', bd.da],
                ['Employer PF', bd.employer_pf], ['Other', bd.other_allowances], ['GHI', bd.ghi]].map(([k, v]) => (
                  <div key={k}><span style={{ color: 'var(--text-dim)' }}>{k}: </span><span className="mono">{inr(v)}</span></div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* ── Phase: Complete ── */}
        {phase === 'done' && (
          <div style={{ background: 'var(--green-dim)', border: '1px solid rgba(63,207,142,0.25)', borderRadius: 'var(--radius)', padding: 16, marginBottom: 14 }}>
            <div style={{ fontWeight: 600, color: 'var(--green)', marginBottom: 6 }}>
              {isRevised ? '✓ Revised Letter Complete' : '✓ Employee Onboarding Complete'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {isRevised
                ? 'This is a revised offer letter. The employee already has a login account — no new ID needed.'
                : 'Employee ID has been created. The employee can now log in with their credentials.'}
            </div>
            <div className="modal-footer" style={{ marginTop: 12, padding: 0 }}>
              <button className="btn btn-secondary" onClick={onClose}>Close</button>
            </div>
          </div>
        )}

        {/* ── Phase: Review ── */}
        {phase === 'review' && (
          <>
            {/* Letter document preview for HR Head */}
            <div style={{
              border: '1px solid var(--border)', borderRadius: 'var(--radius)',
              background: '#fff', marginBottom: 16, maxHeight: 380, overflowY: 'auto',
            }}>
              <div style={{
                fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text-dim)',
                textTransform: 'uppercase', padding: '8px 14px',
                borderBottom: '1px solid var(--border)', background: 'var(--surface)',
              }}>
                Letter Document Preview
              </div>
              <div style={{ width: '100%', height: 340, background: '#525659' }}>
                {previewPdfUrl ? (
                  <iframe
                    src={previewPdfUrl}
                    style={{ width: '100%', height: '340px', border: 'none', display: 'block' }}
                    title="Offer Letter Preview"
                  />
                ) : (
                  <div style={{ height: 340, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: 13 }}>
                    Loading document…
                  </div>
                )}
              </div>
            </div>

            <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 8 }}>
              Required Fields (must be filled before approving)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
              {[
                { key: 'joining_date', label: 'Joining Date', type: 'date' },
                { key: 'designation', label: 'Designation', type: 'text' },
                { key: 'department', label: 'Department', type: 'text' },
              ].map(({ key, label, type }) => (
                <div key={key} className="form-group" style={{ margin: 0 }}>
                  <Lbl req>{label}</Lbl>
                  <input
                    type={type}
                    value={edits[key] !== undefined ? edits[key] : ctx[key] || ''}
                    onChange={e => setEdits({ ...edits, [key]: e.target.value })}
                    placeholder={type === 'date' ? '' : `Enter ${label.toLowerCase()}`}
                    style={{
                      borderColor: !(edits[key] !== undefined ? edits[key] : ctx[key] || '')
                        ? 'rgba(240,82,82,.5)' : undefined
                    }}
                  />
                </div>
              ))}
            </div>

            <div className="form-group">
              <Lbl>Remarks {<span style={{ fontSize: 10, color: 'var(--text-dim)' }}>(required for rejection)</span>}</Lbl>
              {/* Signatures required before approval — visible to hr_head and admin only */}
              {canSign && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                  <div style={{ border: '1.5px solid #e2e8f0', borderRadius: 10, padding: 10, background: '#fafafa' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700 }}>HR Signature</div>
                        <div style={{ fontSize: 11, color: '#64748b' }}>Krishna B G · Sr. HR Manager</div>
                      </div>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
                        background: hrSignature ? '#ecfdf5' : '#fffbeb',
                        color: hrSignature ? '#059669' : '#d97706'
                      }}>
                        {hrSignature ? '✓ Signed' : 'Pending'}
                      </span>
                    </div>
                    <SignaturePad label="HR Signature" value={hrSignature} onChange={setHrSignature} />
                  </div>
                  <div style={{ border: '1.5px solid #e2e8f0', borderRadius: 10, padding: 10, background: '#fafafa' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700 }}>Chairman Signature</div>
                        <div style={{ fontSize: 11, color: '#64748b' }}>Kishor Jagirdar · Chairman & MD</div>
                      </div>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
                        background: chairmanSignature ? '#ecfdf5' : '#fffbeb',
                        color: chairmanSignature ? '#059669' : '#d97706'
                      }}>
                        {chairmanSignature ? '✓ Signed' : 'Pending'}
                      </span>
                    </div>
                    <SignaturePad label="Chairman Signature" value={chairmanSignature} onChange={setChairmanSignature} />
                  </div>
                </div>
              )}
              <textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={3}
                placeholder="Add notes — required for rejection" />
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button disabled={loading} onClick={() => act('reject')}
                style={{ padding: '9px 18px', background: 'var(--red)', color: 'white', border: 'none', borderRadius: 'var(--radius)', cursor: loading ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 500 }}>
                ✕ Reject
              </button>
              <button
                disabled={loading || (canSign && (!hrSignature || !chairmanSignature)) || !['joining_date', 'designation', 'department'].every(k =>
                  (edits[k] !== undefined ? edits[k] : ctx[k] || '').trim()
                )}
                onClick={() => {
                  const missing = ['joining_date', 'designation', 'department'].filter(k =>
                    !(edits[k] !== undefined ? edits[k] : ctx[k] || '').trim()
                  );
                  if (missing.length) {
                    setError(`Please fill required fields: ${missing.map(k => k.replace(/_/g, ' ')).join(', ')}`);
                    return;
                  }
                  act('approve');
                }}
                style={{
                  padding: '9px 18px', background: 'var(--green)', color: 'white',
                  border: 'none', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 500,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: !['joining_date', 'designation', 'department'].every(k =>
                    (edits[k] !== undefined ? edits[k] : ctx[k] || '').trim()
                  ) ? 0.5 : 1,
                }}>
                ✓ Approve
              </button>
            </div>
          </>
        )}

        {/* ── Phase: Issue Email ── */}
        {phase === 'email' && (
          <>
            <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 12 }}>
              Send offer letter to candidate
            </div>

            {/* Info
            <div style={{ padding: '9px 12px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, fontSize: 12, color: '#2563eb', marginBottom: 14, fontWeight: 500 }}>
              Both signatures will be embedded side-by-side in the offer letter exactly where
              <code style={{ fontFamily: 'var(--mono)', margin: '0 4px', fontSize: 11 }}>&#123;&#123;hr_signature&#125;&#125;</code> and
              <code style={{ fontFamily: 'var(--mono)', margin: '0 4px', fontSize: 11 }}>&#123;&#123;chairman_signature&#125;&#125;</code>
              appear in your template — above the names row.
            </div> */}

            {/* Candidate email */}
            <div className="form-group">
              <Lbl req>Candidate Email</Lbl>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="candidate@example.com" />
            </div>

            {/* Personal message */}
            <div className="form-group">
              <Lbl>Personal message (optional)</Lbl>
              <textarea value={message} onChange={e => setMessage(e.target.value)} rows={2}
                placeholder="Any personal note to add to the email body…" />
            </div>

            {/* ── Two signature pads side by side ── */}
            {/* <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 6 }}>

              {/* HR Signature */}
            {/* <div style={{ border: '1.5px solid #e2e8f0', borderRadius: 10, padding: 14, background: '#fafafa' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>HR Signature</div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>Krishna B G · Sr. HR Manager</div>
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
                    background: hrSignature ? '#ecfdf5' : '#fffbeb',
                    color: hrSignature ? '#059669' : '#d97706',
                    border: `1px solid ${hrSignature ? 'rgba(5,150,105,.2)' : 'rgba(217,119,6,.2)'}`,
                  }}>
                    {hrSignature ? '✓ Signed' : 'Pending'}
                  </span>
                </div>
                <SignaturePad label="HR Signature" value={hrSignature} onChange={setHrSignature} />
              </div> */}

            {/* Chairman Signature */}
            {/* <div style={{ border: '1.5px solid #e2e8f0', borderRadius: 10, padding: 14, background: '#fafafa' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>Chairman Signature</div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>Kishor Jagirdar · Chairman & MD</div>
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
                    background: chairmanSignature ? '#ecfdf5' : '#fffbeb',
                    color: chairmanSignature ? '#059669' : '#d97706',
                    border: `1px solid ${chairmanSignature ? 'rgba(5,150,105,.2)' : 'rgba(217,119,6,.2)'}`,
                  }}>
                    {chairmanSignature ? '✓ Signed' : 'Pending'}
                  </span>
                </div>
                <SignaturePad label="Chairman Signature" value={chairmanSignature} onChange={setChairmanSignature} />
              </div>
            </div> */}

            {/* Validation hint */}
            {/* {(!hrSignature || !chairmanSignature) && (
              <div style={{ fontSize: 11.5, color: '#d97706', marginBottom: 10, fontWeight: 500 }}>
                ⚠ Both signatures are required before sending:
                {!hrSignature && <span style={{ marginLeft: 6, background: '#fffbeb', padding: '1px 7px', borderRadius: 4, fontSize: 11 }}>HR Signature</span>}
                {!chairmanSignature && <span style={{ marginLeft: 6, background: '#fffbeb', padding: '1px 7px', borderRadius: 4, fontSize: 11 }}>Chairman Signature</span>}
              </div>
            )} */}

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={onClose}>Close</button>
              <button
                className="btn btn-primary"
                onClick={sendEmail}
                disabled={loading || !email}
              // title={(!hrSignature || !chairmanSignature) ? 'Both signatures are required' : ''}
              >
                {loading ? 'Sending…' : '✉ Issue & Email Candidate'}
              </button>
            </div>
          </>
        )}

        {/* ── Phase: Confirm Joining (new letters only) ── */}
        {phase === 'joining' && (
          <>
            <div style={{ background: 'var(--accent-dim)', border: '1px solid rgba(79,142,247,0.2)', borderRadius: 'var(--radius)', padding: 16, marginBottom: 14 }}>
              <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: 6 }}>✉ Offer Letter Issued</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                The offer letter has been emailed to the candidate. Once they confirm readiness to join, click below to proceed.
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={onClose}>Close</button>
              <button disabled={loading} onClick={confirmJoin}
                style={{ padding: '9px 18px', background: 'var(--green)', color: 'white', border: 'none', borderRadius: 'var(--radius)', cursor: loading ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 500 }}>
                {loading ? 'Confirming…' : '✓ Confirm Joining'}
              </button>
            </div>
          </>
        )}


        {/* ── Phase: Create Employee ID ── */}
        {phase === 'id' && (
          <>
            <div style={{ background: 'var(--green-dim)', border: '1px solid rgba(63,207,142,0.25)', borderRadius: 'var(--radius)', padding: 16, marginBottom: 14 }}>
              <div style={{ fontWeight: 600, color: 'var(--green)', marginBottom: 6 }}>✓ Joining Confirmed</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Create an employee login account. The employee will appear under <strong>Joining Employees</strong>.</div>
            </div>
            <div className="form-group">
              <Lbl>Login Email</Lbl>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div className="form-group">
              <Lbl>Account Role</Lbl>
              <select value={empRole} onChange={e => setEmpRole(e.target.value)}>
                <option value="employee">Employee — view own letters, apply for exit</option>
                <option value="manager">Manager — same as employee + approve team exits</option>
              </select>
            </div>
            <div className="form-group">
              <Lbl req>Assign Manager</Lbl>
              <select value={managerId} onChange={e => setManagerId(e.target.value)}>
                <option value="">— Select a manager —</option>
                {managers.map(m => (
                  <option key={m._id} value={m._id}>{m.name} ({m.emp_code || m.email})</option>
                ))}
              </select>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 14 }}>
              Default password: <code style={{ fontFamily: 'var(--mono)', color: 'var(--accent)', fontSize: 13 }}>12345678</code> — employee should change on first login.
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={onClose}>Close</button>
              <button disabled={emailLoading || emailSent} onClick={sendWelcomeEmail}
                style={{ padding: '9px 18px', background: emailSent ? 'var(--green)' : 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', cursor: (emailLoading || emailSent) ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600 }}>
                {emailLoading ? 'Sending…' : emailSent ? '✓ Email Sent' : '✉ Send Email'}
              </button>
              <button
                disabled={idLoading || !emailSent}
                onClick={createID}
                title={!emailSent ? 'Send the welcome email first' : ''}
                style={{ padding: '9px 18px', background: emailSent ? 'var(--amber)' : 'var(--border)', color: emailSent ? '#000' : 'var(--text-dim)', border: 'none', borderRadius: 'var(--radius)', cursor: (!emailSent || idLoading) ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600 }}>
                {idLoading ? 'Creating…' : !emailSent ? '🔒 Create Employee ID' : '⊕ Create Employee ID'}
              </button>
            </div>
          </>
        )}


        {/* Approval trail */}
        {(letter.approval_history || []).length > 0 && (
          <div style={{ marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 8 }}>Workflow History</div>
            {letter.approval_history.map((h, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, padding: '5px 0', borderBottom: '1px solid var(--border)', fontSize: 11 }}>
                <span style={{ fontFamily: 'var(--mono)', minWidth: 90, color: ['approve', 'submitted', 'issued', 'join_confirmed', 'id_created'].includes(h.action) ? 'var(--green)' : h.action === 'reject' ? 'var(--red)' : 'var(--text-muted)' }}>{h.action}</span>
                <span style={{ color: 'var(--text-muted)' }}>{h.user_name || h.role || ''}</span>
                <span style={{ color: 'var(--text-dim)', fontSize: 10, marginLeft: 'auto' }}>{h.timestamp?.slice(0, 10)}</span>
                {h.remarks && <span style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>"{h.remarks}"</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete Confirm
// ─────────────────────────────────────────────────────────────────────────────

function DeleteModal({ letter, onClose, onDone }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const cfg = STATUS_CFG[letter.status] || {};

  const confirm = async () => {
    setLoading(true); setError('');
    try {
      await axios.delete(`/api/letters/${letter._id}`);
      onDone(`Deleted offer letter v${letter.version} for ${letter.employee_name}.`);
    } catch (e) {
      setError(e.response?.data?.error || 'Delete failed');
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <h2 className="modal-title" style={{ color: 'var(--red)' }}>⚠ Delete Offer Letter</h2>
        <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius)', padding: 14, marginBottom: 12, fontSize: 13 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[['Employee', letter.employee_name], ['Code', letter.employee_code],
            ['Version', `v${letter.version}`]].map(([k, v]) => (
              <div key={k}><span style={{ color: 'var(--text-dim)' }}>{k}: </span><strong>{v}</strong></div>
            ))}
            <div><span style={{ color: 'var(--text-dim)' }}>Status: </span><span className={`badge ${cfg.cls}`}>{cfg.label}</span></div>
          </div>
        </div>
        <div style={{ background: 'var(--red-dim)', border: '1px solid rgba(240,82,82,0.25)', borderRadius: 'var(--radius)', padding: '10px 14px', marginBottom: 14, fontSize: 12, color: 'var(--red)' }}>
          <strong>Permanent.</strong> Record and files removed. Approved / Issued / Joined / Withdrawn letters are audit records and cannot be deleted.
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={loading}>Cancel</button>
          <button onClick={confirm} disabled={loading}
            style={{ padding: '9px 18px', background: 'var(--red)', color: 'white', border: 'none', borderRadius: 'var(--radius)', cursor: loading ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 500 }}>
            {loading ? 'Deleting…' : '✕ Delete Permanently'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EmployeeLettersView() {
  const { user } = useAuth();
  const [letters, setLetters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    axios.get('/api/letters/')
      .then(r => setLetters(r.data || []))
      .catch(() => { })
      .finally(() => setLoading(false));
  }, []);

  const SENT_STATUSES = ['issued', 'joined', 'id_created'];
  const sent = letters.filter(l => SENT_STATUSES.includes(l.status));
  const others = letters.filter(l => !SENT_STATUSES.includes(l.status));

  return (
    <div>
      {/* Header */}
      <div className="page-header" style={{ marginBottom: 32 }}>
        <div>
          <div className="page-title">My Offer Letters</div>
          <div className="page-subtitle" style={{ marginTop: 6 }}>
            Welcome, {user?.name} · {user?.emp_code}
          </div>
        </div>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <div className="spinner" style={{ width: 32, height: 32, margin: '0 auto 12px' }} />
          <div style={{ color: 'var(--text-dim)' }}>Loading your letters…</div>
        </div>
      )}

      {!loading && letters.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-dim)' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>◈</div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No offer letters yet</div>
          <div style={{ fontSize: 13 }}>Your offer letter will appear here once it has been issued.</div>
        </div>
      )}

      {!loading && letters.length > 0 && sent.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-dim)' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Letter not yet issued</div>
          <div style={{ fontSize: 13 }}>Your offer letter is being processed. It will appear here once issued.</div>
        </div>
      )}

      {/* Issued letters only */}
      {sent.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>
            ✓ Your Offer Letter{sent.length > 1 ? 's' : ''}
          </div>
          {sent.map(l => (
            <LetterCard key={l._id} letter={l} onView={() => setPreview(l)} />
          ))}
        </div>
      )}

      {preview && (
        <LetterPreviewModal letter={preview} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}

function LetterCard({ letter, onView }) {
  const cfg = STATUS_CFG[letter.status] || {};
  const isRevised = letter.letter_subtype === 'revised';

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', padding: '16px 20px', marginBottom: 10,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 8, flexShrink: 0,
          background: isRevised ? 'var(--amber-dim)' : 'var(--accent-dim)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, color: isRevised ? 'var(--amber)' : 'var(--accent)',
        }}>
          {isRevised ? '↺' : '◈'}
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>
            {isRevised ? 'Revised' : 'New'} Offer Letter
            <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-dim)', marginLeft: 8 }}>
              v{letter.version}
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
            {new Date(letter.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
            {letter.breakdown?.ctc && (
              <span style={{ marginLeft: 10, color: 'var(--text)' }}>
                · CTC: ₹{Number(letter.breakdown.ctc).toLocaleString('en-IN')}
              </span>
            )}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className={`badge ${cfg.cls}`}>{cfg.label}</span>
        {['issued', 'joined', 'id_created'].includes(letter.status) && (
          <>
            <button className="btn btn-sm btn-secondary"
              style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
              onClick={async () => {
                try {
                  const r = await axios.get(`/api/letters/${letter._id}/download?format=pdf`, { responseType: 'blob' });
                  const url = URL.createObjectURL(r.data);
                  window.open(url, '_blank');
                  setTimeout(() => URL.revokeObjectURL(url), 5000);
                } catch { alert('Could not open letter.'); }
              }}>
              ◈ View
            </button>
            <button className="btn btn-sm btn-secondary"
              onClick={async () => {
                try {
                  const r = await axios.get(`/api/letters/${letter._id}/download?format=pdf`, { responseType: 'blob' });
                  const url = URL.createObjectURL(r.data);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `offer_letter_v${letter.version}.pdf`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 5000);
                } catch { alert('Could not download letter.'); }
              }}>
              ↓ Download
            </button>
          </>
        )}
      </div>
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

export default function LettersPage() {
  const { user } = useAuth();

  const [letters, setLetters] = useState([]);
  const [employees, setEmps] = useState([]);
  const [templates, setTmpls] = useState([]);
  const [loading, setLoading] = useState(true);

  const [chooser, setChooser] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showRev, setShowRev] = useState(false);
  const [hrTarget, setHRTarget] = useState(null);
  const [submitT, setSubmitT] = useState(null);
  const [deleteT, setDeleteT] = useState(null);
  const [previewT, setPreviewT] = useState(null);
  const [directEditT, setDirectEditT] = useState(null);  // ← ADD THIS

  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [tab, setTab] = useState('active');
  const [filter, setFilter] = useState('');

  const canDelete = DELETE_ROLES.has(user?.role);
  const isHRHead = HRHEAD_ROLES.has(user?.role);
  const isEmployeeOrManager = user?.role === 'employee' || user?.role === 'manager';

  const load = useCallback(() => {
    setLoading(true);
    const qs = filter ? `?status=${filter}` : `?tab=${tab}`;
    axios.get(`/api/letters/${qs}`)
      .then(r => setLetters(r.data))
      .finally(() => setLoading(false));
  }, [tab, filter]);

  useEffect(() => { load(); }, [load]);

  const switchTab = (t) => { setTab(t); setFilter(''); };

  useEffect(() => {
    axios.get('/api/employees/?show_all=true').then(r => setEmps(r.data)).catch(() => { });
    axios.get('/api/templates/?type=offer').then(r => setTmpls(r.data.filter(t => t.is_active))).catch(() => { });
  }, []);

  if (isEmployeeOrManager) {
    return <EmployeeLettersView />;
  }

  const notify = (msg) => { setSuccess(msg); setTimeout(() => setSuccess(''), 6000); };
  const onDone = (msg) => { setShowNew(false); setShowRev(false); load(); notify(msg); };
  const onHRDone = (msg) => { setHRTarget(null); load(); notify(msg); };
  const onDelDone = (msg) => { setDeleteT(null); load(); notify(msg); };

  const submitLetter = async (letterOverride) => {
    const target = letterOverride || submitT;
    try {
      await axios.post(`/api/letters/${target._id}/submit`, {});
      setSubmitT(null); load();
      notify('Submitted to HR Head for approval.');
    } catch (e) { setError(e.response?.data?.error || 'Submit failed'); }
  };
  const dl = (id, fmt) =>
    axios.get(`/api/letters/${id}/download?format=${fmt}`, { responseType: 'blob' })
      .then(r => {
        const url = URL.createObjectURL(r.data);
        const a = document.createElement('a');
        a.href = url; a.download = `offer_letter.${fmt}`; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }).catch(e => setError(e.response?.data?.error || 'File not available'));

  const ACT_FILT = ['draft', 'pending_hr_head', 'rejected'];
  const CMP_FILT = ['approved', 'issued', 'joined', 'id_created', 'withdrawn'];
  const curFilt = tab === 'active' ? ACT_FILT : CMP_FILT;

  return (
    <div>
      <style>{datePickerStyle}</style>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Offer Letters</h1>
          <p className="page-subtitle">{letters.length} letter{letters.length !== 1 ? 's' : ''} · {tab}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setChooser(true)}>
          ◈ Generate Offer Letter
        </button>
      </div>

      {success && <div className="alert alert-success">{success}</div>}
      {error && <div className="alert alert-error" style={{ cursor: 'pointer' }} onClick={() => setError('')}>{error} ✕</div>}

      {isHRHead && (
        <div style={{ background: 'var(--accent-dim)', border: '1px solid rgba(79,142,247,0.2)', borderRadius: 'var(--radius)', padding: '8px 14px', marginBottom: 16, fontSize: 12, color: 'var(--accent)', display: 'flex', gap: 8 }}>
          <span>◎</span>
          <span><strong>HR Head:</strong> Click <strong>Review</strong> on pending letters to approve, make inline edits, issue email, confirm joining, and create employee login IDs.</span>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 4, width: 'fit-content' }}>
        {[['active', 'Active Letters'], ['completed', 'Completed Letters']].map(([k, l]) => (
          <button key={k} className={`btn btn-sm ${tab === k ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => switchTab(k)} style={{ fontSize: 12 }}>{l}</button>
        ))}
      </div>

      {/* Status filters */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--mono)' }}>Filter:</span>
        <button className={`btn btn-sm ${filter === '' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setFilter('')} style={{ fontSize: 11 }}>All</button>
        {curFilt.map(s => (
          <button key={s} className={`btn btn-sm ${filter === s ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilter(s)} style={{ fontSize: 11 }}>{STATUS_CFG[s]?.label}</button>
        ))}
      </div>

      {/* Table */}
      <div className="card">
        {loading ? <div className="page-loading"><div className="spinner" /></div> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Type</th>
                  <th>Version</th>
                  <th>Annual CTC</th>
                  {/* <th>Gross/Month</th> */}
                  <th>Status</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {letters.length === 0 ? (
                  <tr><td colSpan={7}>
                    <div className="empty-state">
                      <div className="empty-icon">◈</div>
                      <p>{tab === 'active' ? 'No active letters — click "Generate Offer Letter" to start' : 'No completed letters yet'}</p>
                    </div>
                  </td></tr>
                ) : letters.map(l => {
                  const cfg = STATUS_CFG[l.status] || {};
                  const deletable = canDelete && DELETABLE.has(l.status);
                  const pending = l.status === 'pending_hr_head';
                  const postApr = ['approved', 'issued', 'joined', 'id_created'].includes(l.status);
                  const ctc = l.breakdown?.ctc || l.context?.ctc;
                  // const grossM = l.breakdown?.gross_monthly;

                  return (
                    <tr key={l._id}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{l.employee_name}</div>
                        <div className="mono text-muted text-sm">{l.employee_code}</div>
                        {l.status === 'rejected' && (() => {
                          const rej = [...(l.approval_history || [])].reverse().find(h => h.action === 'reject');
                          return rej?.remarks ? (
                            <div style={{
                              fontSize: 10, color: 'var(--red)', fontStyle: 'italic',
                              marginTop: 3, maxWidth: 200,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                            }} title={rej.remarks}>
                              ✕ {rej.remarks}
                            </div>
                          ) : null;
                        })()}
                      </td>
                      <td>
                        <span style={{ fontSize: 11, fontFamily: 'var(--mono)', padding: '2px 8px', borderRadius: 4, background: l.letter_subtype === 'revised' ? 'var(--amber-dim)' : 'var(--accent-dim)', color: l.letter_subtype === 'revised' ? 'var(--amber)' : 'var(--accent)' }}>
                          {l.letter_subtype === 'revised' ? '↺ Revised' : '◈ New'}
                        </span>
                      </td>
                      <td><span className="badge badge-gray mono">v{l.version}</span></td>
                      <td><span className="mono" style={{ fontSize: 12 }}>{ctc ? inr(ctc) : '—'}</span></td>
                      {/* <td><span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{grossM ? inr(grossM) : '—'}</span></td> */}
                      <td><span className={`badge ${cfg.cls}`}>{cfg.label}</span></td>
                      <td className="mono text-muted text-sm">{new Date(l.created_at).toLocaleDateString('en-IN')}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>

                          {/* Preview — visible on all statuses */}
                          <button className="btn btn-sm btn-secondary"
                            style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
                            onClick={() => setPreviewT(l)}>
                            ◈ Preview
                          </button>

                          {/* Edit — only on draft or rejected */}
                          {['draft', 'rejected'].includes(l.status) && (
                            <button className="btn btn-sm btn-secondary"
                              style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}
                              onClick={() => setDirectEditT(l)}>   {/* ← ONLY THIS CHANGES */}
                              ✎ Edit
                            </button>
                          )}

                          <button className="btn btn-sm btn-secondary" onClick={() => dl(l._id, 'docx')}>↓ DOCX</button>
                          {postApr && <button className="btn btn-sm btn-secondary" onClick={() => dl(l._id, 'pdf')}>↓ PDF</button>}
                          {l.status === 'draft' && (
                            <button className="btn btn-sm btn-primary" onClick={() =>
                              ['admin', 'hr_head'].includes(user?.role) ? submitLetter(l) : setSubmitT(l)
                            }>Submit</button>
                          )}
                          {isHRHead && (pending || postApr) && (
                            <button className="btn btn-sm btn-secondary"
                              style={{ borderColor: pending ? 'var(--accent)' : 'var(--green)', color: pending ? 'var(--accent)' : 'var(--green)' }}
                              onClick={() => setHRTarget(l)}>
                              {pending ? '◎ Review' : '⊕ Manage'}
                            </button>
                          )}
                          {deletable && (
                            <button onClick={() => setDeleteT(l)}
                              style={{ padding: '6px 10px', background: 'var(--red)', color: 'white', border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 12 }}>
                              ✕
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      {chooser && <Chooser onNew={() => { setChooser(false); setShowNew(true); }} onRevised={() => { setChooser(false); setShowRev(true); }} onClose={() => setChooser(false)} />}
      {showNew && <CreateNewModal templates={templates} onClose={() => setShowNew(false)} onDone={onDone} />}
      {showRev && <RevisedModal employees={employees} templates={templates} onClose={() => setShowRev(false)} onDone={onDone} />}
      {hrTarget && <HRHeadPanel letter={hrTarget} onClose={() => setHRTarget(null)} onDone={onHRDone} />}
      {deleteT && <DeleteModal letter={deleteT} onClose={() => setDeleteT(null)} onDone={onDelDone} />}
      {previewT && <LetterPreviewModal letter={previewT} onClose={() => setPreviewT(null)} onEditDone={() => { load(); setPreviewT(null); }} />}
      {directEditT && <DirectEditModal letter={directEditT} onClose={() => setDirectEditT(null)} onEditDone={() => { load(); setDirectEditT(null); }} />}  {/* ← ADD THIS */}

      {/* Submit confirm */}
      {submitT && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setSubmitT(null)}>
          <div className="modal" style={{ maxWidth: 400 }}>
            <h2 className="modal-title">Submit to HR Head?</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
              Offer letter for <strong style={{ color: 'var(--text)' }}>{submitT.employee_name}</strong> will be sent to the HR Head for final approval. You won't be able to edit it after submission.
            </p>
            <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius)', padding: 12, marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              {['HR Draft', '→', 'HR Head Review', '→', '✓ Approved'].map((s, i) => (
                <span key={i} style={{ fontSize: 12, color: s.startsWith('✓') ? 'var(--green)' : s === '→' ? 'var(--border-bright)' : 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{s}</span>
              ))}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setSubmitT(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={submitLetter}>Submit for Approval</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}