import { useRef } from 'react';
import { motion, useInView, useReducedMotion } from 'motion/react';
import { EASE } from '../lib/motion';

/**
 * What an HR head actually chases at month end is not a column of totals, it
 * is the list of returns and the dates they are due. So the register is shown
 * as the filing calendar for the cycle: what is owed, to whom, by when, and
 * whether the figure is ready to file. Ordered by due date, the way the month
 * is worked.
 */
const FILINGS = [
  { k: 'TDS on salary',    f: 'Challan 281',           due: '07 Oct', v: '₹28,580', ready: true,
    n: 'annualised slabs' },
  { k: 'Provident fund',   f: 'ECR · EPFO',            due: '15 Oct', v: '₹57,600', ready: true,
    n: 'employee and employer share' },
  { k: 'Employee state insurance', f: 'Contribution · ESIC', due: '15 Oct', v: '₹3,240', ready: true,
    n: 'gross up to Rs 21,000' },
  { k: 'Professional tax', f: '4 state returns',       due: '20 Oct', v: '₹3,200',  ready: true,
    n: 'KA, MH, TG, GJ' },
  { k: 'Quarterly return', f: 'Form 24Q · TRACES',     due: '31 Oct', v: 'Q2',      ready: false,
    n: 'opens once September closes' },
];

const READY = FILINGS.filter(f => f.ready).length;

export default function StatutoryRegister() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-12% 0px' });
  const reduced = useReducedMotion();

  return (
    <div ref={ref} className="panel-float overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline
                         bg-surface-tint px-5 py-3">
        <div>
          <p className="text-[13px] font-800 text-ink">Statutory filing calendar</p>
          <p className="t-micro text-ink-3">September 2026 · 16 employees</p>
        </div>
        <span className="chip bg-[color-mix(in_srgb,var(--good)_12%,transparent)] text-[var(--good)]">
          {READY} of {FILINGS.length} ready
        </span>
      </header>

      <div className="p-4">
        <ul className="grid gap-2">
          {FILINGS.map((f, i) => (
            <motion.li key={f.k}
              initial={reduced ? false : { opacity: 0, y: 10 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.45, delay: i * 0.07, ease: EASE }}
              className="flex items-center gap-3 rounded-[8px] border border-hairline px-3 py-2
                         transition-colors duration-200 hover:border-brand-400">
              {/* the due date leads: it is the thing with a deadline attached */}
              <span className="grid w-[52px] shrink-0 place-items-center rounded-[6px]
                               bg-surface-tint py-1">
                <span className="tnum text-[13px] font-800 leading-none text-ink">
                  {f.due.split(' ')[0]}
                </span>
                <span className="t-micro mt-0.5 normal-case tracking-normal text-ink-3">
                  {f.due.split(' ')[1]}
                </span>
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-700 leading-tight text-ink">{f.k}</span>
                <span className="block truncate text-[11px] text-ink-3">{f.f} · {f.n}</span>
              </span>

              <span className="tnum shrink-0 text-[14px] font-800 text-ink">{f.v}</span>

              <span className={`chip shrink-0 ${f.ready
                ? 'bg-[color-mix(in_srgb,var(--good)_12%,transparent)] text-[var(--good)]'
                : 'bg-surface-tint text-ink-3'}`}>
                {f.ready ? 'Ready' : 'Queued'}
              </span>
            </motion.li>
          ))}
        </ul>

        <motion.div
          initial={reduced ? false : { opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ duration: 0.5, delay: 0.45, ease: EASE }}
          className="mt-4 flex flex-wrap items-baseline justify-between gap-2 border-t
                     border-hairline pt-3">
          <p className="t-micro text-ink-3">Due this cycle</p>
          <p className="tnum text-[19px] font-800 text-ink">₹92,620</p>
        </motion.div>
        <p className="t-micro mt-1.5 normal-case tracking-normal text-ink-3">
          Every figure totalled from the September run. Nothing re-keyed.
        </p>
      </div>
    </div>
  );
}
