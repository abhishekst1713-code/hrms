import { ArrowRightIcon, PlayCircleIcon } from '@phosphor-icons/react';
import HeroDashboard from './HeroDashboard';
import { Counter } from '../primitives';

/* What an HR team actually weighs up, all counted from the codebase:
   payroll_engine.py, routes/leaves.py, permissions.py. */
const PROOF = [
  { v: 4,  label: 'Statutory heads: PF, ESI, PT, TDS' },
  { v: 8,  label: 'Leave types, with monthly caps' },
  { v: 45, label: 'Permissions across 5 roles' },
];

/* The cycling word. Kept to a similar length so the stacked cell stays tight. */
const VERBS = ['Transform', 'Automate', 'Simplify', 'Unify'];

export default function Hero() {
  return (
    <section id="top" className="relative overflow-hidden pt-28 pb-20 lg:pt-32 lg:pb-28">
      {/* Zoning wash, not a SaaS gradient: a flat blue tint bounded by a hairline. */}
      <div aria-hidden className="absolute inset-0 bg-surface-tint" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-hairline-blue" />
      <div aria-hidden className="pointer-events-none absolute -right-40 top-10 h-[420px] w-[420px] rounded-full opacity-[0.07]"
           style={{ background: 'radial-gradient(circle, var(--brand) 0%, transparent 62%)' }} />

      <div className="rail relative">
        <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.02fr)] lg:gap-10 xl:gap-16">
          {/* ---- left: the declaration ---- */}
          <div>
            <div className="rise rise-1 mb-6 inline-flex items-center gap-2 rounded-full
                          border border-hairline-blue bg-surface px-3 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              <span className="t-micro text-ink-2">Infopace, operating since 1999</span>
            </div>

            <h1 className="rise rise-2 t-hero max-w-[21ch] text-ink xl:max-w-[24ch]">
              {/* One accessible label; the animation is decoration over it. */}
              <span className="sr-only">Transform HR operations with intelligent automation</span>
              <span aria-hidden>
                <span className="wordcycle text-brand-700">
                  {VERBS.map((w, i) => (
                    <span key={w} style={{ animationDelay: `${i * 3}s` }}>{w}</span>
                  ))}
                </span>{' '}
                HR operations with intelligent automation
              </span>
            </h1>

            <p className="rise rise-3 t-body-xl mt-6 max-w-[54ch] text-ink-2">
              Employee records, attendance, leave, payroll and letters on one
              record, with the statutory maths and the approval chain built in.
            </p>

            <div className="rise rise-4 mt-9 flex flex-wrap items-center gap-3">
              <a href="#book"
                 className="group inline-flex min-h-12 items-center gap-2 rounded-[8px] bg-brand-700 px-6
                            text-[15px] font-700 text-white transition-colors duration-200
                            hover:bg-brand-800 active:scale-[0.99]">
                Book a demo
                <ArrowRightIcon size={17} weight="bold" aria-hidden
                  className="transition-transform duration-200 group-hover:translate-x-1" />
              </a>
              <a href="#product"
                 className="inline-flex min-h-12 items-center gap-2 rounded-[8px] border border-hairline
                            bg-surface px-5 text-[15px] font-600 text-ink transition-colors duration-200
                            hover:border-brand-600 hover:bg-surface-tint">
                <PlayCircleIcon size={19} weight="light" aria-hidden className="text-brand-700" />
                See the product
              </a>
            </div>

            {/* proof strip: real, verifiable company facts only */}
            <dl className="rise rise-5 mt-12 grid max-w-md grid-cols-3 gap-6
                        border-t border-hairline pt-6">
              {PROOF.map(p => (
                <div key={p.label}>
                  <dt className="sr-only">{p.label}</dt>
                  <dd className="tnum text-2xl font-800 leading-none text-ink">
                    <Counter to={p.v} />
                  </dd>
                  <p className="t-micro mt-2 leading-snug text-ink-3">{p.label}</p>
                </div>
              ))}
            </dl>
          </div>

          {/* ---- right: the live console ---- */}
          <div className="relative lg:mt-14 lg:pl-4">
            <HeroDashboard />
          </div>
        </div>
      </div>
    </section>
  );
}
