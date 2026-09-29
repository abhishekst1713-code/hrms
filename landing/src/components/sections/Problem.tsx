import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { CheckIcon, ArrowCounterClockwiseIcon } from '@phosphor-icons/react';
import { Eyebrow, Counter } from '../primitives';
import { EASE } from '../../lib/motion';

/**
 * Each symptom carries the days it typically adds to a review cycle.
 * The weights are illustrative and the panel says so: this is a
 * conversation starter for a demo call, not a costing model.
 */
const SYMPTOMS = [
  { id: 'statutory', n: '01', days: 4,
    t: 'Statutory maths lives in a spreadsheet',
    d: 'Provident fund, state insurance, professional tax and TDS are worked out by hand each month, and the ceilings change without the sheet changing.',
    fix: 'Computed per run: PF at 12% to a Rs 15,000 ceiling, ESI to Rs 21,000 gross, professional tax by state, TDS on annualised slabs.' },
  { id: 'leave', n: '02', days: 3,
    t: 'Leave balances are argued, not looked up',
    d: 'Monthly caps differ by category, nobody agrees what is left, and loss of pay gets discovered at payroll rather than at request time.',
    fix: 'Eight leave types with a cap per category, and any overflow converted to loss of pay inside the request before it is submitted.' },
  { id: 'attendance', n: '03', days: 4,
    t: 'The device and the register disagree',
    d: 'Punches sit on the biometric machine, the office staff are on a separate sheet, and reconciling the two is somebody\u2019s week.',
    fix: 'The eSSL or ZKTeco device and the browser self-punch write to the same log, rolled into one daily record per person.' },
  { id: 'letters', n: '04', days: 3,
    t: 'Every letter is retyped from the last one',
    d: 'Offer letters are copied from a colleague\u2019s file, revisions lose the earlier version, and nobody can prove what was sent.',
    fix: 'Offer, appointment, relieving and experience letters generated from your own templates, with offers versioned across revisions.' },
  { id: 'approvals', n: '05', days: 3,
    t: 'Approvals run over email',
    d: 'A request sits in an inbox, the chain differs per document, and the only record of who signed off is a forwarded thread.',
    fix: 'Configurable multi-stage chains per document type, each stage naming its approving role and its self-approval rule.' },
];

const TOTAL = SYMPTOMS.reduce((s, x) => s + x.days, 0);

/**
 * Layout family: a diagnostic the reader fills in. Selecting the
 * symptoms that apply drives a live panel, so the section is used
 * rather than read.
 */
export default function Problem() {
  const [picked, setPicked] = useState<string[]>([]);
  const reduced = useReducedMotion();

  const toggle = (id: string) =>
    setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

  const days = SYMPTOMS.filter(s => picked.includes(s.id)).reduce((a, s) => a + s.days, 0);
  const pct = Math.round((days / TOTAL) * 100);

  return (
    <section className="relative border-y border-hairline bg-surface py-24 lg:py-32">
      <div className="rail">
        <div className="max-w-[60ch]">
          <Eyebrow tone="accent">The cost of the status quo</Eyebrow>
          <h2 className="t-h2 mt-4 text-balance text-ink">
            Why traditional performance management fails
          </h2>
          <p className="t-body-xl mt-5 text-ink-2">
            Tick the ones you recognise. The panel keeps score.
          </p>
        </div>

        <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:gap-12">
          {/* ---- the symptoms ---- */}
          <ul className="grid gap-3">
            {SYMPTOMS.map((s, i) => {
              const on = picked.includes(s.id);
              return (
                <motion.li key={s.id}
                  initial={reduced ? false : { opacity: 0, y: 14 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-12% 0px' }}
                  transition={{ duration: 0.5, delay: i * 0.07, ease: EASE }}>
                  {/* The card is flow content, so the control is a stretched
                      button over it rather than a button wrapping headings. */}
                  <div className={`group relative overflow-hidden rounded-[12px] border p-5
                                   transition-colors duration-300 sm:p-6
                      ${on ? 'border-accent bg-accent-50/60' : 'border-hairline bg-surface hover:border-brand-300'}`}>
                    <button type="button" onClick={() => toggle(s.id)} aria-pressed={on}
                      className="absolute inset-0 z-10 cursor-pointer rounded-[12px]">
                      <span className="sr-only">{on ? 'Deselect' : 'Select'} {s.t}</span>
                    </button>
                    <div className="relative flex items-start gap-4">
                      {/* the tick is the control, so it reads as selectable */}
                      <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-[8px]
                                        border transition-colors duration-200
                        ${on ? 'border-accent bg-accent text-white' : 'border-hairline bg-surface text-transparent group-hover:border-brand-400'}`}>
                        <CheckIcon size={13} weight="bold" aria-hidden />
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <span className={`tnum text-[12px] font-800 transition-colors
                            ${on ? 'text-accent-700' : 'text-ink-3'}`}>{s.n}</span>
                          <h3 className="t-h4 text-balance text-ink">{s.t}</h3>
                        </div>
                        <p className="t-body mt-2 max-w-[56ch] text-ink-2">{s.d}</p>

                        {/* the answer only appears once the reader has claimed the problem */}
                        <motion.div initial={false} aria-hidden={!on}
                          animate={{ height: on ? 'auto' : 0, opacity: on ? 1 : 0 }}
                          transition={{ duration: reduced ? 0 : 0.32, ease: EASE }}
                          className="overflow-hidden">
                          <p className="mt-3 flex items-start gap-2 border-t border-accent/20 pt-3
                                        text-[14px] font-600 text-ink">
                            <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                            {s.fix}
                          </p>
                        </motion.div>
                      </div>

                      <span className={`chip shrink-0 transition-colors
                        ${on ? 'bg-accent text-white' : 'bg-surface-tint text-ink-3'}`}>
                        +{s.days}d
                      </span>
                    </div>
                  </div>
                </motion.li>
              );
            })}
          </ul>

          {/* ---- the running tally ---- */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <div className="panel-float overflow-hidden">
              <header className="flex items-center justify-between gap-3 border-b border-hairline
                                 bg-surface-tint px-5 py-3.5">
                <p className="text-[13px] font-800 text-ink">Your exposure</p>
                {picked.length > 0 && (
                  <button type="button" onClick={() => setPicked([])}
                    className="inline-flex min-h-11 items-center gap-1.5 text-[12px] font-700 text-brand-700">
                    <ArrowCounterClockwiseIcon size={13} weight="bold" aria-hidden /> Clear
                  </button>
                )}
              </header>

              <div className="p-5" aria-live="polite">
                <p className="t-micro text-ink-3">Added to every review cycle</p>
                <p className="mt-1 flex items-baseline gap-2">
                  <span className="t-metric text-ink">
                    <Counter to={days} duration={0.5} />
                  </span>
                  <span className="text-[15px] font-700 text-ink-2">
                    day{days === 1 ? '' : 's'}
                  </span>
                </p>

                <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-surface-tint">
                  <motion.div className="h-full rounded-full bg-accent"
                    initial={false} animate={{ width: `${pct}%` }}
                    transition={{ duration: reduced ? 0 : 0.5, ease: EASE }} />
                </div>
                <p className="t-micro mt-2 text-ink-3">
                  {picked.length} of {SYMPTOMS.length} selected
                </p>

                <div className="mt-5 border-t border-hairline pt-5">
                  <motion.p key={picked.length}
                    initial={reduced ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, ease: EASE }}
                    className="text-[14px] leading-relaxed text-ink-2">
                    {picked.length === 0 &&
                      'Nothing selected yet. Most teams we speak to recognise at least three.'}
                    {picked.length > 0 && picked.length < 3 &&
                      'Each of these is a records problem before it is a people problem.'}
                    {picked.length >= 3 && picked.length < SYMPTOMS.length &&
                      'At this point the cycle is being rebuilt from memory every year.'}
                    {picked.length === SYMPTOMS.length &&
                      'All four share one cause: the evidence is not on the record when the decision is made.'}
                  </motion.p>

                  <a href="#book"
                     className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-[8px]
                                bg-brand-500 px-5 text-[14px] font-700 text-white transition-colors
                                duration-200 hover:bg-brand-600">
                    Book a demo
                  </a>
                </div>
              </div>
            </div>

            <p className="t-micro mt-3 text-ink-3">
              Day counts are illustrative, for framing a conversation.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
