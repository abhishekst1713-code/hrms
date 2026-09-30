import { Eyebrow, Chip } from '../primitives';
import LiveConsole from './LiveConsole';

/* Each point names the tab it lives on, so the list doubles as a legend for
   the console beside it rather than a wall of features. */
const POINTS = [
  { tab: 'Employees', k: 'Search and filter',
    d: 'Find anyone by name, code or role, then narrow by lifecycle stage.' },
  { tab: 'Approvals', k: 'Decide in place',
    d: 'Approve or reject leave and see the resulting balance before you commit.' },
  { tab: 'Payroll',   k: 'Run and resolve',
    d: 'One run computes gross, deductions and net across the whole register.' },
  { tab: 'Analytics', k: 'Read the trend',
    d: 'Headcount, hires, exits and department split, read off the same records.' },
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
              run the payroll and watch the numbers settle — no sign-up, no
              sandbox to request.
            </p>
          </div>
          <Chip tone="brand">Live &middot; click anything</Chip>
        </div>

        <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)] lg:gap-12">
          <LiveConsole />

          <ul className="grid content-start gap-5 lg:pt-2">
            {POINTS.map((p, i) => (
              <li key={p.k} className="border-l-2 border-hairline-blue pl-4
                                       transition-colors duration-300 hover:border-brand-400">
                <p className="flex items-center gap-2">
                  <span className="tnum t-micro text-brand-700">{String(i + 1).padStart(2, '0')}</span>
                  <span className="t-micro normal-case tracking-normal text-ink-3">
                    {p.tab} tab
                  </span>
                </p>
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
