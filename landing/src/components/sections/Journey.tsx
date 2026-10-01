import { useRef } from 'react';
import { motion, useScroll, useTransform, useReducedMotion, type MotionValue } from 'motion/react';
import { Eyebrow } from '../primitives';
import { EASE } from '../../lib/motion';

type Step = { n: number; t: string; d: string };

const STEPS: Step[] = [
  { n: 1, t: 'Offer and accept',
    d: 'The offer letter is generated from your template and routed through its approval chain. Revise the terms and it versions, keeping the copy that went before.' },
  { n: 2, t: 'Appoint and join',
    d: 'Acceptance creates the login and the appointment order follows. Joining documents are collected against the record, with Aadhaar, PAN and bank details encrypted at rest.' },
  { n: 3, t: 'Run the month',
    d: 'Attendance arrives from the device and the browser and rolls into one daily record. Leave is requested against its cap, and expenses and assets sit on the same file.' },
  { n: 4, t: 'Pay and file',
    d: 'Payroll computes provident fund, state insurance, professional tax and TDS per run, applying loss of pay in the same pass, so the payslip and the register agree.' },
  { n: 5, t: 'Exit and clear',
    d: 'Resignation opens a five-stage pipeline. IT assets, finance, admin, HR documents and access cards each clear before the relieving letter is released.' },
];

/**
 * A stage card. Its detail line opens by itself as the spine reaches the
 * stage, so the reader never has to guess that something is clickable.
 */
function StageCard({ s, i, left, progress }: {
  s: Step; i: number; left: boolean; progress: MotionValue<number>;
}) {
  const reduced = useReducedMotion();
  const at = i / STEPS.length;
  const open = useTransform(progress, [at - 0.04, at + 0.05], [0, 1], { clamp: true });
  const ring = useTransform(open, [0, 1], ['var(--border)', 'var(--blue-300)']);

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, x: left ? -28 : 28 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true, margin: '-18% 0px' }}
      transition={{ duration: 0.6, ease: EASE }}
      whileHover={reduced ? undefined : { scale: 1.015 }}
      style={{ borderColor: reduced ? undefined : ring }}
      className={`panel p-6 transition-shadow duration-300
                  hover:shadow-[0_0_0_1px_var(--blue-200),0_18px_44px_-12px_rgba(61,124,246,.34)]
                  ${left ? 'md:text-right' : ''}`}>
      <h3 className="t-h4 text-ink">{s.t}</h3>
      <p className="t-body mt-2 text-ink-2">{s.d}</p>
    </motion.div>
  );
}

function Node({ i, progress }: { i: number; progress: MotionValue<number> }) {
  const at = i / STEPS.length;
  const fill = useTransform(progress, [at - 0.06, at + 0.04], [0, 1], { clamp: true });
  const scale = useTransform(fill, [0, 1], [0.86, 1]);
  return (
    <motion.span style={{ scale }}
      className="relative z-10 grid h-11 w-11 shrink-0 place-items-center rounded-full
                 border border-hairline bg-surface">
      <motion.span style={{ opacity: fill }}
        className="absolute inset-0 rounded-full bg-brand-700" />
      <motion.span style={{ opacity: fill }}
        className="absolute inset-0 rounded-full ring-4 ring-[color-mix(in_srgb,var(--brand)_18%,transparent)]" />
      <motion.span className="relative tnum text-[13px] font-800"
        style={{ color: useTransform(fill, [0, 0.48, 0.52, 1], ['#475569', '#475569', '#FFFFFF', '#FFFFFF']) }}>
        {i + 1}
      </motion.span>
    </motion.span>
  );
}

/**
 * Layout family: a single vertical spine. The rail fills as you
 * scroll, which is the section's progress indicator.
 */
export default function Journey() {
  const track = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: track,
    offset: ['start 0.7', 'end 0.65'],
  });

  // overflow-x-clip, not hidden: the stage cards enter from x +/-28px, so a card
  // still waiting to animate in sits that far off the rail and widened the
  // document on a phone. clip does not create a scroll container, so the spine's
  // absolute positioning is untouched.
  return (
    <section id="journey" className="relative overflow-x-clip bg-surface py-24 lg:py-32">
      <div className="rail">
        <div className="mx-auto max-w-[62ch] text-center">
          <Eyebrow align="center">The method</Eyebrow>
          <h2 className="t-h2 mt-4 text-balance text-ink">Hire to exit, on one record</h2>
          <p className="t-body-xl mt-5 text-ink-2">
            One record per employee, carried through five stages. Each one leaves
            behind what the next one needs.
          </p>
        </div>

        <div ref={track} className="relative mx-auto mt-16 max-w-[900px]">
          {/* the spine */}
          <div aria-hidden className="absolute left-[21px] top-2 h-[calc(100%-2rem)] w-px bg-hairline md:left-1/2 md:-translate-x-1/2" />
          {!reduced && (
            <motion.div aria-hidden
              style={{ scaleY: scrollYProgress, transformOrigin: 'top' }}
              className="absolute left-[21px] top-2 h-[calc(100%-2rem)] w-px bg-brand-600 md:left-1/2 md:-translate-x-1/2" />
          )}

          <ol className="grid gap-10 md:gap-14">
            {STEPS.map((s, i) => {
              const left = i % 2 === 0;   // desktop: alternate sides of the spine
              const Card = <StageCard s={s} i={i} left={left} progress={scrollYProgress} />;
              return (
                <li key={s.n}
                    className="relative flex items-start gap-5 md:grid md:grid-cols-[1fr_auto_1fr] md:items-center md:gap-8">
                  {/* desktop left cell */}
                  <div className="hidden md:block">{left ? Card : null}</div>
                  <Node i={i} progress={scrollYProgress} />
                  {/* desktop right cell, and the only cell on mobile */}
                  {/* min-w-0: without it the flex item's automatic minimum is its
                      content's min-content width, so a long word in the card
                      pushes the row past the viewport on a phone. */}
                  <div className="min-w-0 flex-1 md:flex-none">
                    <div className="md:hidden">{Card}</div>
                    <div className="hidden md:block">{left ? null : Card}</div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
