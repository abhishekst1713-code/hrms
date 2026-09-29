import { useEffect, useState } from 'react';
import { motion, useScroll, useSpring } from 'motion/react';
import { ListIcon, XIcon } from '@phosphor-icons/react';
import { LAYER } from '../../lib/layers';

const LINKS = [
  { label: 'Platform',   href: '#platform' },
  { label: 'How it works', href: '#journey' },
  { label: 'Product',    href: '#product' },
  { label: 'Reporting',  href: '#reporting' },
];

export default function Nav() {
  const [open, setOpen] = useState(false);
  const { scrollYProgress } = useScroll();
  const bar = useSpring(scrollYProgress, { stiffness: 140, damping: 26, restDelta: 0.001 });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open]);

  return (
    <>
      <header style={{ zIndex: LAYER.nav }}
        className="fixed inset-x-0 top-0 border-b border-hairline bg-[color-mix(in_srgb,#FFFFFF_88%,transparent)] backdrop-blur-xl">
        <nav aria-label="Main" className="rail flex h-16 items-center justify-between gap-4">
          <a href="#top" className="flex h-16 shrink-0 items-center gap-2.5" aria-label="Infopace HR, home">
            <img src="/infopace-mark.webp" alt="Infopace" width={500} height={186}
                 className="h-7 w-auto sm:h-8" />
            <span className="hidden h-6 w-px bg-hairline sm:block" />
            <span className="hidden text-[13px] font-700 leading-tight tracking-[-0.01em] text-ink-2 sm:block">
              HR<br />Automation
            </span>
          </a>

          <ul className="hidden items-center gap-7 lg:flex">
            {LINKS.map(l => (
              <li key={l.href}>
                <a href={l.href}
                   className="inline-flex h-16 items-center text-[14px] font-600 text-ink
                              transition-colors duration-200 hover:text-brand-700">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>

          <div className="flex shrink-0 items-center gap-2">
            <a href="#book"
               className="hidden min-h-11 items-center rounded-[8px] bg-brand-700 px-4 text-[14px]
                          font-700 text-white transition-colors duration-200 hover:bg-brand-800 sm:inline-flex">
              Book a demo
            </a>
            <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open}
                    className="grid h-11 w-11 place-items-center rounded-[8px] text-ink lg:hidden">
              <ListIcon size={22} weight="light" />
            </button>
          </div>
        </nav>

        {/* reading progress */}
        <motion.div aria-hidden style={{ scaleX: bar, transformOrigin: '0%' }}
                    className="h-[2px] w-full bg-brand-600" />
      </header>

      <div style={{ zIndex: LAYER.menu }}
           className={`fixed inset-0 bg-white/97 backdrop-blur-xl transition-opacity duration-250 lg:hidden
                       ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
           aria-hidden={!open}>
        <div className="rail flex h-16 items-center justify-end">
          <button type="button" onClick={() => setOpen(false)} aria-label="Close menu"
                  className="grid h-11 w-11 place-items-center rounded-[8px] text-ink">
            <XIcon size={22} weight="light" />
          </button>
        </div>
        <ul className="rail mt-6 grid">
          {LINKS.map(l => (
            <li key={l.href} className="border-b border-hairline">
              <a href={l.href} onClick={() => setOpen(false)} tabIndex={open ? 0 : -1}
                 className="flex min-h-14 items-center text-[22px] font-700 tracking-[-0.02em]">
                {l.label}
              </a>
            </li>
          ))}
          <li className="mt-7">
            <a href="#book" onClick={() => setOpen(false)} tabIndex={open ? 0 : -1}
               className="inline-flex min-h-12 items-center rounded-[8px] bg-brand-700 px-6
                          text-[15px] font-700 text-white">
              Book a demo
            </a>
          </li>
        </ul>
      </div>
    </>
  );
}
