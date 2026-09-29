import { motion, useReducedMotion } from 'motion/react';
import { TrendLine, BarRows, Sparkline, Gauge } from '../charts';
import { Chip, usePointer, useShift } from '../primitives';
import { EASE } from '../../lib/motion';

/* Headcount across a financial year, which is what the headcount endpoint
   returns. Nothing here promises a module the product does not ship. */
const TREND = [186, 189, 191, 196, 199, 203, 208, 211, 214, 219, 223, 228];
const MONTHS = ['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar'];

/**
 * The hero's live console. Everything here is a real, interactive
 * React component (hover the trend line, the bars and the gauge),
 * driven by illustrative figures rather than a customer's data.
 */
export default function HeroDashboard() {
  const { ref, x, y, reduced } = usePointer(1);
  // Layers shift by different amounts, which is what reads as depth.
  const baseX = useShift(x, -10), baseY = useShift(y, -8);
  const midX  = useShift(x, 18),  midY  = useShift(y, 14);
  const topX  = useShift(x, 30),  topY  = useShift(y, 24);
  const rm = useReducedMotion();

  const float = (delay: number) => rm ? {} : {
    animate: { y: [0, -9, 0] },
    transition: { duration: 6.5, repeat: Infinity, ease: 'easeInOut' as const, delay },
  };

  return (
    <div ref={ref} className="relative mx-auto w-full sm:w-[94%] lg:w-[84%]">
      {/* main console */}
      <motion.div
        style={reduced ? undefined : { x: baseX, y: baseY }}
        className="rise rise-2 panel-float relative overflow-hidden"
      >
        <header className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-6 w-6 place-items-center rounded-[8px] bg-brand-700 text-[11px] font-800 text-white">P</span>
            <div>
              <p className="text-[13px] font-700 leading-tight text-ink">Payroll and people</p>
              <p className="t-micro text-ink-3">March run, 228 employees</p>
            </div>
          </div>
        </header>

        <div className="grid gap-4 p-5">
          {/* KPI strip */}
          <div className="grid grid-cols-3 gap-2.5">
            {[
              { k: 'Payroll run',    v: '228', s: TREND.slice(5), c: 'var(--c1)' },
              { k: 'Leave pending',  v: '6',   s: [14,12,11,9,8,7,6], c: 'var(--c3)' },
              { k: 'Loss of pay',    v: '3',   s: [7,6,6,5,4,4,3], c: 'var(--c4)' },
            ].map((m, i) => (
              <div key={m.k}
                style={{ animationDelay: `${0.3 + i * 0.08}s` }}
                className="rise rounded-[8px] border border-hairline bg-surface-tint p-3">
                <p className="t-micro truncate text-ink-3">{m.k}</p>
                <div className="mt-1 flex items-end justify-between gap-1">
                  <span className="tnum text-xl font-800 leading-none text-ink">{m.v}</span>
                  <Sparkline data={m.s} color={m.c} w={52} h={20} />
                </div>
              </div>
            ))}
          </div>

          {/* trend */}
          <div className="rounded-[8px] border border-hairline p-3">
            <div className="mb-1 flex items-center justify-between">
              <p className="text-[13px] font-700 text-ink">Headcount, twelve months</p>
              <Chip tone="good">+42 net</Chip>
            </div>
            <TrendLine data={TREND} labels={MONTHS} height={148}
              ariaLabel="Headcount rising from 186 to 228 over twelve months." />
          </div>

          {/* department split */}
          <div className="rounded-[8px] border border-hairline p-3">
            <p className="mb-2.5 text-[13px] font-700 text-ink">Attendance captured, by source</p>
            <BarRows suffix="%" ariaLabel="Attendance captured by source"
              rows={[
                { label: 'Biometric device', value: 62 },
                { label: 'Web self-punch',   value: 31, tone: 'var(--c2)' },
                { label: 'Manual correction', value: 7, tone: 'var(--c4)' },
              ]} />
          </div>
        </div>
      </motion.div>

      {/* floating widget: review gauge */}
      <motion.div
        style={reduced ? undefined : { x: midX, y: midY }}
        className="absolute left-0 top-[44%] hidden -translate-x-[86%] lg:block"
        initial={rm ? false : { opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.7, delay: 0.75, ease: EASE }}
      >
        <motion.div {...float(0.4)} className="glass p-3.5">
          <Gauge value={97} label="Payslips released" size={92} color="var(--c1)" />
        </motion.div>
      </motion.div>

      {/* floating widget: live insight */}
      <motion.div
        style={reduced ? undefined : { x: topX, y: topY }}
        className="absolute right-0 top-full mt-4 hidden w-[240px] lg:block"
        initial={rm ? false : { opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.7, delay: 0.95, ease: EASE }}
      >
        <motion.div {...float(1.6)} className="glass p-3.5">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              {!rm && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-70" />}
              <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-600" />
            </span>
            <p className="t-micro text-brand-700">Payroll check</p>
          </div>
          <p className="mt-2 text-[13px] font-600 leading-snug text-ink">
            Three employees crossed the Rs 21,000 gross ceiling, so ESI stops
            from this run.
          </p>
          <p className="t-micro mt-2 text-ink-3">Flagged before approval</p>
        </motion.div>
      </motion.div>

      {/* floating widget: headcount pill */}
      <motion.div
        style={reduced ? undefined : { x: midX, y: midY }}
        className="absolute bottom-full left-0 mb-4 hidden lg:block"
        initial={rm ? false : { opacity: 0, x: -14 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.7, delay: 1.1, ease: EASE }}
      >
        <motion.div {...float(2.4)} className="glass px-3.5 py-2.5">
          <p className="t-micro text-ink-3">Active workforce</p>
          <p className="tnum text-lg font-800 leading-tight text-ink">228</p>
        </motion.div>
      </motion.div>
    </div>
  );
}
