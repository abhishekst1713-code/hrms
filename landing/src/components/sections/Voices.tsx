import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { QuotesIcon, PauseIcon, PlayIcon, CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react';
import { Eyebrow } from '../primitives';

/**
 * Illustrative quotes. Attribution is role and sector only, with no named
 * person or company invented. Swap these for approved client quotes, with
 * names, before the page goes public.
 */
const QUOTES = [
  { q: 'The appraisal window used to take three weeks of chasing. The inputs are simply there now, and we spend the time on the conversation instead.',
    r: 'Group head of people', s: 'Manufacturing' },
  { q: 'We run four companies off one deployment. Each one sees only its own records, which is what made the internal audit straightforward.',
    r: 'Director, shared services', s: 'Diversified group' },
  { q: 'The statutory register reconciling against the payroll runs on its own removed an entire month-end reconciliation from my team.',
    r: 'Finance controller', s: 'Financial services' },
  { q: 'Attendance from the biometric devices and the web logins landing in one record ended a long-running argument between plant and head office.',
    r: 'Plant HR lead', s: 'Textiles' },
  { q: 'What the board wanted was a number they could interrogate. Being able to click from a rating to the evidence behind it changed the review meeting.',
    r: 'Chief human resources officer', s: 'Public sector undertaking' },
];

const SECTORS = ['Manufacturing', 'Financial services', 'Textiles', 'Logistics',
                 'Public sector', 'Healthcare', 'Retail', 'Information technology'];

export default function Voices() {
  const reduced = useReducedMotion();
  const track = useRef<HTMLUListElement>(null);
  const [paused, setPaused] = useState(false);
  const [active, setActive] = useState(0);

  const step = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    const card = el.querySelector('li');
    const w = card ? card.getBoundingClientRect().width + 20 : 400;
    // wrap around at the ends so the rail never dead-ends
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8;
    const atStart = el.scrollLeft <= 8;
    if (dir === 1 && atEnd) el.scrollTo({ left: 0, behavior: 'smooth' });
    else if (dir === -1 && atStart) el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' });
    else el.scrollBy({ left: dir * w, behavior: 'smooth' });
  };

  // Auto-advance. Native scrolling means swipe and drag work for free.
  useEffect(() => {
    if (paused || reduced) return;
    const id = window.setInterval(() => step(1), 4200);
    return () => window.clearInterval(id);
  }, [paused, reduced]);

  // Track which card is centred, for the dots. Uses IntersectionObserver
  // rather than a scroll listener.
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const io = new IntersectionObserver(
      entries => {
        entries.forEach(e => {
          if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i));
        });
      },
      { root: el, threshold: 0.6 },
    );
    el.querySelectorAll('li').forEach(li => io.observe(li));
    return () => io.disconnect();
  }, []);

  return (
    <section className="overflow-hidden bg-surface py-16 lg:py-24">
      <div className="rail">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-[50ch]">
            <Eyebrow>Voices</Eyebrow>
            <h2 className="t-h2 mt-4 text-balance text-ink">Written for the people who sign off</h2>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => step(-1)} aria-label="Previous quote"
                className="grid h-11 w-11 place-items-center rounded-full border border-hairline
                           text-ink transition-colors hover:border-brand-400 hover:text-brand-700">
                <CaretLeftIcon size={15} weight="bold" />
              </button>
              <button type="button" onClick={() => setPaused(p => !p)}
                aria-label={paused ? 'Resume the carousel' : 'Pause the carousel'}
                className="grid h-11 w-11 place-items-center rounded-full border border-hairline
                           text-ink transition-colors hover:border-brand-400 hover:text-brand-700">
                {paused ? <PlayIcon size={14} weight="fill" /> : <PauseIcon size={14} weight="fill" />}
              </button>
              <button type="button" onClick={() => step(1)} aria-label="Next quote"
                className="grid h-11 w-11 place-items-center rounded-full border border-hairline
                           text-ink transition-colors hover:border-brand-400 hover:text-brand-700">
                <CaretRightIcon size={15} weight="bold" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Native horizontal scroller: swipe, trackpad and drag all work,
          and it stays keyboard reachable. */}
      <ul ref={track}
          onPointerEnter={() => setPaused(true)}
          onPointerLeave={() => setPaused(false)}
          onFocusCapture={() => setPaused(true)}
          className="no-scrollbar mt-10 flex snap-x snap-mandatory gap-5 overflow-x-auto
                     scroll-smooth px-[max(1.25rem,calc((100vw-1600px)/2+3.5rem))] pb-3">
        {QUOTES.map((x, i) => (
          <motion.li key={i} data-i={i}
            className="w-[300px] shrink-0 snap-start sm:w-[400px]"
            whileHover={reduced ? undefined : { y: -4 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}>
            <figure className="flex h-full flex-col justify-between rounded-[12px] border border-hairline
                               bg-surface p-6 transition-shadow duration-300 hover:shadow-[var(--shadow-md)]">
              <QuotesIcon size={22} weight="fill" aria-hidden className="text-brand-200" />
              <blockquote className="mt-4 text-[15px] leading-relaxed text-ink">{x.q}</blockquote>
              <figcaption className="mt-5 border-t border-hairline pt-4">
                <p className="text-[13px] font-700 text-ink">{x.r}</p>
                <p className="t-micro mt-1 normal-case tracking-normal text-ink-3">{x.s}</p>
              </figcaption>
            </figure>
          </motion.li>
        ))}
      </ul>

      {/* position dots */}
      <div className="rail mt-4 flex gap-1.5">
        {QUOTES.map((_, i) => (
          <span key={i} aria-hidden
            className={`h-1.5 rounded-full transition-all duration-300
              ${i === active ? 'w-6 bg-brand-500' : 'w-1.5 bg-hairline'}`} />
        ))}
      </div>

      <div className="rail mt-12">
        <p className="t-micro text-ink-3">Change management delivered across</p>
        <ul className="mt-4 flex flex-wrap gap-2">
          {SECTORS.map(s => (
            <li key={s}
                className="cursor-default rounded-full border border-hairline bg-surface-tint px-3.5 py-1.5
                           text-[13px] font-600 text-ink-2 transition-all duration-200
                           hover:-translate-y-0.5 hover:border-brand-400 hover:text-ink">
              {s}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
