import type { Transition, Variants } from 'motion/react';

export const EASE = [0.22, 1, 0.36, 1] as const;

export const enter: Transition = { duration: 0.6, ease: EASE };
export const quick: Transition = { duration: 0.28, ease: 'easeOut' };

/** Reveal: 16px rise + fade. The page's default entrance. */
export const revealUp: Variants = {
  hidden: { opacity: 0, y: 18 },
  show:   { opacity: 1, y: 0, transition: enter },
};

/** Container that staggers its children's reveals. */
export const stagger = (gap = 0.07): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: gap } },
});

export const viewportOnce = { once: true, margin: '-12% 0px -8% 0px' } as const;

/**
 * Scroll-linked draw progress, 0 to 1, for a chart that should paint itself
 * as the reader arrives rather than firing once on entry. The element starts
 * drawing as its top enters the viewport and finishes once its middle has
 * passed the halfway line, which is a long enough runway that the motion
 * reads as scroll-driven rather than as an animation that happened to fire. Spring-smoothed, because a raw scroll value on a trackpad is jittery.
 */
export const DRAW_OFFSET = ['start 0.95', 'center 0.45'] as const;
export const DRAW_SPRING = { stiffness: 110, damping: 30, restDelta: 0.001 } as const;
