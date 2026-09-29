import { useEffect, useRef, useState } from 'react';
import './LandingPage.css';

/* ── Icons ─────────────────────────────────────────────────── */
const ICONS = {
  doc: 'M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M9 13h6M9 17h5',
  users: 'M8 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.7-3.2 3-5 5.5-5s4.8 1.8 5.5 5M16 11a3 3 0 1 0 0-6M17 15c2 .4 3.4 1.9 4 4.5',
  calendar: 'M4 5h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 10h18M8 3v4M16 3v4',
  wallet: 'M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v2M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1H8a2 2 0 0 0 0 4h11',
  shield: 'M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6l7-3zM9.5 12l1.8 1.8L15 10',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  check: 'M4 12l5 5L20 6',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3.5 2',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  bolt: 'M13 2 4 14h6l-1 8 9-12h-6l1-8z',
  exit: 'M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3M10 8l-4 4 4 4M6 12h9',
  bell: 'M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6M13.7 20a2 2 0 0 1-3.4 0',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  lock: 'M6 10h12a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM8 10V7a4 4 0 0 1 8 0v3',
  plug: 'M9 3v6M15 3v6M7 9h10v4a5 5 0 0 1-10 0zM12 18v3',
};

function Icon({ name, size = 20, className = '' }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d={ICONS[name]} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── Content ───────────────────────────────────────────────── */
const NAV = [
  { label: 'Onboarding', target: 'onboarding' },
  { label: 'Attendance', target: 'attendance' },
  { label: 'Modules', target: 'modules' },
  { label: 'Platform', target: 'platform' },
];

const HERO_FACTS = [
  { label: 'Letters, leave, payroll and exits', icon: 'layers' },
  { label: 'PF, ESI, PT and TDS on every run', icon: 'wallet' },
  { label: 'Biometric attendance, no re-keying', icon: 'clock' },
];

const MARQUEE = [
  { label: 'Employees', icon: 'users' },
  { label: 'Offer Letters', icon: 'doc' },
  { label: 'Appointment Orders', icon: 'doc' },
  { label: 'Documents', icon: 'layers' },
  { label: 'Leave Tracker', icon: 'calendar' },
  { label: 'Attendance', icon: 'clock' },
  { label: 'Payslips', icon: 'wallet' },
  { label: 'Payroll Runs', icon: 'wallet' },
  { label: 'Expenses', icon: 'wallet' },
  { label: 'Approvals', icon: 'check' },
  { label: 'Workflows', icon: 'bolt' },
  { label: 'Org Chart', icon: 'users' },
  { label: 'Assets', icon: 'layers' },
  { label: 'Announcements', icon: 'bell' },
  { label: 'Policies', icon: 'shield' },
  { label: 'Audit Log', icon: 'lock' },
  { label: 'Reports', icon: 'chart' },
  { label: 'Exit and Relieving', icon: 'exit' },
];

const ONBOARDING_POINTS = [
  'The offer letter is built from your own template, with the CTC broken out across basic, HRA, DA, provident fund and group health',
  'It routes through the approval chain you configured, and the HR Head can edit it inline before signing off',
  'Approval emails it to the candidate and files it against the record, as DOCX and PDF',
  'Accepting the offer creates their login, so nobody has to set up an account separately',
  'Appointment order, joining documents and assigned assets all collect against that same record',
  'Policies queue for acknowledgement, and probation runs through to the confirmation letter',
];

const ATTENDANCE_POINTS = [
  'Punches pulled from eSSL and ZKTeco terminals over the network and de-duplicated on the way in',
  'Shift summaries, holiday calendars and incident history kept per company',
  'Web login for staff working away from a terminal',
  'Casual and sick leave capped by month, two days for regular staff and one on probation',
  'Days beyond the cap become loss of pay on the same request, and the employee sees the split before submitting',
  'Approved leave moves the balance and feeds straight into the payroll run',
];

const DOC_ITEMS = [
  { icon: 'users', title: 'People records and org chart', body: 'One record per employee carrying personal details, reporting line, documents and assigned assets. Every other module reads from it, so a change lands everywhere at once.' },
  { icon: 'doc', title: 'Letters and templates', body: 'Offer, appointment, confirmation, experience and relieving letters built from your own templates, as DOCX and PDF. Offers carry the CTC broken out across basic, HRA, DA, provident fund and group health.' },
  { icon: 'check', title: 'Approvals, expenses and workflows', body: 'Approval chains configured per company rather than per request. Each stage names the role that signs off and whether self approval is allowed. Expense claims come in with a receipt and route the same way.' },
  { icon: 'chart', title: 'Announcements, policies and reporting', body: 'A notice board that notifies the people it targets, a policy library tracking who acknowledged what, and headcount, attrition and the register of PF, ESI, PT and TDS actually withheld.' },
];

const LAYERS = [
  {
    name: 'People layer',
    desc: 'Employee records, org chart, roles and documents. The single source of truth every other module reads from.',
    tags: [{ t: 'Employees', w: 84 }, { t: 'Org chart', w: 82 }],
  },
  {
    name: 'HR operations layer',
    desc: 'Letters, onboarding, leave, attendance, expenses and exits. The day-to-day work your HR team actually runs.',
    tags: [{ t: 'Letters', w: 74 }, { t: 'Leave & attendance', w: 126 }],
  },
  {
    name: 'Automation engine',
    desc: 'Approval chains, configurable workflows and payroll runs that trigger themselves and route to the right people.',
    tags: [{ t: 'Approvals', w: 84 }, { t: 'Payroll runs', w: 96 }],
  },
  {
    name: 'Data & compliance layer',
    desc: 'Role-based access, the audit log, the compliance register and a read-only API for the systems around it.',
    tags: [{ t: 'Audit log', w: 82 }, { t: 'Access control', w: 106 }],
  },
];

const JOURNEY = [
  { phase: 'Offer', title: 'Offer', desc: 'Letter built from your template with the CTC broken out, approved, then emailed.', icon: 'mail' },
  { phase: 'Joining', title: 'Onboarding', desc: 'Accepting the offer creates the login. Documents collected, assets assigned.', icon: 'users' },
  { phase: 'Everyday', title: 'Everyday', desc: 'Attendance, leave, payslips, expenses and policies, all self-served.', icon: 'calendar' },
  { phase: 'Review', title: 'Confirmation', desc: 'Probation closes and the confirmation letter files against the same record.', icon: 'chart' },
  { phase: 'Leaving', title: 'Exit', desc: 'Resignation, manager approval, clearance, settlement and the relieving letter.', icon: 'exit' },
];

/* ── Helpers ───────────────────────────────────────────────── */
function goToLogin() {
  window.location.hash = '/login';
}

function scrollToId(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ── Page ──────────────────────────────────────────────────── */
export default function LandingPage() {
  const rootRef = useRef(null);
  const layerRefs = useRef([]);
  const [stuck, setStuck] = useState(false);
  const [layer, setLayer] = useState(1);

  /* scroll reveals */
  useEffect(() => {
    const els = rootRef.current?.querySelectorAll('[data-reveal]') ?? [];
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -60px 0px' }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  /* nav shadow on scroll */
  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 10);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /* which platform layer is centred in the viewport */
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setLayer(Number(e.target.dataset.layer));
        });
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 }
    );
    layerRefs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  const isoCx = 330;
  const isoW = 200;
  const isoH = 80;
  const isoD = 18;

  return (
    <div className="lp" ref={rootRef}>
      {/* ── Nav ── */}
      <nav className={`lp-nav ${stuck ? 'is-stuck' : ''}`}>
        <div className="lp-nav-inner">
          <button className="lp-brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <img src="/infopace-logo.webp" alt="Infopace" />
            <span className="lp-brand-divider" />
            <span className="lp-brand-text">HR Automation</span>
          </button>

          <div className="lp-nav-links">
            {NAV.map((n) => (
              <button key={n.target} className="lp-nav-link" onClick={() => scrollToId(n.target)}>
                {n.label}
              </button>
            ))}
          </div>

          <div className="lp-nav-actions">
            <button className="lp-btn lp-btn-soft lp-btn-sm" onClick={goToLogin}>
              Sign in
            </button>
            <button className="lp-btn lp-btn-primary lp-btn-sm" onClick={goToLogin}>
              Open portal <Icon name="arrow" size={15} className="lp-arrow" />
            </button>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <header className="lp-hero">
        <div className="lp-hero-split">
          <div className="lp-hero-copy">
            <span className="lp-tag" data-reveal>Infopace HR platform</span>

            <h1 className="lp-h1" data-reveal style={{ '--d': '80ms' }}>
              Run the complete employee lifecycle from one place.
            </h1>

            <p className="lp-hero-sub" data-reveal style={{ '--d': '160ms' }}>
              One employee record powers onboarding, attendance, leave, payroll, approvals, documents,
              compliance and exits without the usual spreadsheet and email sprawl.
            </p>

            <div className="lp-hero-actions" data-reveal style={{ '--d': '240ms' }}>
              <button className="lp-btn lp-btn-primary lp-btn-lg" onClick={goToLogin}>
                Sign in to workspace <Icon name="arrow" size={16} className="lp-arrow" />
              </button>
              <button className="lp-btn lp-btn-outline lp-btn-lg" onClick={() => scrollToId('modules')}>
                Explore the platform
              </button>
            </div>

            <div className="lp-trust" data-reveal style={{ '--d': '320ms' }}>
              <span className="lp-trust-label">Built for</span>
              <div className="lp-trust-items">
                <span>Onboarding</span>
                <span>Attendance</span>
                <span>Payroll</span>
                <span>Compliance</span>
              </div>
            </div>

            <div className="lp-hero-facts" data-reveal style={{ '--d': '360ms' }}>
              {HERO_FACTS.map((f) => (
                <span className="lp-hero-fact" key={f.label}>
                  <Icon name={f.icon} size={15} />
                  {f.label}
                </span>
              ))}
            </div>
          </div>

          <div className="lp-hero-panel" data-reveal style={{ '--d': '200ms' }}>
            <div className="lp-panel-topbar">
              <div className="lp-window-dots">
                <span />
                <span />
                <span />
              </div>
              <span className="lp-panel-status">Live overview</span>
            </div>

            <div className="lp-panel-metrics">
              <div className="lp-mini-stat">
                <span className="lp-mini-label">Employees</span>
                <strong>1,403</strong>
              </div>
              <div className="lp-mini-stat accent">
                <span className="lp-mini-label">Payroll</span>
                <strong>₹ 24.8L</strong>
              </div>
            </div>

            <div className="lp-panel-card">
              <div className="lp-panel-card-head">
                <span>Today</span>
                <span className="lp-pill-tag">HR</span>
              </div>

              <div className="lp-panel-figure">
                <div className="lp-ring">
                  <span>92%</span>
                </div>
                <div className="lp-ring-copy">
                  <strong>Process coverage</strong>
                  <small>Across lifecycle workflows</small>
                </div>
              </div>

              <div className="lp-panel-list">
                <div>
                  <span>Pending approvals</span>
                  <strong>18</strong>
                </div>
                <div>
                  <span>New joiners</span>
                  <strong>12</strong>
                </div>
                <div>
                  <span>Documents ready</span>
                  <strong>9</strong>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* module strip */}
        <div className="lp-marquee-wrap">
          <div className="lp-marquee-title">Modules in the portal</div>
          <div className="lp-marquee">
            {[...MARQUEE, ...MARQUEE].map((m, i) => (
              <span className="lp-mq-item" key={`${m.label}-${i}`}>
                <Icon name={m.icon} size={15} />
                {m.label}
              </span>
            ))}
          </div>
        </div>
      </header>

      {/* ── Payroll ── */}
      <section className="lp-section" id="onboarding">
        <div className="lp-zig">
          <figure className="lp-figure" data-reveal>
            <img
              src="/img/payroll-desk.webp"
              alt="Printed forms and a laptop on a desk, with someone filling in paperwork"
              width="2048"
              height="1536"
              loading="lazy"
              decoding="async"
            />
          </figure>

          <div className="lp-zig-copy" data-reveal style={{ '--d': '90ms' }}>
            <span className="lp-tag">Onboarding</span>
            <h2 className="lp-h2">Onboarding runs itself from the offer onward</h2>
            <p className="lp-lede">
              From the day you generate an offer to the day probation closes, one record carries
              the person through. Nothing is re-typed between steps.
            </p>
            <ul className="lp-points">
              {ONBOARDING_POINTS.map((p) => (
                <li key={p}>
                  <span className="lp-tick"><Icon name="check" size={11} /></span>
                  {p}
                </li>
              ))}
            </ul>
            <p className="lp-note">
              A revised offer keeps the original on record, so you can always see what changed
              and when it changed.
            </p>
          </div>
        </div>
      </section>

      {/* ── Attendance ── */}
      <section className="lp-section" id="attendance">
        <div className="lp-zig is-flipped">
          <figure className="lp-figure" data-reveal>
            <img
              src="/img/biometric-terminal.webp"
              alt="An employee marking attendance on a wall mounted biometric terminal"
              width="2048"
              height="1536"
              loading="lazy"
              decoding="async"
            />
          </figure>

          <div className="lp-zig-copy" data-reveal style={{ '--d': '90ms' }}>
            <span className="lp-tag">Attendance &amp; leave</span>
            <h2 className="lp-h2">Attendance and leave, settled before payroll runs</h2>
            <p className="lp-lede">
              The sync service writes punches straight into the month, and the leave rules decide
              what is paid before anyone has to argue about it.
            </p>
            <ul className="lp-points">
              {ATTENDANCE_POINTS.map((p) => (
                <li key={p}>
                  <span className="lp-tick"><Icon name="check" size={11} /></span>
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Documents ── */}
      <section className="lp-section lp-section-tinted" id="modules">
        <div className="lp-head" data-reveal>
          <span className="lp-tag">The suite</span>
          <h2 className="lp-h2">The rest of what the portal does</h2>
          <p className="lp-lede">
            Payroll and attendance are two of the modules. These are the others your HR team
            opens in a given week, all sitting on the same record and the same permissions.
          </p>
        </div>

        <div className="lp-docs">
          {DOC_ITEMS.map((d, i) => (
            <article className="lp-doc" key={d.title} data-reveal style={{ '--d': `${i * 70}ms` }}>
              <span className="lp-doc-ic"><Icon name={d.icon} size={19} /></span>
              <h3 className="lp-doc-title">{d.title}</h3>
              <p className="lp-doc-body">{d.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── Platform ── */}
      <section className="lp-section" id="platform">
        <div className="lp-head" data-reveal>
          <span className="lp-tag">Structure</span>
          <h2 className="lp-h2">How it fits together</h2>
          <p className="lp-lede">
            One employee record sits underneath everything. Change it once and letters,
            approvals and payroll all see the change.
          </p>
        </div>

        <div className="lp-iso-wrap">
          <div className="lp-iso" data-reveal>
            <svg viewBox="118 32 424 576" fill="none" aria-hidden="true">
              <defs>
                <linearGradient id="lpSlab" x1="130" y1="0" x2="530" y2="600" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#ffffff" />
                  <stop offset="1" stopColor="#e8f0fe" />
                </linearGradient>
                <linearGradient id="lpSlabOn" x1="130" y1="0" x2="530" y2="600" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#dde9fd" />
                  <stop offset="1" stopColor="#b9d0fb" />
                </linearGradient>
              </defs>

              <line x1={isoCx} y1="120" x2={isoCx} y2="520" stroke="#c8dafb" strokeWidth="1.5" strokeDasharray="5 7" />

              {LAYERS.map((l, i) => {
                const cy = 130 + i * 118;
                const on = layer === i;
                return (
                  <g
                    key={l.name}
                    className={`lp-iso-layer ${on ? 'is-active' : ''}`}
                    onMouseEnter={() => setLayer(i)}
                  >
                    <polygon
                      points={`${isoCx - isoW},${cy} ${isoCx},${cy + isoH} ${isoCx},${cy + isoH + isoD} ${isoCx - isoW},${cy + isoD}`}
                      fill={on ? '#9dbdf9' : '#d3e2fd'}
                    />
                    <polygon
                      points={`${isoCx},${cy + isoH} ${isoCx + isoW},${cy} ${isoCx + isoW},${cy + isoD} ${isoCx},${cy + isoH + isoD}`}
                      fill={on ? '#b6ccf9' : '#e3edfd'}
                    />
                    <polygon
                      className="lp-iso-top"
                      points={`${isoCx},${cy - isoH} ${isoCx + isoW},${cy} ${isoCx},${cy + isoH} ${isoCx - isoW},${cy}`}
                      fill={on ? 'url(#lpSlabOn)' : 'url(#lpSlab)'}
                      stroke={on ? '#3e7bfa' : '#b3cbf8'}
                      strokeWidth={on ? 1.6 : 1.3}
                    />
                    <circle cx={isoCx} cy={cy} r={on ? 7 : 5} fill={on ? '#3e7bfa' : '#b9d0fb'} />

                    {l.tags.map((tag, ti) => {
                      const tx = ti === 0 ? isoCx - 84 : isoCx + 80;
                      const ty = ti === 0 ? cy - 22 : cy + 20;
                      return (
                        <g key={tag.t}>
                          <rect
                            className="lp-iso-tag-box"
                            x={tx - tag.w / 2}
                            y={ty - 13}
                            width={tag.w}
                            height={26}
                            rx={9}
                            strokeWidth="1"
                          />
                          <text className="lp-iso-tag" x={tx} y={ty + 4} textAnchor="middle">
                            {tag.t}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="lp-iso-legend">
            {/* the reveal observer adds .is-in imperatively, so it sits on a
                wrapper whose className React never rewrites */}
            {LAYERS.map((l, i) => (
              <div
                key={l.name}
                className="lp-iso-reveal"
                data-layer={i}
                ref={(el) => {
                  layerRefs.current[i] = el;
                }}
                data-reveal
                style={{ '--d': `${i * 80}ms` }}
              >
                <button
                  className={`lp-iso-item ${layer === i ? 'is-active' : ''}`}
                  onMouseEnter={() => setLayer(i)}
                  onFocus={() => setLayer(i)}
                  onClick={() => setLayer(i)}
                >
                  <span className="lp-iso-num">{String(i + 1).padStart(2, '0')}</span>
                  <span>
                    <span className="lp-iso-name">{l.name}</span>
                    <span className="lp-iso-desc">{l.desc}</span>
                  </span>
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Lifecycle ── */}
      <section className="lp-section lp-section-tinted" id="journey">
        <div className="lp-head" data-reveal>
          <span className="lp-tag">Lifecycle</span>
          <h2 className="lp-h2">From the offer letter to the relieving letter</h2>
          <p className="lp-lede">
            The same record follows a person the whole way through, so nothing has to be
            re-typed at the end.
          </p>
        </div>

        <div className="lp-timeline" data-reveal>
          <div className="lp-ticks">
            {Array.from({ length: 56 }, (_, i) => (
              <span
                className="lp-tick-mark"
                key={i}
                style={{ height: i % 7 === 0 ? '100%' : i % 7 === 3 ? '58%' : '30%' }}
              />
            ))}
          </div>

          <div className="lp-rail">
            <span className="lp-rail-fill" />
          </div>

          <div className="lp-milestones">
            {JOURNEY.map((m) => (
              <div className="lp-ms" key={m.title}>
                <div className="lp-ms-card">
                  <span className="lp-ms-ic">
                    <Icon name={m.icon} size={17} />
                  </span>
                  <div className="lp-ms-phase">{m.phase}</div>
                  <div className="lp-ms-title">{m.title}</div>
                  <div className="lp-ms-desc">{m.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="lp-section">
        <div className="lp-cta-grid">
          <div className="lp-cta-main" data-reveal>
            <h2 className="lp-cta-title">Your HR workspace is one sign-in away</h2>
            <p className="lp-cta-sub">
              Letters, leave, attendance, payroll, expenses and approvals, with everything
              waiting exactly where you left it.
            </p>
            <button className="lp-btn lp-btn-lg lp-cta-btn" onClick={goToLogin}>
              Sign in now <Icon name="arrow" size={16} className="lp-arrow" />
            </button>
          </div>

          <div className="lp-cta-side" data-reveal style={{ '--d': '110ms' }}>
            <h3 className="lp-cta-side-title">Need access?</h3>
            <p className="lp-cta-side-desc">
              Accounts are created by your HR administrator. If you cannot sign in, these are
              the quickest routes to a fix.
            </p>
            <div className="lp-help-row">
              <Icon name="mail" size={16} />
              Ask HR to send a fresh invite link
            </div>
            <div className="lp-help-row">
              <Icon name="lock" size={16} />
              Use the &quot;Forgot password&quot; link on the sign-in page
            </div>
            <div className="lp-help-row">
              <Icon name="shield" size={16} />
              Check your company code with your manager
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-brand">
            <img src="/infopace-logo.webp" alt="Infopace" style={{ height: 30 }} />
            <p className="lp-footer-note">
              HR Automation System, the internal HR portal for Infopace India employees.
              Contact your administrator if you believe you should have access but cannot sign in.
            </p>
          </div>

          <div className="lp-footer-cols">
            <div className="lp-footer-col">
              <div className="lp-footer-col-title">The portal</div>
              <button onClick={() => scrollToId('onboarding')}>Onboarding</button>
              <button onClick={() => scrollToId('attendance')}>Attendance</button>
              <button onClick={() => scrollToId('modules')}>Modules</button>
            </div>
            <div className="lp-footer-col">
              <div className="lp-footer-col-title">Employees</div>
              <button onClick={goToLogin}>Sign in</button>
              <button onClick={goToLogin}>Payslips</button>
              <button onClick={goToLogin}>Leave requests</button>
            </div>
            <div className="lp-footer-col">
              <div className="lp-footer-col-title">Support</div>
              <button onClick={() => scrollToId('journey')}>Employee journey</button>
              <button onClick={goToLogin}>Contact HR</button>
            </div>
          </div>
        </div>

        <div className="lp-footer-base">
          <span>© {new Date().getFullYear()} Infopace India. All rights reserved.</span>
          <span>Internal use only · Role-based access</span>
        </div>
      </footer>
    </div>
  );
}
