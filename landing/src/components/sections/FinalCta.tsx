import { useRef, useState } from 'react';
import { motion, useScroll, useTransform, useReducedMotion } from 'motion/react';
import { ArrowRightIcon, CheckCircleIcon, WarningCircleIcon, SpinnerGapIcon } from '@phosphor-icons/react';
import { usePointer, useShift } from '../primitives';
import { EASE } from '../../lib/motion';

/* Where the form posts. Set VITE_API_URL at build time to the API's origin
   (e.g. https://api.infopaceindia.com). Falling back to '' means same-origin,
   which is right when the site is served behind the same host as the API — and
   fails loudly in the network tab rather than quietly posting to localhost from
   a production build. */
const API = import.meta.env.VITE_API_URL
  ?? (import.meta.env.DEV ? 'http://localhost:5050' : '');

const STEPS = [
  { n: 1, t: 'Book a demo',
    d: 'Share your email and a little about how your HR runs today.' },
  { n: 2, t: 'Guided walkthrough',
    d: 'We show you the records, leave, attendance and payroll screens for your roles.' },
  { n: 3, t: 'Go live',
    d: 'We set up your tenant, roles and first records with you.' },
];

type State = 'idle' | 'sending' | 'sent' | 'error';

export default function FinalCta() {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], ['-8%', '8%']);
  const { ref: area, x: px, y: py } = usePointer(1);
  const beamX = useShift(px, 90);
  const beamY = useShift(py, 60);

  const [email, setEmail] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [state, setState] = useState<State>('idle');
  const [message, setMessage] = useState('');
  // The API reports whether the confirmation actually went out. Don't promise
  // an email that SMTP failed to send — the request is still safely stored.
  const [confirmed, setConfirmed] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state === 'sending') return;
    setState('sending');
    setMessage('');
    try {
      const res = await fetch(`${API}/api/demo-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source: 'landing', company_website: honeypot }),
      });
      if (res.ok) {
        const ok = await res.json().catch(() => ({}));
        setConfirmed(Boolean(ok?.emailed?.confirmation));
        setState('sent');
        setEmail('');
        return;
      }
      // the API sends a usable sentence for a bad address; anything else is ours
      const body = await res.json().catch(() => ({}));
      setState('error');
      setMessage(res.status === 429
        ? 'Too many attempts just now. Try again in a minute.'
        : body.error || 'That did not go through. Try again, or write to us directly.');
    } catch {
      setState('error');
      setMessage('We could not reach the server. Check your connection, or write to us directly.');
    }
  };

  return (
    <section id="book" ref={ref}
      className="relative isolate overflow-hidden bg-[var(--surface-deep)] py-24 lg:py-32">

      <motion.div aria-hidden style={reduced ? undefined : { y }}
        className="pointer-events-none absolute inset-x-0 -top-[15%] h-[130%] opacity-[0.09]">
        <div className="h-full w-full"
             style={{ backgroundImage:
               'linear-gradient(to right, var(--on-deep-3) 1px, transparent 1px), linear-gradient(to bottom, var(--on-deep-3) 1px, transparent 1px)',
               backgroundSize: '72px 72px' }} />
      </motion.div>

      <div ref={area} className="relative">
        <motion.div aria-hidden
          style={reduced ? undefined : { x: beamX, y: beamY }}
          className="pointer-events-none absolute left-1/3 top-1/2 h-[520px] w-[520px]
                     -translate-x-1/2 -translate-y-1/2 rounded-full opacity-30">
          <div className="h-full w-full rounded-full"
               style={{ background: 'radial-gradient(circle, var(--d1) 0%, transparent 62%)' }} />
        </motion.div>

        <div className="rail relative grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)] lg:gap-16">

          {/* ---- left: the ask ---- */}
          <div>
            <motion.h2
              initial={reduced ? false : { opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7, ease: EASE }}
              className="t-display max-w-[14ch] text-balance text-white">
              Ready to bring your HR onto one record?
            </motion.h2>

            <motion.p
              initial={reduced ? false : { opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="t-body-xl mt-6 max-w-[46ch] text-[var(--on-deep-2)]">
              Tell us where to reach you and we will show you the platform with
              your own setup in mind.
            </motion.p>

            <motion.div
              initial={reduced ? false : { opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.18 }}
              className="mt-9">
              {state === 'sent' ? (
                <div role="status"
                     className="flex items-start gap-3 rounded-[12px] border border-[var(--good-deep)]/40
                                bg-[color-mix(in_srgb,var(--good-deep)_12%,transparent)] p-5">
                  <CheckCircleIcon size={22} weight="fill" aria-hidden
                                   className="mt-0.5 shrink-0 text-[var(--good-deep)]" />
                  <div>
                    <p className="text-[15px] font-700 text-white">Request received</p>
                    <p className="t-small mt-1 text-[var(--on-deep-2)]">
                      {confirmed
                        ? 'We have sent a confirmation to your inbox. Someone will reply to arrange a time.'
                        : 'We have your address and someone will reply to arrange a time.'}
                    </p>
                    <button type="button" onClick={() => setState('idle')}
                      className="mt-3 inline-flex min-h-11 items-center text-[13px] font-700
                                 text-[var(--on-deep-3)] underline underline-offset-4">
                      Send another
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={submit} noValidate className="flex flex-col gap-3 sm:flex-row">
                  <div className="flex-1">
                    <label htmlFor="demo-email" className="sr-only">Work email address</label>
                    <input
                      id="demo-email" type="email" required value={email}
                      onChange={e => { setEmail(e.target.value); if (state === 'error') setState('idle'); }}
                      placeholder="you@organization.com"
                      autoComplete="email" inputMode="email"
                      aria-invalid={state === 'error'}
                      aria-describedby={state === 'error' ? 'demo-error' : undefined}
                      className="h-14 w-full rounded-[12px] border border-white/20 bg-white/[0.08]
                                 px-5 text-[15px] text-white outline-none transition-colors
                                 placeholder:text-[var(--on-deep-2)]
                                 focus:border-[var(--on-deep-3)] focus:bg-white/[0.12]" />
                  </div>

                  {/* Hidden from people, tempting to bots. Parked off-screen rather
                      than display:none, which the cruder bots know to skip, and
                      never reachable: aria-hidden, tabIndex -1, no autofill. */}
                  <div aria-hidden
                       style={{ position: 'absolute', left: '-9999px', top: 'auto',
                                width: 1, height: 1, overflow: 'hidden' }}>
                    <label htmlFor="company_website">Company website</label>
                    <input id="company_website" type="text" tabIndex={-1} autoComplete="off"
                           value={honeypot} onChange={e => setHoneypot(e.target.value)} />
                  </div>

                  <button type="submit" disabled={state === 'sending'}
                    className="group inline-flex h-14 shrink-0 items-center justify-center gap-2
                               rounded-[12px] bg-white px-7 text-[15px] font-700
                               text-[var(--surface-deep)] transition-transform duration-200
                               hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-70">
                    {state === 'sending' ? (
                      <>
                        <SpinnerGapIcon size={17} weight="bold" aria-hidden
                                        className={reduced ? '' : 'animate-spin'} />
                        Sending
                      </>
                    ) : (
                      <>
                        Book a demo
                        <ArrowRightIcon size={17} weight="bold" aria-hidden
                          className="transition-transform duration-200 group-hover:translate-x-1" />
                      </>
                    )}
                  </button>
                </form>
              )}

              {state === 'error' && (
                <p id="demo-error" role="alert"
                   className="mt-3 flex items-start gap-2 text-[14px] text-[var(--crit-deep)]">
                  <WarningCircleIcon size={17} weight="fill" aria-hidden className="mt-0.5 shrink-0" />
                  {message}
                </p>
              )}

              {state !== 'sent' && (
                <p className="t-small mt-4 text-[var(--on-deep-2)]">
                  One email, to arrange the walkthrough. Or write to{' '}
                  <a href="mailto:support@infopaceindia.com"
                     className="text-[var(--on-deep-3)] underline underline-offset-4">
                    support@infopaceindia.com
                  </a>
                </p>
              )}
            </motion.div>
          </div>

          {/* ---- right: what happens next ---- */}
          <ol className="grid gap-3">
            {STEPS.map((s, i) => (
              <motion.li key={s.n}
                initial={reduced ? false : { opacity: 0, x: 24 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: '-10% 0px' }}
                transition={{ duration: 0.55, delay: 0.1 + i * 0.1, ease: EASE }}
                whileHover={reduced ? undefined : { scale: 1.015 }}
                className="flex items-start gap-4 rounded-[12px] border border-white/10
                           bg-white/[0.06] p-5 transition-colors duration-300
                           hover:border-white/25 hover:bg-white/[0.1]">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[8px]
                                 bg-white text-[15px] font-800 text-[var(--surface-deep)]">
                  {s.n}
                </span>
                <span className="min-w-0">
                  <span className="block text-[16px] font-700 text-white">{s.t}</span>
                  <span className="mt-1 block text-[14px] leading-relaxed text-[var(--on-deep-2)]">
                    {s.d}
                  </span>
                </span>
              </motion.li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
