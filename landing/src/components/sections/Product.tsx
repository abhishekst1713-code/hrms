import { useState } from 'react';
import {
  CurrencyInrIcon, CalendarBlankIcon, ClockIcon, FileTextIcon,
  LightningIcon, SignOutIcon, LockKeyIcon,
} from '@phosphor-icons/react';
import { Eyebrow, Chip } from '../primitives';
import LiveConsole, { VIEWS, type ViewId } from './LiveConsole';

/* Each point names the tab it drives, so clicking it is the same as
   clicking the tab inside the console below — the list is a second
   way into the one demo, not a separate description of it. */
const POINTS: { id: ViewId; k: string; d: string }[] = [
  { id: 'directory', k: 'Search and filter',
    d: 'Find anyone by name, code or role, then narrow by lifecycle stage.' },
  { id: 'approvals', k: 'Decide in place',
    d: 'Approve or reject leave with the resulting balance shown before you commit.' },
  { id: 'payroll',   k: 'Run and resolve',
    d: 'Payroll computes gross, deductions and net across the whole register.' },
  { id: 'analytics', k: 'Read the trend',
    d: 'Headcount, hires, exits and department split from the same records.' },
];

/* The modules beyond what the four tabs show. Same names and icons as the
   platform section, so the strip is a preview of #platform rather than a
   separate claim. Duplicated once so the CSS loop has no seam. */
const MODULES = [
  { icon: CurrencyInrIcon,   label: 'Payroll and statutory' },
  { icon: CalendarBlankIcon, label: 'Leave with real caps' },
  { icon: ClockIcon,         label: 'Attendance, two sources' },
  { icon: FileTextIcon,      label: 'Letters from your templates' },
  { icon: LightningIcon,     label: 'Configurable approval chains' },
  { icon: SignOutIcon,       label: 'Exit and clearance' },
  { icon: LockKeyIcon,       label: 'Roles, permissions and tenancy' },
];

/**
 * Layout family: a working console rather than a picture of one.
 * Every control below responds, so the section is demonstrated
 * instead of described.
 */
export default function Product() {
  const [view, setView] = useState<ViewId>('directory');

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
              run the payroll, and watch the numbers settle — no sign-up, no
              sandbox to request.
            </p>
          </div>
          <Chip tone="brand">Live &middot; click anything</Chip>
        </div>

        {/* a continuously moving strip of the modules this console doesn't
            have room for, each one a shortcut into the platform section */}
        <div className="marquee relative mt-10 overflow-hidden
                        [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]">
          <ul className="marquee-track flex w-max gap-3">
            {[...MODULES, ...MODULES].map((m, i) => (
              <li key={i} aria-hidden={i >= MODULES.length}>
                <a href="#platform"
                   tabIndex={i >= MODULES.length ? -1 : 0}
                   className="flex h-11 shrink-0 items-center gap-2 rounded-full border
                              border-hairline-blue bg-surface px-4 text-[13px] font-700
                              text-ink-2 transition-colors duration-200
                              hover:border-brand-400 hover:text-brand-700">
                  <m.icon size={16} weight="light" aria-hidden className="text-brand-600" />
                  {m.label}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)] lg:gap-12">
          <LiveConsole view={view} onViewChange={setView} />

          <ul className="grid content-start gap-4 lg:pt-2">
            {POINTS.map((p, i) => {
              const active = view === p.id;
              return (
                <li key={p.id}>
                  <button type="button" onClick={() => setView(p.id)} aria-pressed={active}
                    className={`w-full rounded-[10px] border-l-[3px] py-2 pl-4 pr-3 text-left
                                transition-colors duration-200
                      ${active ? 'border-brand-600 bg-brand-50/70' : 'border-hairline-blue hover:border-brand-400'}`}>
                    <p className={`tnum text-[13px] font-800 tracking-[0.02em]
                                   ${active ? 'text-brand-700' : 'text-ink-3'}`}>
                      {String(i + 1).padStart(2, '0')} &middot; {VIEWS.find(v => v.id === p.id)?.label}
                    </p>
                    <p className="mt-1.5 text-[17px] font-700 leading-snug text-ink">{p.k}</p>
                    <p className="mt-1 text-[14px] leading-relaxed text-ink-2">{p.d}</p>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
