import { useRef, useState } from 'react';
import {
  motion, useScroll, useTransform, useMotionValueEvent, useReducedMotion,
  type MotionValue,
} from 'motion/react';
import { Eyebrow } from '../primitives';
import { EASE } from '../../lib/motion';

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
    d: 'Punches sit on the biometric machine, the office staff are on a separate sheet, and reconciling the two is somebody’s week.',
    fix: 'The eSSL or ZKTeco device and the browser self-punch write to the same log, rolled into one daily record per person.' },
  { id: 'letters', n: '04', days: 3,
    t: 'Every letter is retyped from the last one',
    d: 'Offer letters are copied from a colleague’s file, revisions lose the earlier version, and nobody can prove what was sent.',
    fix: 'Offer, appointment, relieving and experience letters generated from your own templates, with offers versioned across revisions.' },
  { id: 'approvals', n: '05', days: 3,
    t: 'Approvals run over email',
    d: 'A request sits in an inbox, the chain differs per document, and the only record of who signed off is a forwarded thread.',
    fix: 'Configurable multi-stage chains per document type, each stage naming its approving role and its self-approval rule.' },
];

const CUMULATIVE = SYMPTOMS.reduce<number[]>((acc, s, i) => {
  acc.push((acc[i - 1] ?? 0) + s.days);
  return acc;
}, []);
const TOTAL = CUMULATIVE[CUMULATIVE.length - 1];

/** One row. Lights up when the scroll playhead reaches it, or on hover. */
function Row({ s, i, progress, hovered, setHovered }: {
  s: typeof SYMPTOMS[number]; i: number; progress: MotionValue<number>;
  hovered: number | null; setHovered: (v: number | null) => void;
}) {
  const reduced = useReducedMotion();
  const at = i / SYMPTOMS.length;
  const reached = useTransform(progress, [at - 0.02, at + 0.06], [0, 1], { clamp: true });

  // hover wins over the playhead, so the reader can look ahead
  const forced = hovered === i;
  const dim = useTransform(reached, v => 0.45 + v * 0.55);

  return (
    <motion.li
      onPointerEnter={() => setHovered(i)}
      onPointerLeave={() => setHovered(null)}
      style={reduced || forced ? undefined : { opacity: dim }}
      className="relative"
    >
      <motion.div
        animate={forced ? { scale: 1.015 } : { scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
        className={`relative overflow-hidden rounded-[12px] border p-5 transition-colors duration-300 sm:p-6
          ${forced ? 'border-accent bg-accent-50/50 shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent)_28%,transparent),0_18px_44px_-12px_rgba(235,50,55,.28)]'
                   : 'border-hairline bg-surface'}`}>

        {/* the playhead fills this rule as the section scrolls */}
        <motion.span aria-hidden style={{ scaleX: reached, transformOrigin: '0%' }}
          className="absolute inset-x-0 top-0 h-[2px] bg-accent" />

        <div className="flex items-start gap-4">
          <span className={`tnum mt-0.5 text-[12px] font-800 transition-colors duration-300
            ${forced ? 'text-accent-700' : 'text-ink-3'}`}>{s.n}</span>

          <div className="min-w-0 flex-1">
            <h3 className="t-h4 text-balance text-ink">{s.t}</h3>
            <p className="t-body mt-2 max-w-[56ch] text-ink-2">{s.d}</p>

            {/* the answer is always present, it just brightens in turn */}
            <motion.p
              style={reduced ? undefined : { opacity: forced ? 1 : reached }}
              className="mt-3 flex items-start gap-2 border-t border-hairline pt-3
                         text-[14px] font-600 text-ink">
              <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
              {s.fix}
            </motion.p>
          </div>

          <span className={`chip shrink-0 transition-colors duration-300
            ${forced ? 'bg-accent text-white' : 'bg-surface-tint text-ink-3'}`}>
            +{s.days}d
          </span>
        </div>
      </motion.div>
    </motion.li>
  );
}

/**
 * Layout family: a scroll-driven ledger. The count climbs on its own as
 * the reader moves through the list, and hovering a row jumps to it.
 * Nothing here needs to be clicked to be found.
 */
export default function Problem() {
  const track = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [hovered, setHovered] = useState<number | null>(null);
  const [days, setDays] = useState(0);

  const { scrollYProgress } = useScroll({
    target: track,
    offset: ['start 0.75', 'end 0.6'],
  });

  // Drive the running total off the same playhead. Discrete steps, so the
  // figure lands on a real value rather than an interpolated one.
  useMotionValueEvent(scrollYProgress, 'change', v => {
    const idx = Math.min(SYMPTOMS.length - 1, Math.floor(v * SYMPTOMS.length + 0.18));
    setDays(v <= 0.01 ? 0 : CUMULATIVE[idx]);
  });

  const shown = hovered != null ? CUMULATIVE[hovered] : days;
  const pct = Math.round((shown / TOTAL) * 100);

  return (
    <section className="relative border-y border-hairline bg-surface py-24 lg:py-32">
      <div className="rail">
        <div className="max-w-[60ch]">
          <Eyebrow tone="accent">The cost of the status quo</Eyebrow>
          <h2 className="t-h2 mt-4 text-balance text-ink">
            Where the month actually goes
          </h2>
          <p className="t-body-xl mt-5 text-ink-2">
            Five things that quietly add days to every cycle. Scroll, and the
            ledger on the right keeps count.
          </p>
        </div>

        <div ref={track} className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:gap-12">
          <ul className="grid gap-3">
            {SYMPTOMS.map((s, i) => (
              <Row key={s.id} s={s} i={i} progress={scrollYProgress}
                   hovered={hovered} setHovered={setHovered} />
            ))}
          </ul>

          <div className="lg:sticky lg:top-24 lg:self-start">
            <div className="panel-float overflow-hidden">
              <header className="border-b border-hairline bg-surface-tint px-5 py-3.5">
                <p className="text-[13px] font-800 text-ink">The running total</p>
              </header>

              <div className="p-5" aria-live="polite">
                <p className="t-micro text-ink-3">Added to every cycle</p>
                <p className="mt-1 flex items-baseline gap-2">
                  <motion.span key={shown}
                    initial={reduced ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.28, ease: EASE }}
                    className="t-metric tnum text-ink">{shown}</motion.span>
                  <span className="text-[15px] font-700 text-ink-2">
                    day{shown === 1 ? '' : 's'}
                  </span>
                </p>

                <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-surface-tint">
                  <motion.div className="h-full rounded-full bg-accent"
                    initial={false} animate={{ width: `${pct}%` }}
                    transition={{ duration: reduced ? 0 : 0.4, ease: EASE }} />
                </div>

                {/* per-symptom ticks, so the shape of the total is visible */}
                <ul className="mt-4 grid gap-1.5">
                  {SYMPTOMS.map((s, i) => {
                    const lit = hovered != null ? i <= hovered : CUMULATIVE[i] <= shown;
                    return (
                      <li key={s.id} className="flex items-center gap-2.5">
                        <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors
                          duration-300 ${lit ? 'bg-accent' : 'bg-hairline'}`} />
                        <span className={`flex-1 truncate text-[12px] transition-colors duration-300
                          ${lit ? 'text-ink' : 'text-ink-3'}`}>{s.t}</span>
                        <span className={`tnum text-[12px] font-700 transition-colors duration-300
                          ${lit ? 'text-accent-700' : 'text-ink-3'}`}>+{s.days}d</span>
                      </li>
                    );
                  })}
                </ul>

                <a href="#book"
                   className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-[8px]
                              bg-brand-500 px-5 text-[14px] font-700 text-white transition-colors
                              duration-200 hover:bg-brand-600">
                  Book a demo
                </a>
              </div>
            </div>

            <p className="t-micro mt-3 normal-case tracking-normal text-ink-3">
              Day counts are illustrative, for framing a conversation.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
