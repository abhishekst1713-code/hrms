import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  UsersThreeIcon, CheckCircleIcon, CurrencyInrIcon, ChartLineUpIcon,
  MagnifyingGlassIcon, CheckIcon, XIcon, ArrowClockwiseIcon,
} from '@phosphor-icons/react';
import { TrendLine, BarRows } from '../charts';
import { EASE } from '../../lib/motion';

/* ---------------------------------------------------------------
   Illustrative records. Named, believable and locale-appropriate,
   but not a real customer's data.
   --------------------------------------------------------------- */
const STAFF = [
  { n: 'Tanvi Joshi',        c: 'MT116', r: 'Learning Coordinator',  d: 'Human Resources', s: 'Active' },
  { n: 'Rekha Mohanty',      c: 'MT115', r: 'Shift Supervisor',      d: 'Manufacturing',   s: 'Active' },
  { n: 'Nikhil Bhattacharya',c: 'MT114', r: 'Data Analyst',          d: 'Finance',         s: 'Active' },
  { n: 'Lakshmi Iyer',       c: 'MT113', r: 'Compliance Officer',    d: 'Legal',           s: 'Active' },
  { n: 'Sandeep Chauhan',    c: 'MT112', r: 'Warehouse Incharge',    d: 'Logistics',       s: 'Exiting' },
  { n: 'Divya Balakrishnan', c: 'MT111', r: 'Recruitment Specialist',d: 'Human Resources', s: 'Active' },
  { n: 'Karthik Raman',      c: 'MT110', r: 'Maintenance Engineer',  d: 'Facilities',      s: 'Active' },
];

const LEAVE = [
  { n: 'Arjun Venkatesan', c: 'MT108', t: 'Casual',   dt: '05 Oct - 07 Oct', d: '3d', why: 'Family function in Coimbatore', bal: 6 },
  { n: 'Lakshmi Iyer',     c: 'MT113', t: 'Sick',     dt: '29 Sep - 30 Sep', d: '2d', why: 'Viral fever, doctor advised rest', bal: 9 },
  { n: 'Sneha Patil',      c: 'MT107', t: 'Earned',   dt: '12 Oct - 20 Oct', d: '9d', why: 'Annual holiday, already planned', bal: 11 },
  { n: 'Rekha Mohanty',    c: 'MT115', t: 'Comp off', dt: '02 Oct',          d: '1d', why: 'Worked the Sunday stock count', bal: 2 },
];

const PAY = [
  { n: 'Tanvi Joshi',         c: 'MT116', g: 41600, ded: 1800 },
  { n: 'Rekha Mohanty',       c: 'MT115', g: 36725, ded: 1800 },
  { n: 'Nikhil Bhattacharya', c: 'MT114', g: 55900, ded: 2390 },
  { n: 'Lakshmi Iyer',        c: 'MT113', g: 71825, ded: 3982 },
  { n: 'Sandeep Chauhan',     c: 'MT112', g: 38675, ded: 1800 },
];

const TREND = [16,16,16,17,17,18,18,19,19,20,20,20];
const MONTHS = ['Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep'];

const inr = (n: number) => '₹' + n.toLocaleString('en-IN');
const initials = (n: string) => n.split(' ').map(p => p[0]).slice(0,2).join('');

const VIEWS = [
  { id: 'directory', label: 'Employees', icon: UsersThreeIcon },
  { id: 'approvals', label: 'Approvals', icon: CheckCircleIcon },
  { id: 'payroll',   label: 'Payroll',   icon: CurrencyInrIcon },
  { id: 'analytics', label: 'Analytics', icon: ChartLineUpIcon },
] as const;

type ViewId = typeof VIEWS[number]['id'];

/* ---------------------------------------------------------------
   A working console rather than a picture of one: every filter,
   row, approval and payroll run below actually responds.
   --------------------------------------------------------------- */
export default function LiveConsole() {
  const [view, setView] = useState<ViewId>('directory');
  const [filter, setFilter] = useState<'All' | 'Active' | 'Exiting'>('All');
  const [query, setQuery] = useState('');
  const [decided, setDecided] = useState<Record<string, 'approved' | 'rejected'>>({});
  const [runState, setRunState] = useState<'idle' | 'running' | 'done'>('idle');
  const reduced = useReducedMotion();

  const staff = STAFF.filter(p =>
    (filter === 'All' || p.s === filter) &&
    (p.n.toLowerCase().includes(query.toLowerCase()) ||
     p.c.toLowerCase().includes(query.toLowerCase()) ||
     p.r.toLowerCase().includes(query.toLowerCase())));

  const pending = LEAVE.filter(l => !decided[l.c]);

  const runPayroll = () => {
    if (runState !== 'idle') { setRunState('idle'); return; }
    setRunState('running');
    window.setTimeout(() => setRunState('done'), reduced ? 0 : 1500);
  };

  return (
    <div className="overflow-hidden rounded-[16px] border border-hairline-blue bg-surface
                    shadow-[var(--shadow-lg)]">
      {/* window chrome */}
      <div className="flex items-center gap-3 border-b border-hairline bg-surface-tint px-4 py-3">
        <div className="flex gap-1.5" aria-hidden>
          {['#EB3237', '#F5A623', '#22B07D'].map(c => (
            <span key={c} className="h-2.5 w-2.5 rounded-full" style={{ background: c, opacity: .75 }} />
          ))}
        </div>
        <p className="t-micro text-ink-3">Infopace HR, Meridian Textiles</p>
        <span className="ml-auto flex items-center gap-1.5">
          <span className="relative flex h-1.5 w-1.5">
            {!reduced && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-75" />}
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-500" />
          </span>
          <span className="t-micro text-ink-3">Interactive demo</span>
        </span>
      </div>

      <div className="grid sm:grid-cols-[168px_minmax(0,1fr)]">
        {/* rail */}
        <nav aria-label="Console sections"
             className="flex gap-1 overflow-x-auto border-b border-hairline bg-surface-tint p-2
                        sm:block sm:space-y-1 sm:overflow-visible sm:border-b-0 sm:border-r">
          {VIEWS.map(v => {
            const on = v.id === view;
            const Icon = v.icon;
            return (
              <button key={v.id} type="button" onClick={() => setView(v.id)}
                aria-current={on ? 'page' : undefined}
                className={`relative flex min-h-11 w-full shrink-0 items-center gap-2.5 rounded-[8px]
                            px-3 text-left text-[13px] font-600 transition-colors duration-200
                            ${on ? 'text-brand-700' : 'text-ink-2 hover:text-ink'}`}>
                {on && (
                  <motion.span layoutId="railPill" aria-hidden
                    className="absolute inset-0 rounded-[8px] bg-brand-50"
                    transition={{ duration: 0.28, ease: EASE }} />
                )}
                <Icon size={17} weight={on ? 'fill' : 'light'} className="relative shrink-0" aria-hidden />
                <span className="relative whitespace-nowrap">{v.label}</span>
              </button>
            );
          })}
        </nav>

        {/* stage */}
        <div className="min-h-[430px] p-4 sm:p-5">
          <AnimatePresence mode="wait">
            <motion.div key={view}
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0, y: -6 }}
              transition={{ duration: 0.26, ease: EASE }}>

              {/* ---------------- directory ---------------- */}
              {view === 'directory' && (
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="relative flex-1 min-w-[180px]">
                      <span className="sr-only">Search staff</span>
                      <MagnifyingGlassIcon size={15} weight="light" aria-hidden
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
                      <input value={query} onChange={e => setQuery(e.target.value)}
                        placeholder="Search name, ID or role"
                        className="h-11 w-full rounded-[8px] border border-hairline bg-surface pl-9 pr-3
                                   text-[13px] outline-none transition-colors placeholder:text-ink-3
                                   focus:border-brand-400" />
                    </label>
                    <div className="flex gap-1.5">
                      {(['All', 'Active', 'Exiting'] as const).map(f => (
                        <button key={f} type="button" onClick={() => setFilter(f)}
                          className={`min-h-11 rounded-full px-3.5 text-[12px] font-700 transition-colors
                            ${filter === f ? 'bg-brand-500 text-white'
                                           : 'bg-surface-tint text-ink-2 hover:text-ink'}`}>
                          {f}
                        </button>
                      ))}
                    </div>
                  </div>

                  <ul className="mt-3 divide-y divide-[var(--border)]">
                    {staff.map((p, i) => (
                      <motion.li key={p.c}
                        initial={reduced ? false : { opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.25, delay: i * 0.03, ease: EASE }}
                        className="group flex items-center gap-3 rounded-[8px] px-2 py-2.5
                                   transition-colors hover:bg-surface-tint">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full
                                         bg-brand-50 text-[11px] font-800 text-brand-700">
                          {initials(p.n)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-700 text-ink">{p.n}</span>
                          <span className="block truncate text-[11px] text-ink-3">{p.c} · {p.r}</span>
                        </span>
                        <span className="hidden text-[11px] text-ink-3 md:block">{p.d}</span>
                        <span className={`chip shrink-0 ${p.s === 'Active'
                          ? 'bg-[color-mix(in_srgb,var(--good)_12%,transparent)] text-[var(--good)]'
                          : 'bg-accent-50 text-accent-700'}`}>{p.s}</span>
                      </motion.li>
                    ))}
                    {!staff.length && (
                      <li className="py-10 text-center text-[13px] text-ink-3">
                        No records match “{query}”.
                      </li>
                    )}
                  </ul>
                  <p className="mt-3 text-[11px] text-ink-3">
                    Showing {staff.length} of {STAFF.length}. Type in the search box or pick a filter.
                  </p>
                </div>
              )}

              {/* ---------------- approvals ---------------- */}
              {view === 'approvals' && (
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[13px] font-700 text-ink">
                      {pending.length} request{pending.length === 1 ? '' : 's'} waiting on you
                    </p>
                    {Object.keys(decided).length > 0 && (
                      <button type="button" onClick={() => setDecided({})}
                        className="inline-flex min-h-11 items-center gap-1.5 text-[12px] font-700 text-brand-700">
                        <ArrowClockwiseIcon size={14} weight="bold" aria-hidden /> Reset
                      </button>
                    )}
                  </div>

                  <ul className="mt-3 grid gap-2">
                    <AnimatePresence initial={false}>
                      {LEAVE.map(l => {
                        const state = decided[l.c];
                        return (
                          <motion.li key={l.c} layout
                            initial={false}
                            animate={{ opacity: state ? 0.55 : 1 }}
                            transition={{ duration: 0.25, ease: EASE }}
                            className="rounded-[12px] border border-hairline p-3.5">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-[13px] font-700 text-ink">{l.n}</p>
                                <p className="text-[11px] text-ink-3">{l.c} · {l.t} · {l.dt}</p>
                              </div>
                              <span className="chip bg-surface-tint text-ink-2">{l.d}</span>
                            </div>
                            <p className="mt-2 text-[12px] text-ink-2">{l.why}</p>

                            <div className="mt-3 flex flex-wrap items-center justify-between gap-3
                                            border-t border-hairline pt-3">
                              <p className="text-[11px] text-ink-3">
                                Balance after approval:{' '}
                                <span className="font-800 tnum text-ink">{l.bal - parseInt(l.d)} days</span>
                              </p>
                              {state ? (
                                <span className={`chip ${state === 'approved'
                                  ? 'bg-[color-mix(in_srgb,var(--good)_12%,transparent)] text-[var(--good)]'
                                  : 'bg-accent-50 text-accent-700'}`}>
                                  {state === 'approved' ? 'Approved' : 'Rejected'}
                                </span>
                              ) : (
                                <span className="flex gap-2">
                                  <button type="button"
                                    onClick={() => setDecided(d => ({ ...d, [l.c]: 'rejected' }))}
                                    className="inline-flex min-h-11 items-center gap-1.5 rounded-[8px] border
                                               border-hairline px-3 text-[12px] font-700 text-ink-2
                                               transition-colors hover:border-accent-600 hover:text-accent-700">
                                    <XIcon size={13} weight="bold" aria-hidden /> Reject
                                  </button>
                                  <button type="button"
                                    onClick={() => setDecided(d => ({ ...d, [l.c]: 'approved' }))}
                                    className="inline-flex min-h-11 items-center gap-1.5 rounded-[8px]
                                               bg-brand-500 px-3.5 text-[12px] font-700 text-white
                                               transition-colors hover:bg-brand-600">
                                    <CheckIcon size={13} weight="bold" aria-hidden /> Approve
                                  </button>
                                </span>
                              )}
                            </div>
                          </motion.li>
                        );
                      })}
                    </AnimatePresence>
                  </ul>
                </div>
              )}

              {/* ---------------- payroll ---------------- */}
              {view === 'payroll' && (
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[13px] font-700 text-ink">September 2026</p>
                      <p className="text-[11px] text-ink-3">20 employees in this run</p>
                    </div>
                    <button type="button" onClick={runPayroll}
                      className={`inline-flex min-h-11 items-center gap-2 rounded-[8px] px-4 text-[12px]
                                  font-700 transition-colors
                        ${runState === 'done'
                          ? 'bg-[color-mix(in_srgb,var(--good)_14%,transparent)] text-[var(--good)]'
                          : 'bg-brand-500 text-white hover:bg-brand-600'}`}>
                      {runState === 'idle' && 'Run payroll'}
                      {runState === 'running' && 'Processing…'}
                      {runState === 'done' && (<><CheckIcon size={13} weight="bold" aria-hidden /> Run complete, reset</>)}
                    </button>
                  </div>

                  <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-surface-tint">
                    <motion.div className="h-full rounded-full bg-brand-500"
                      initial={false}
                      animate={{ width: runState === 'idle' ? '0%' : '100%' }}
                      transition={{ duration: runState === 'running' ? 1.5 : 0.3, ease: 'linear' }} />
                  </div>

                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-hairline">
                          {['Employee', 'Gross', 'Deductions', 'Net'].map((h, i) => (
                            <th key={h} className={`t-micro pb-2 font-700 text-ink-3 ${i ? 'text-right' : ''}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {PAY.map((r, i) => (
                          <motion.tr key={r.c}
                            initial={reduced ? false : { opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.25, delay: i * 0.04 }}
                            className="border-b border-hairline last:border-0 transition-colors hover:bg-surface-tint">
                            <td className="py-2.5">
                              <span className="block text-[13px] font-700 text-ink">{r.n}</span>
                              <span className="block text-[11px] text-ink-3">{r.c}</span>
                            </td>
                            <td className="tnum py-2.5 text-right text-[13px] text-ink">{inr(r.g)}</td>
                            <td className="tnum py-2.5 text-right text-[13px] text-accent-700">{inr(r.ded)}</td>
                            <td className="tnum py-2.5 text-right text-[13px] font-800 text-ink">
                              {runState === 'done' ? inr(r.g - r.ded) : '—'}
                            </td>
                          </motion.tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-3 text-[11px] text-ink-3">
                    Net pay resolves once the run completes. Press Run payroll.
                  </p>
                </div>
              )}

              {/* ---------------- analytics ---------------- */}
              {view === 'analytics' && (
                <div className="grid gap-4">
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    {[
                      { k: 'Headcount', v: '20' }, { k: 'Hires, 12mo', v: '4' },
                      { k: 'Exits, 12mo', v: '1' }, { k: 'Attrition', v: '0.4%' },
                    ].map(m => (
                      <div key={m.k} className="rounded-[8px] border border-hairline bg-surface-tint p-3">
                        <p className="tnum text-xl font-800 leading-none text-ink">{m.v}</p>
                        <p className="t-micro mt-1.5 text-ink-3">{m.k}</p>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-[8px] border border-hairline p-3">
                    <p className="mb-1 text-[13px] font-700 text-ink">Headcount, 12 months</p>
                    <TrendLine data={TREND} labels={MONTHS} height={140}
                      ariaLabel="Headcount rising from 16 to 20 over twelve months." />
                  </div>
                  <div className="rounded-[8px] border border-hairline p-3">
                    <p className="mb-2.5 text-[13px] font-700 text-ink">By department</p>
                    <BarRows ariaLabel="Headcount by department"
                      rows={[
                        { label: 'Human Resources', value: 4 },
                        { label: 'Manufacturing',   value: 3 },
                        { label: 'Finance',         value: 3 },
                        { label: 'Logistics',       value: 3 },
                      ]} />
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
