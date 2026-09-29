import { useRef } from 'react';
import { motion, useScroll, useTransform, useReducedMotion } from 'motion/react';
import { ShieldCheckIcon, ListChecksIcon, ChartLineUpIcon } from '@phosphor-icons/react';
import { TrendLine } from '../charts';
import { Counter } from '../primitives';
import { EASE } from '../../lib/motion';

const HEADCOUNT = [14, 15, 15, 16, 16, 17, 17, 18, 19, 19, 20, 20];
const MONTHS = ['Oct','','Dec','','Feb','','Apr','','Jun','','Aug','Sep'];

/* Where the month's punches came from. Both sources write to
   attendance_punches and roll into attendance_daily. */
const SOURCES = [
  { k: 'Biometric device', v: 62, tone: 'var(--d1)', n: 'eSSL / ZKTeco' },
  { k: 'Web self-punch',   v: 31, tone: 'var(--d2)', n: 'browser check in' },
  { k: 'Manual correction',v: 7,  tone: 'var(--d4)', n: 'HR adjusted' },
];

const AUDIT = [
  { who: 'Priyanka Nair', did: 'released payslips', what: 'September 2026, 16 employees', ago: '2h' },
  { who: 'Ananya Krishnamurthy', did: 'approved leave', what: 'MT108, 3 days casual', ago: '5h' },
  { who: 'Priyanka Nair', did: 'generated offer letter', what: 'v2, revised terms', ago: '1d' },
];

export default function Intelligence() {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const gridY = useTransform(scrollYProgress, [0, 1], ['-6%', '6%']);
  const glowY = useTransform(scrollYProgress, [0, 1], ['12%', '-12%']);

  return (
    <section id="reporting" ref={ref}
      className="relative isolate overflow-hidden bg-[var(--surface-deep)] py-24 text-[var(--on-deep)] lg:py-32">

      <motion.div aria-hidden style={reduced ? undefined : { y: gridY }}
        className="pointer-events-none absolute inset-x-0 -top-[10%] h-[120%] opacity-[0.10]">
        <div className="h-full w-full"
             style={{ backgroundImage:
               'linear-gradient(to right, var(--on-deep-3) 1px, transparent 1px), linear-gradient(to bottom, var(--on-deep-3) 1px, transparent 1px)',
               backgroundSize: '56px 56px' }} />
      </motion.div>
      <motion.div aria-hidden style={reduced ? undefined : { y: glowY }}
        className="pointer-events-none absolute -right-32 top-1/4 h-[460px] w-[460px] rounded-full opacity-25">
        <div className="h-full w-full rounded-full"
             style={{ background: 'radial-gradient(circle, var(--d1) 0%, transparent 65%)' }} />
      </motion.div>

      <div className="rail relative">
        <div className="max-w-[58ch]">
          <p className="t-micro flex items-center gap-2 text-[var(--on-deep-3)]">
            <ChartLineUpIcon size={15} weight="bold" aria-hidden /> Reporting and compliance
          </p>
          <h2 className="t-h2 mt-4 text-balance text-white">
            The month, read back to you
          </h2>
          <p className="t-body-xl mt-5 text-[var(--on-deep-2)]">
            Headcount and the statutory register are derived from the payroll runs
            you actually processed. Nothing here is keyed in twice.
          </p>
        </div>

        <div className="mt-14 grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          {/* headcount */}
          <div className="rounded-[12px] border border-white/10 bg-white/[0.04] p-6 backdrop-blur-sm
                          transition-shadow duration-300
                          hover:shadow-[0_0_0_1px_rgba(255,255,255,.18),0_18px_44px_-12px_rgba(61,124,246,.45)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="t-h4 text-white">Headcount, twelve months</h3>
              </div>
            </div>
            <div className="mt-5">
              <TrendLine data={HEADCOUNT} labels={MONTHS} height={190} color="var(--d1)" trace
                ariaLabel="Headcount rising from fourteen to twenty over twelve months." />
            </div>
            <dl className="mt-5 grid grid-cols-3 gap-4 border-t border-white/10 pt-5">
              {[{ k: 'Current headcount', v: 20 }, { k: 'Hires, 12 months', v: 7 },
                { k: 'Exits, 12 months', v: 1 }].map(m => (
                <div key={m.k}>
                  <dd className="tnum text-2xl font-800 leading-none text-white">
                    <Counter to={m.v} />
                  </dd>
                  <dt className="t-micro mt-2 normal-case tracking-normal text-[var(--on-deep-2)]">{m.k}</dt>
                </div>
              ))}
            </dl>
          </div>

          {/* register + audit */}
          <div className="grid gap-5">
            <div className="rounded-[12px] border border-white/10 bg-white/[0.04] p-6 backdrop-blur-sm
                            transition-shadow duration-300
                            hover:shadow-[0_0_0_1px_rgba(255,255,255,.18),0_18px_44px_-12px_rgba(61,124,246,.45)]">
              <div className="flex items-center justify-between gap-3">
                <h3 className="t-h4 text-white">Where the punches came from</h3>
                <ShieldCheckIcon size={19} weight="light" className="text-[var(--good-deep)]" aria-hidden />
              </div>
              <p className="t-small mt-1 text-[var(--on-deep-2)]">September, 304 daily records</p>

              {/* one bar, three segments, each growing as the section arrives */}
              <div className="mt-5 flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-white/10">
                {SOURCES.map((x, i) => (
                  <motion.span key={x.k}
                    className="h-full first:rounded-l-full last:rounded-r-full"
                    style={{ background: x.tone }}
                    initial={reduced ? false : { width: 0 }}
                    whileInView={{ width: `${x.v}%` }}
                    viewport={{ once: true, margin: '-12% 0px' }}
                    transition={{ duration: 0.9, delay: 0.2 + i * 0.14, ease: EASE }} />
                ))}
              </div>

              <ul className="mt-5 grid gap-3">
                {SOURCES.map((x, i) => (
                  <motion.li key={x.k}
                    initial={reduced ? false : { opacity: 0, x: 12 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true, margin: '-10% 0px' }}
                    transition={{ duration: 0.45, delay: 0.3 + i * 0.1, ease: EASE }}
                    className="flex items-center gap-3">
                    <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: x.tone }} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-700 leading-tight text-white">{x.k}</span>
                      <span className="block text-[11px] text-[var(--on-deep-2)]">{x.n}</span>
                    </span>
                    <span className="tnum text-[15px] font-800 text-white">{x.v}%</span>
                  </motion.li>
                ))}
              </ul>

              <p className="t-micro mt-4 normal-case tracking-normal text-[var(--on-deep-2)]">
                Both sources write to the same punch log, then roll into one daily record.
              </p>
            </div>

            <div className="rounded-[12px] border border-white/10 bg-white/[0.04] p-6 backdrop-blur-sm
                            transition-shadow duration-300
                            hover:shadow-[0_0_0_1px_rgba(255,255,255,.18),0_18px_44px_-12px_rgba(61,124,246,.45)]">
              <div className="flex items-center justify-between gap-3">
                <h3 className="t-h4 text-white">Audit log</h3>
                <ListChecksIcon size={19} weight="light" className="text-[var(--on-deep-3)]" aria-hidden />
              </div>
              <ul className="mt-4 grid gap-3">
                {AUDIT.map(a => (
                  <li key={a.what} className="border-l-2 border-white/15 pl-3">
                    <p className="text-[13px] leading-snug text-white">
                      <span className="font-700">{a.who}</span>{' '}
                      <span className="text-[var(--on-deep-2)]">{a.did}</span>
                    </p>
                    <p className="t-micro mt-0.5 normal-case tracking-normal text-[var(--on-deep-2)]">
                      {a.what} · {a.ago} ago
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
