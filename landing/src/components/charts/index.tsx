import { useId, useMemo, useState } from 'react';
import {
  motion, useInView, useReducedMotion, useScroll, useSpring, useTransform,
  type MotionValue,
} from 'motion/react';
import { useRef } from 'react';
import { DRAW_OFFSET, DRAW_SPRING, EASE } from '../../lib/motion';

/* Shared: draw a smooth-ish path through points (Catmull-Rom to bezier). */
function linePath(pts: [number, number][], tension = 0.35) {
  if (pts.length < 2) return '';
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + ((p2[0] - p0[0]) / 6) * tension * 2;
    const c1y = p1[1] + ((p2[1] - p0[1]) / 6) * tension * 2;
    const c2x = p2[0] - ((p3[0] - p1[0]) / 6) * tension * 2;
    const c2y = p2[1] - ((p3[1] - p1[1]) / 6) * tension * 2;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}

/* ===============================================================
   Trend line with an optional dashed forecast tail, a crosshair
   and a tooltip. One series, so no legend: the title names it.
   =============================================================== */
export function TrendLine({ data, labels, forecastFrom, height = 190, color = 'var(--c1)',
                            valueSuffix = '', ariaLabel, trace = false, scrub = false }: {
  data: number[]; labels: string[]; forecastFrom?: number; height?: number;
  color?: string; valueSuffix?: string; ariaLabel: string;
  /** Run a dot along the line as it draws, so arrival is unmistakable. */
  trace?: boolean;
  /** Tie the draw to the scroll position instead of playing it once on entry. */
  scrub?: boolean;
}) {
  const uid = useId().replace(/:/g, '');
  const ref = useRef<SVGSVGElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-10% 0px' });
  const reduced = useReducedMotion();
  const [hover, setHover] = useState<number | null>(null);

  // Hooks cannot be conditional, so the scroll value is always computed and
  // only consulted when the caller asked for scrubbing.
  const { scrollYProgress } = useScroll({ target: wrap, offset: [...DRAW_OFFSET] });
  const draw = useSpring(scrollYProgress, DRAW_SPRING);
  const areaOpacity = useTransform(draw, [0, 0.3], [0, 1]);
  const headAt = useTransform(draw, v => `${Math.min(Math.max(v, 0), 1) * 100}%`);
  const headOpacity = useTransform(draw, [0, 0.05, 0.9, 1], [0, 1, 1, 0]);
  const scrubbing = scrub && !reduced;
  // The fill is clipped to the drawn width, so the shading never runs ahead
  // of the line. Points are evenly spaced in x, so path progress tracks x.
  const clipW = useTransform(draw, v => Math.min(Math.max(v, 0), 1) * 560);

  const W = 560, H = height, PAD_X = 12, PAD_T = 16, PAD_B = 26;
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const x = (i: number) => PAD_X + (i * (W - PAD_X * 2)) / (data.length - 1);
  const y = (v: number) => PAD_T + (1 - (v - min) / span) * (H - PAD_T - PAD_B);
  const pts = data.map((v, i) => [x(i), y(v)] as [number, number]);

  const split = forecastFrom ?? data.length - 1;
  const solid = linePath(pts.slice(0, split + 1));
  const dashed = forecastFrom != null ? linePath(pts.slice(split)) : '';
  const area = `${linePath(pts.slice(0, split + 1))} L ${x(split)} ${H - PAD_B} L ${PAD_X} ${H - PAD_B} Z`;

  return (
    <div ref={wrap} className="relative">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
           aria-label={ariaLabel}
           onPointerLeave={() => setHover(null)}
           onPointerMove={(e) => {
             const r = e.currentTarget.getBoundingClientRect();
             const rel = ((e.clientX - r.left) / r.width) * W;
             let best = 0, bd = Infinity;
             pts.forEach((p, i) => { const d = Math.abs(p[0] - rel); if (d < bd) { bd = d; best = i; } });
             setHover(best);
           }}>
        <defs>
          <linearGradient id={`g${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.16" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
          {scrubbing && (
            <clipPath id={`c${uid}`}>
              <motion.rect x="0" y="0" height={H} style={{ width: clipW }} />
            </clipPath>
          )}
        </defs>

        {/* recessive baseline only: no full grid */}
        <line x1={PAD_X} y1={H - PAD_B} x2={W - PAD_X} y2={H - PAD_B}
              stroke="var(--border)" strokeWidth="1" />

        <motion.path d={area} fill={`url(#g${uid})`}
          clipPath={scrubbing ? `url(#c${uid})` : undefined}
          {...(scrubbing
            ? { style: { opacity: areaOpacity } }
            : { initial: reduced ? false : { opacity: 0 },
                animate: inView ? { opacity: 1 } : {},
                transition: { duration: 0.7, delay: 0.25, ease: EASE } })} />

        <motion.path d={solid} fill="none" stroke={color} strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
          {...(scrubbing
            ? { style: { pathLength: draw } }
            : { initial: reduced ? false : { pathLength: 0 },
                animate: inView ? { pathLength: 1 } : {},
                transition: { duration: 1.1, ease: EASE } })} />

        {dashed && (
          <motion.path d={dashed} fill="none" stroke={color} strokeWidth="2"
            strokeDasharray="5 5" strokeLinecap="round" opacity="0.55"
            initial={reduced ? false : { pathLength: 0 }}
            animate={inView ? { pathLength: 1 } : {}}
            transition={{ duration: 0.7, delay: 1, ease: EASE }} />
        )}

        {/* the travelling head: rides the line while it draws */}
        {trace && !reduced && (
          scrubbing ? (
            /* the head sits wherever the scroll has drawn to, and can be
               walked back up the line by scrolling the other way */
            <motion.circle
              r="5" cx={0} cy={0} fill={color} stroke="var(--surface)" strokeWidth="2"
              style={{ offsetPath: `path("${solid}")`, offsetRotate: '0deg',
                       offsetDistance: headAt, opacity: headOpacity }}
            />
          ) : (
            <motion.circle
              r="5" cx={0} cy={0} fill={color} stroke="var(--surface)" strokeWidth="2"
              style={{ offsetPath: `path("${solid}")`, offsetRotate: '0deg' }}
              initial={{ offsetDistance: '0%', opacity: 0 }}
              animate={inView ? { offsetDistance: '100%', opacity: [0, 1, 1, 0] } : {}}
              transition={{ duration: 1.6, ease: 'easeInOut', times: undefined }}
            />
          )
        )}

        {hover != null && (
          <g>
            <line x1={x(hover)} y1={PAD_T - 6} x2={x(hover)} y2={H - PAD_B}
                  stroke="var(--ink-3)" strokeWidth="1" strokeDasharray="3 3" />
            {/* 2px surface ring so the marker reads over the line */}
            <circle cx={x(hover)} cy={y(data[hover])} r="6" fill={color}
                    stroke="var(--surface)" strokeWidth="2" />
          </g>
        )}

        {labels.map((l, i) => (
          l && i % Math.ceil(labels.length / 6) === 0 ? (
            <text key={i} x={x(i)} y={H - 8} textAnchor="middle"
                  className="t-micro" fill="var(--ink-3)" style={{ fontSize: 10 }}>{l}</text>
          ) : null
        ))}
      </svg>

      {hover != null && (
        <div className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-[8px]
                        border border-hairline bg-surface px-2 py-1 shadow-[var(--shadow-md)]"
             style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(data[hover]) / H) * 100}%` }}>
          <p className="t-micro text-ink-3">{labels[hover]}</p>
          <p className="tnum text-sm font-700 text-ink">{data[hover]}{valueSuffix}</p>
        </div>
      )}
    </div>
  );
}

/** One bar. Split out so its scroll transform can be a hook of its own. */
function Bar({ pct, tone, order, fill, inView, reduced, scrubbing }: {
  pct: number; tone: string; order: number; fill: MotionValue<number>;
  inView: boolean; reduced: boolean; scrubbing: boolean;
}) {
  // Each bar takes its own slice of the playhead, so they fill in sequence.
  const start = Math.min(order * 0.12, 0.4);
  const width = useTransform(fill, [start, start + 0.55], ['0%', `${pct}%`], { clamp: true });
  return (
    <motion.div className="h-full rounded-full" style={{ background: tone,
      ...(scrubbing ? { width } : {}) }}
      {...(scrubbing ? {} : {
        initial: reduced ? false : { width: 0 },
        animate: inView ? { width: `${pct}%` } : {},
        transition: { duration: 0.9, delay: 0.06 * order, ease: EASE },
      })} />
  );
}

/* ===============================================================
   Horizontal bars. 4px rounded data-end, 2px surface gap.
   =============================================================== */
export function BarRows({ rows, max, suffix = '', ariaLabel, scrub = false }: {
  rows: { label: string; value: number; tone?: string }[]; max?: number;
  suffix?: string; ariaLabel: string;
  /** Tie the fill to the scroll position instead of playing it once on entry. */
  scrub?: boolean;
}) {
  const ref = useRef<HTMLUListElement>(null);
  const inView = useInView(ref, { once: true, margin: '-10% 0px' });
  const reduced = useReducedMotion();
  const top = max ?? Math.max(...rows.map(r => r.value));

  const { scrollYProgress } = useScroll({ target: ref, offset: [...DRAW_OFFSET] });
  const fill = useSpring(scrollYProgress, DRAW_SPRING);
  const scrubbing = scrub && !reduced;

  return (
    <ul ref={ref} className="grid gap-3" aria-label={ariaLabel}>
      {rows.map((r, i) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="t-small truncate text-ink-2">{r.label}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <Bar pct={(r.value / top) * 100} tone={r.tone ?? 'var(--c1)'} order={i}
                   fill={fill} inView={inView} reduced={!!reduced} scrubbing={scrubbing} />
            </div>
          </div>
          <span className="tnum w-14 text-right text-sm font-700 text-ink">{r.value}{suffix}</span>
        </li>
      ))}
    </ul>
  );
}

/* ===============================================================
   Radial gauge. A single headline figure, so no legend.
   =============================================================== */
export function Gauge({ value, label, color = 'var(--c1)', size = 132 }: {
  value: number; label: string; color?: string; size?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-10% 0px' });
  const reduced = useReducedMotion();
  const R = 54, C = 2 * Math.PI * R;

  return (
    <div ref={ref} className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90" role="img"
             aria-label={`${label}: ${value} percent`}>
          <circle cx="64" cy="64" r={R} fill="none" stroke="var(--border)" strokeWidth="9" />
          <motion.circle
            cx="64" cy="64" r={R} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
            strokeDasharray={C}
            initial={reduced ? false : { strokeDashoffset: C }}
            animate={inView ? { strokeDashoffset: C - (value / 100) * C } : {}}
            transition={{ duration: 1.2, ease: EASE }}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <span className="tnum text-2xl font-800 text-ink">{value}%</span>
        </div>
      </div>
      <p className="t-small text-center text-ink-2">{label}</p>
    </div>
  );
}

/* ===============================================================
   Sparkline, for metric tiles. Decorative scale, no axis.
   =============================================================== */
export function Sparkline({ data, color = 'var(--c1)', w = 88, h = 28 }: {
  data: number[]; color?: string; w?: number; h?: number;
}) {
  const min = Math.min(...data), max = Math.max(...data), span = max - min || 1;
  const pts = data.map((v, i) => [
    (i * w) / (data.length - 1),
    h - 2 - ((v - min) / span) * (h - 4),
  ] as [number, number]);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden className="overflow-visible">
      <path d={linePath(pts)} fill="none" stroke={color} strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ===============================================================
   Heatmap. Sequential: one hue, light to dark. Values are labelled
   in the cell, so colour is never the only channel.
   =============================================================== */
export function Heatmap({ rows, cols, values, ariaLabel }: {
  rows: string[]; cols: string[]; values: number[][]; ariaLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-10% 0px' });
  const reduced = useReducedMotion();
  const [hover, setHover] = useState<string | null>(null);
  const flat = values.flat();
  const min = Math.min(...flat), max = Math.max(...flat);

  // sequential: one hue, light to dark, stepped off the royal-blue ramp
  const steps = useMemo(() => ['#EFF5FE','#DCE7FD','#B1CBFB','#6E9DF8','#3D7CF6','#3061C0'], []);
  const stepFor = (v: number) => steps[Math.min(steps.length - 1,
    Math.floor(((v - min) / ((max - min) || 1)) * steps.length))];

  return (
    <div ref={ref} className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-[2px]" aria-label={ariaLabel}>
        <thead>
          <tr>
            <th className="t-micro sticky left-0 bg-inherit pr-2 text-left font-700 text-ink-3" />
            {cols.map(c => (
              <th key={c} className="t-micro px-1 pb-1 font-700 text-ink-3">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={r}>
              <th className="t-small whitespace-nowrap pr-3 text-left font-500 text-ink-2">{r}</th>
              {cols.map((c, ci) => {
                const v = values[ri][ci];
                const key = `${ri}-${ci}`;
                const dark = v > (min + max) / 2;
                return (
                  <td key={c} className="p-0">
                    <motion.div
                      onPointerEnter={() => setHover(key)}
                      onPointerLeave={() => setHover(null)}
                      className="grid h-9 min-w-[42px] place-items-center rounded-[8px] text-[11px] font-700 tnum"
                      style={{
                        background: stepFor(v),
                        color: dark ? '#FFFFFF' : 'var(--ink)',
                        outline: hover === key ? '2px solid var(--ink)' : '2px solid transparent',
                      }}
                      initial={reduced ? false : { opacity: 0, scale: 0.86 }}
                      animate={inView ? { opacity: 1, scale: 1 } : {}}
                      transition={{ duration: 0.4, delay: (ri * cols.length + ci) * 0.012, ease: EASE }}
                    >
                      {v}
                    </motion.div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
