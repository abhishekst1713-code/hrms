import { useRef } from 'react';
import { motion, useInView, useReducedMotion } from 'motion/react';
import { EASE } from '../lib/motion';

const COLS = [
  { k: 'Gross',         v: '₹10,18,550', tone: 'ink' },
  { k: 'PF (employee)', v: '₹28,800',    tone: 'ink' },
  { k: 'PF (employer)', v: '₹28,800',    tone: 'ink' },
  { k: 'ESI',           v: '₹3,240',     tone: 'ink' },
  { k: 'Prof. tax',     v: '₹3,200',     tone: 'ink' },
  { k: 'TDS',           v: '₹28,580',    tone: 'ink' },
];

/**
 * The filing register, built as a component rather than shipped as a
 * screenshot: the totals count in and the bar shows how the gross
 * splits, which a flat image cannot do.
 */
export default function StatutoryRegister() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-12% 0px' });
  const reduced = useReducedMotion();

  const split = [
    { label: 'Net paid out', pct: 91.5, tone: 'var(--c1)' },
    { label: 'Statutory withheld', pct: 8.5, tone: 'var(--c3)' },
  ];

  return (
    <div ref={ref} className="panel-float overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline
                         bg-surface-tint px-5 py-3.5">
        <div>
          <p className="text-[13px] font-800 text-ink">Statutory compliance register</p>
          <p className="t-micro text-ink-3">September 2026 · 20 employees</p>
        </div>
        <span className="chip bg-[color-mix(in_srgb,var(--good)_12%,transparent)] text-[var(--good)]">
          Reconciled
        </span>
      </header>

      <div className="p-5">
        <dl className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3">
          {COLS.map((c, i) => (
            <motion.div key={c.k}
              initial={reduced ? false : { opacity: 0, y: 10 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.45, delay: i * 0.06, ease: EASE }}>
              <dt className="t-micro text-ink-3">{c.k}</dt>
              <dd className="tnum mt-1 text-[17px] font-800 text-ink">{c.v}</dd>
            </motion.div>
          ))}
        </dl>

        <div className="mt-6 border-t border-hairline pt-5">
          <p className="t-micro text-ink-3">How the gross splits</p>
          {/* 2px surface gap between the segments, so they never merge */}
          <div className="mt-2.5 flex h-3 w-full gap-0.5 overflow-hidden rounded-full">
            {split.map((s, i) => (
              <motion.span key={s.label} className="h-full first:rounded-l-full last:rounded-r-full"
                style={{ background: s.tone }}
                initial={reduced ? false : { width: 0 }}
                animate={inView ? { width: `${s.pct}%` } : {}}
                transition={{ duration: 0.9, delay: 0.35 + i * 0.12, ease: EASE }} />
            ))}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
            {split.map(s => (
              <li key={s.label} className="flex items-center gap-2 text-[12px] text-ink-2">
                <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: s.tone }} />
                {s.label}
                <span className="tnum font-800 text-ink">{s.pct}%</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
