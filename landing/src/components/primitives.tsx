import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  motion, useInView, useMotionValue, useSpring, useReducedMotion,
  useTransform, type MotionValue,
} from 'motion/react';
import { revealUp, stagger, viewportOnce, EASE } from '../lib/motion';

/* ---------------------------------------------------------------
   Reveal on scroll
   --------------------------------------------------------------- */
export function Reveal({ children, delay = 0, className = '', as = 'div' }: {
  children: ReactNode; delay?: number; className?: string; as?: 'div' | 'li' | 'article' | 'section';
}) {
  const reduced = useReducedMotion();
  const Tag = motion[as] as typeof motion.div;
  if (reduced) return <div className={className}>{children}</div>;
  return (
    <Tag
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={viewportOnce}
      variants={revealUp}
      transition={{ delay }}
    >
      {children}
    </Tag>
  );
}

export function RevealGroup({ children, className = '', gap = 0.07 }: {
  children: ReactNode; className?: string; gap?: number;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;
  return (
    <motion.div className={className} initial="hidden" whileInView="show"
                viewport={viewportOnce} variants={stagger(gap)}>
      {children}
    </motion.div>
  );
}

/* ---------------------------------------------------------------
   KPI counter. Counts once, when it first enters the viewport.
   --------------------------------------------------------------- */
export function Counter({ to, from = 0, decimals = 0, prefix = '', suffix = '', duration = 1.6,
                          className = '' }: {
  to: number; from?: number; decimals?: number; prefix?: string; suffix?: string;
  duration?: number; className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-10% 0px' });
  const reduced = useReducedMotion();
  const [val, setVal] = useState(reduced ? to : from);

  useEffect(() => {
    if (!inView || reduced) { setVal(to); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / (duration * 1000));
      // same curve as the page's entrances, so counters feel of a piece
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(from + (to - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, reduced, to, from, duration]);

  return (
    <span ref={ref} className={`tnum ${className}`}>
      {prefix}{val.toLocaleString('en-IN', {
        minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}
    </span>
  );
}

/* ---------------------------------------------------------------
   Mouse-follow. Returns springy -1..1 offsets for the pointer's
   position inside the element, for parallax and tilt.
   --------------------------------------------------------------- */
export function usePointer(strength = 1) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const x = useSpring(mx, { stiffness: 120, damping: 20, mass: 0.4 });
  const y = useSpring(my, { stiffness: 120, damping: 20, mass: 0.4 });

  useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;
    // pointer events only; no scroll listener, no state writes
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      mx.set(((e.clientX - r.left) / r.width - 0.5) * 2 * strength);
      my.set(((e.clientY - r.top) / r.height - 0.5) * 2 * strength);
    };
    const onLeave = () => { mx.set(0); my.set(0); };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [mx, my, strength, reduced]);

  return { ref, x, y, reduced };
}

/** Maps a pointer axis to a pixel offset. */
export function useShift(v: MotionValue<number>, px: number) {
  return useTransform(v, (n) => n * px);
}

/* ---------------------------------------------------------------
   Small shared pieces
   --------------------------------------------------------------- */
export function Eyebrow({ children, tone = 'brand', align = 'start' }: {
  children: ReactNode; tone?: 'brand' | 'accent' | 'light'; align?: 'start' | 'center';
}) {
  const tones = {
    brand:  'text-brand-700',
    accent: 'text-accent-700',
    light:  'text-brand-300',
  } as const;
  const rule = <span aria-hidden className="inline-block h-px w-6 bg-current opacity-50" />;
  return (
    <p className={`t-micro flex items-center gap-2 ${tones[tone]}
                   ${align === 'center' ? 'justify-center' : ''}`}>
      {rule}
      {children}
      {/* the trailing rule only exists so a centred eyebrow is optically centred */}
      {align === 'center' && rule}
    </p>
  );
}

export function Chip({ children, tone = 'brand' }: { children: ReactNode; tone?: 'brand' | 'crit' | 'good' | 'neutral' }) {
  const tones = {
    brand:   'bg-[color-mix(in_srgb,var(--brand)_12%,transparent)] text-brand-700 ring-1 ring-[color-mix(in_srgb,var(--brand)_24%,transparent)]',
    crit:    'bg-accent-50 text-accent-700 ring-1 ring-[color-mix(in_srgb,var(--accent)_24%,transparent)]',
    good:    'bg-[color-mix(in_srgb,var(--good)_10%,transparent)] text-[var(--good)] ring-1 ring-[color-mix(in_srgb,var(--good)_22%,transparent)]',
    neutral: 'bg-slate-100 text-ink-2 ring-1 ring-hairline',
  } as const;
  return <span className={`chip ${tones[tone]}`}>{children}</span>;
}

/** Marks content that is illustrative, so sample data never reads as a real claim. */

export const transitionEase = EASE;
