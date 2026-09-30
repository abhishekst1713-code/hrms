import { Eyebrow, Chip } from '../primitives';
import LiveConsole from './LiveConsole';

const POINTS = [
  { k: 'Search and filter', d: 'Find anyone by name, code or role, then narrow by lifecycle stage.' },
  { k: 'Decide in place',   d: 'Approve or reject leave with the resulting balance shown before you commit.' },
  { k: 'Run and resolve',   d: 'Payroll computes gross, deductions and net across the whole register.' },
  { k: 'Read the trend',    d: 'Headcount, hires, exits and department split from the same records.' },
];

/**
 * Layout family: a working console rather than a picture of one.
 * Every control below responds, so the section is demonstrated
 * instead of described.
 */
export default function Product() {
  return (
    <section id="product" className="relative overflow-hidden border-y border-hairline
                                     bg-surface-blue py-24 lg:py-32">
      <div className="rail">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-[54ch]">
            <Eyebrow>The product</Eyebrow>
            <h2 className="t-h2 mt-4 text-balance text-ink">Try it before the call</h2>
            <p className="t-body-xl mt-5 max-w-[52ch] text-ink-2">
              This is not a screenshot. Search the directory, approve a request,
              run the payroll, and watch the numbers settle.
            </p>
          </div>
          <Chip tone="brand">Click anything</Chip>
        </div>

        <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)] lg:gap-12">
          <LiveConsole />

          <ul className="grid content-start gap-5 lg:pt-2">
            {POINTS.map((p, i) => (
              <li key={p.k} className="border-l-2 border-hairline-blue pl-4
                                       transition-colors duration-300 hover:border-brand-400">
                <p className="tnum t-micro text-brand-700">{String(i + 1).padStart(2, '0')}</p>
                <p className="mt-1.5 text-[15px] font-700 text-ink">{p.k}</p>
                <p className="t-small mt-1 text-ink-2">{p.d}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
