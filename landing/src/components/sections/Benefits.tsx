import { useRef } from 'react';
import { motion, useScroll, useTransform, useReducedMotion } from 'motion/react';
import { Eyebrow, Counter, Chip } from '../primitives';
import { Gauge, BarRows } from '../charts';
import StatutoryRegister from '../StatutoryRegister';
import { EASE } from '../../lib/motion';

/**
 * Layout family: alternating storytelling blocks. Media and prose
 * swap sides, and the media parallaxes a little against the copy so
 * the rhythm is felt rather than just seen.
 */
function Block({ flip, children, media }: {
  flip?: boolean; children: React.ReactNode; media: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], [26, -26]);

  return (
    <div ref={ref} className="grid items-start gap-10 lg:grid-cols-2 lg:gap-16">
      <motion.div
        initial={reduced ? false : { opacity: 0, x: flip ? 30 : -30 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true, margin: '-15% 0px' }}
        transition={{ duration: 0.65, ease: EASE }}
        className={flip ? 'lg:order-2' : ''}>
        {children}
      </motion.div>
      <motion.div style={reduced ? undefined : { y }} className={flip ? 'lg:order-1' : ''}>
        {media}
      </motion.div>
    </div>
  );
}

export default function Benefits() {
  // overflow-x-clip for the same reason as Journey: each Block enters from
  // x +/-30px, so a block still waiting to animate in sat 30px off the rail and
  // widened the document on a phone. clip does not create a scroll container.
  return (
    <section className="overflow-x-clip bg-surface py-16 lg:py-24">
      <div className="rail">
        <div className="max-w-[54ch]">
          <Eyebrow>Outcomes</Eyebrow>
          <h2 className="t-h2 mt-4 text-balance text-ink">What changes once it is running</h2>
        </div>

        <div className="mt-10 grid gap-12 lg:gap-16">
          <Block media={
            <div className="panel-float p-7">
              <div className="flex items-center justify-between gap-3">
                <p className="t-micro text-ink-3">Hours per appraisal cycle</p>
                <Chip tone="good">Down</Chip>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-5">
                <div>
                  <p className="t-metric text-ink-3 line-through decoration-accent decoration-2">14d</p>
                  <p className="t-micro mt-1 text-ink-3">Before</p>
                </div>
                <div>
                  <p className="t-metric text-brand-700"><Counter to={4} suffix="d" /></p>
                  <p className="t-micro mt-1 text-ink-3">After, illustrative</p>
                </div>
              </div>
              <div className="mt-6 border-t border-hairline pt-5">
                <BarRows suffix="h" scrub ariaLabel="Manual hours by stage"
                  rows={[
                    { label: 'Collecting inputs', value: 3 },
                    { label: 'Chasing managers', value: 2, tone: 'var(--c3)' },
                    { label: 'Compiling the pack', value: 1, tone: 'var(--c2)' },
                  ]} />
              </div>
            </div>
          }>
            <h3 className="t-h3 text-balance text-ink">
              Month end stops being a reconstruction
            </h3>
            <p className="t-body-xl mt-4 max-w-[46ch] text-ink-2">
              Attendance, leave and expenses land against the record as they happen,
              so the payroll run reads what is already there instead of gathering it.
            </p>
            <ul className="mt-6 grid gap-3">
              {['Punches arrive from device and browser',
                'Leave already netted against its cap',
                'Loss of pay applied in the same pass'].map(t => (
                <li key={t} className="flex items-start gap-3 text-[15px] text-ink">
                  <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" />
                  {t}
                </li>
              ))}
            </ul>
          </Block>

          <Block flip media={
            <StatutoryRegister />
          }>
            <h3 className="t-h3 text-balance text-ink">
              Filing stops depending on one person's spreadsheet
            </h3>
            <p className="t-body-xl mt-4 max-w-[46ch] text-ink-2">
              Provident fund at 12% to the Rs 15,000 ceiling, state insurance to
              Rs 21,000 gross, professional tax by state and a monthly TDS estimate,
              all totalled from the runs you actually processed.
            </p>
          </Block>

          <Block media={
            <div className="grid grid-cols-2 gap-4">
              <div className="panel grid place-items-center p-6">
                <Gauge value={100} label="Records scoped to a tenant" size={124} />
              </div>
              {/* 45 is a count, not a proportion, so it gets a figure rather
                  than a dial. */}
              <div className="panel grid place-items-center p-6 text-center">
                <p className="t-metric text-ink">45</p>
                <p className="t-small mt-2 text-ink-2">Permissions across 5 roles</p>
              </div>
              <div className="panel col-span-2 p-6">
                <p className="t-micro text-ink-3">Screens by module group</p>
                <div className="mt-3 flex items-end gap-1" aria-hidden>
                  {[9,14,22,31,26,17,11,6].map((h, i) => (
                    <span key={i} className="w-full rounded-t-[3px] bg-brand-300"
                          style={{ height: h * 2.2 }} />
                  ))}
                </div>
                <p className="t-small mt-3 text-ink-2">
                  Thirty two screens across people, payroll, attendance, letters and
                  organisation.
                </p>
              </div>
            </div>
          }>
            <h3 className="t-h3 text-balance text-ink">
              One deployment, many companies
            </h3>
            <p className="t-body-xl mt-4 max-w-[46ch] text-ink-2">
              Every query is scoped to its tenant, with five seeded roles over forty
              five permissions, so a group can run several companies off one install
              without their records ever meeting.
            </p>
          </Block>
        </div>
      </div>
    </section>
  );
}
