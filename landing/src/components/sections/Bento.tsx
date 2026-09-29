import { useState } from 'react';
import { motion } from 'motion/react';
import {
  CurrencyInrIcon, CalendarBlankIcon, ClockIcon, FileTextIcon,
  LightningIcon, SignOutIcon, LockKeyIcon,
} from '@phosphor-icons/react';
import { Eyebrow, Chip, RevealGroup } from '../primitives';
import { BarRows } from '../charts';
import { revealUp } from '../../lib/motion';

const Item = motion.article;

/** Wraps each cell so the reveal and the hover lift are consistent. */
function Cell({ className = '', children, live }: {
  className?: string; children: React.ReactNode; live?: boolean;
}) {
  return (
    <Item variants={revealUp}
      whileHover={{ scale: 1.012 }}
      transition={{ type: 'spring', stiffness: 260, damping: 22 }}
      className={`group relative overflow-hidden rounded-[12px] border border-hairline bg-surface p-6
                  transition-[border-color,box-shadow] duration-300
                  hover:border-brand-300 hover:shadow-[0_0_0_1px_var(--blue-200),0_18px_44px_-12px_rgba(61,124,246,.38)]
                  ${className}`}>
      {/* the glow: a brand wash that lifts in behind the content on hover */}
      <span aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300
                   group-hover:opacity-100"
        style={{ background: 'radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--blue-400) 9%, transparent) 0%, transparent 70%)' }} />
      <span className="relative block">
      {live && (
        <span className="absolute right-5 top-5 z-10">
          <Chip tone="brand">Live</Chip>
        </span>
      )}
      {children}
      </span>
    </Item>
  );
}

function Title({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon size={20} weight="light" className="shrink-0 text-brand-700" aria-hidden />
      <h3 className="t-h4 text-ink">{children}</h3>
    </div>
  );
}

const CHAIN = ['Manager approval', 'HR Head review', 'Finance sign-off', 'Director approval'];

export default function Bento() {
  const [stages, setStages] = useState(2);

  return (
    <section id="platform" className="relative bg-surface-tint py-24 lg:py-32">
      <div className="rail">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-[54ch]">
            <Eyebrow>The platform</Eyebrow>
            <h2 className="t-h2 mt-4 text-balance text-ink">
              Seven modules on one employee record
            </h2>
          </div>
          <p className="t-body max-w-[42ch] text-ink-2">
            Every module below is running in the product today, and they share
            <span className="font-700 text-ink"> one employee record</span> —
            so payroll reads the same attendance your managers approved.
          </p>
        </div>

        <RevealGroup
          className="mt-12 grid auto-rows-[minmax(0,auto)] gap-4 lg:grid-cols-6"
          gap={0.06}>

          {/* 1 — payroll, the module with the hardest numbers */}
          <Cell className="lg:col-span-4" live>
            <Title icon={CurrencyInrIcon}>Payroll and statutory</Title>
            <p className="t-body mt-3 max-w-[48ch] text-ink-2">
              Provident fund, state insurance, professional tax and a monthly TDS
              estimate, computed per run with loss of pay handled inside the same pass.
            </p>
            <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { k: 'PF', v: '12% + 12%', n: 'ceiling Rs 15,000' },
                { k: 'ESI', v: '3.25% + 0.75%', n: 'gross up to Rs 21,000' },
                { k: 'Prof. tax', v: '4 states', n: 'KA, MH, TG, GJ' },
                { k: 'TDS', v: 'Monthly', n: 'annualised slabs' },
              ].map(m => (
                <div key={m.k} className="rounded-[8px] border border-hairline bg-surface-tint p-3">
                  <dt className="t-micro text-ink-3">{m.k}</dt>
                  <dd className="tnum mt-1 text-[15px] font-800 leading-tight text-ink">{m.v}</dd>
                  <p className="t-micro mt-1 normal-case tracking-normal text-ink-3">{m.n}</p>
                </div>
              ))}
            </dl>
          </Cell>

          {/* 2 — leave, with the real cap logic */}
          <Cell className="lg:col-span-2" live>
            <Title icon={CalendarBlankIcon}>Leave with real caps</Title>
            <p className="t-body mt-3 text-ink-2">
              Eight built-in types and a monthly cap per employee category. Anything
              past the cap becomes loss of pay inside the same request, before it is
              submitted.
            </p>
            <div className="mt-6">
              <BarRows suffix="/mo" max={3} ariaLabel="Monthly leave cap by employee category"
                rows={[
                  { label: 'Regular', value: 2 },
                  { label: 'Probationary', value: 1, tone: 'var(--c2)' },
                  { label: 'Female, plus ML', value: 3, tone: 'var(--c3)' },
                ]} />
            </div>
            <ul className="mt-6 flex flex-wrap gap-1.5">
              {['CL','SL','LP','ML','Maternity','OD','Comp off','Permission'].map(t => (
                <li key={t} className="chip bg-surface-tint text-ink-2">{t}</li>
              ))}
            </ul>
          </Cell>

          {/* 3 — attendance, two sources */}
          <Cell className="lg:col-span-2" live>
            <Title icon={ClockIcon}>Attendance, two sources</Title>
            <p className="t-body mt-3 text-ink-2">
              An eSSL or ZKTeco device on the floor and a browser self-punch at the
              desk write to the same punch log, then roll into one daily record.
            </p>
            <div className="mt-5 grid gap-2">
              {[
                { s: 'Biometric device', n: 'eSSL / ZKTeco polling' },
                { s: 'Web self-punch', n: 'browser check in and out' },
              ].map(x => (
                <div key={x.s} className="flex items-center gap-2.5 rounded-[8px]
                                          border border-hairline bg-surface-tint p-2.5">
                  <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-700 text-ink">{x.s}</span>
                    <span className="block text-[11px] text-ink-3">{x.n}</span>
                  </span>
                </div>
              ))}
              <p className="t-micro mt-1 text-ink-3">Both land in attendance_daily</p>
            </div>
          </Cell>

          {/* 4 — letters */}
          <Cell className="lg:col-span-4" live>
            <Title icon={FileTextIcon}>Letters from your templates</Title>
            <p className="t-body mt-3 text-ink-2">
              Offer letters are versioned, with new and revised subtypes, alongside
              appointment orders, relieving and experience letters.
            </p>
            <ol className="mt-5 flex flex-wrap items-center gap-1.5">
              {['Offer', 'Appointment', 'Relieving', 'Experience'].map(t => (
                <li key={t} className="chip bg-brand-50 text-brand-700">{t}</li>
              ))}
            </ol>
          </Cell>

          {/* 5 — approval workflows, interactive */}
          <Cell className="lg:col-span-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Title icon={LightningIcon}>Configurable approval chains</Title>
              <Chip tone="brand">Live</Chip>
            </div>
            <p className="t-body mt-3 max-w-[52ch] text-ink-2">
              Each document type carries its own ordered stages, with the approving
              role and the self-approval rule set per stage. Drag the control to see
              a chain lengthen.
            </p>
            <div className="mt-5 rounded-[8px] border border-hairline bg-surface-tint p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] font-700 text-ink">Stages in the chain</p>
                <span className="tnum text-[13px] font-800 text-brand-700">{stages}</span>
              </div>
              <input type="range" min={1} max={4} value={stages}
                     onChange={e => setStages(+e.target.value)}
                     aria-label="Number of approval stages, sample control"
                     className="mt-2 h-11 w-full cursor-pointer accent-[var(--blue-500)]" />
              <ol className="mt-2 flex flex-wrap items-center gap-1.5">
                {CHAIN.slice(0, stages).map((st, i) => (
                  <li key={st} className="flex items-center gap-1.5">
                    <span className="chip bg-surface text-ink ring-1 ring-hairline">{st}</span>
                    {i < stages - 1 && <span aria-hidden className="h-px w-3 bg-hairline" />}
                  </li>
                ))}
                <li className="flex items-center gap-1.5">
                  <span aria-hidden className="h-px w-3 bg-hairline" />
                  <span className="chip bg-[color-mix(in_srgb,var(--good)_12%,transparent)]
                                   text-[var(--good)]">Approved</span>
                </li>
              </ol>
            </div>
          </Cell>

          {/* 6 — exit pipeline */}
          <Cell className="lg:col-span-3" live>
            <Title icon={SignOutIcon}>Exit and clearance</Title>
            <p className="t-body mt-3 max-w-[46ch] text-ink-2">
              Five stages from resignation to exited, with five clearances ticked off
              before the relieving letter is released.
            </p>
            <ol className="mt-5 flex flex-wrap items-center gap-1.5">
              {['Resignation','Notice','Clearance','Cleared','Exited'].map((st, i) => (
                <li key={st} className="flex items-center gap-1.5">
                  <span className="chip bg-surface-tint text-ink-2">{st}</span>
                  {i < 4 && <span aria-hidden className="h-px w-2.5 bg-hairline" />}
                </li>
              ))}
            </ol>
            <p className="t-micro mt-3 normal-case tracking-normal text-ink-3">
              IT assets, finance, admin, HR documents and access cards
            </p>
          </Cell>

          {/* 7 — access and tenancy */}
          <Cell className="lg:col-span-3" live>
            <Title icon={LockKeyIcon}>Roles, permissions and tenancy</Title>
            <p className="t-body mt-3 max-w-[46ch] text-ink-2">
              Five seeded roles over forty five permissions, and every query scoped to
              its tenant, so one deployment serves many companies.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {['Admin', 'HR Head', 'HR', 'Manager', 'Employee'].map((r, i) => (
                <div key={r}
                     className="rounded-[8px] border border-hairline bg-surface-tint p-2.5
                                transition-colors duration-200 hover:border-brand-400">
                  <p className="t-micro truncate normal-case tracking-normal text-ink-3">{r}</p>
                  <div className="mt-2 flex gap-0.5" aria-hidden>
                    {Array.from({ length: 5 }).map((_, k) => (
                      <span key={k} className={`h-1 flex-1 rounded-full
                        ${k <= 4 - i ? 'bg-brand-500' : 'bg-slate-200'}`} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Cell>

        </RevealGroup>
      </div>
    </section>
  );
}
