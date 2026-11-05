import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { ButtonLink } from '@/components/Button'
import { TrendChart } from '@/features/therapist/TrendChart'
import { LanguageSwitch } from '@/layout/LanguageSwitch'
import { RangeArc } from '@/motion/RangeArc'
import { RangeDial } from '@/motion/RangeDial'
import { MovementDemo } from './MovementDemo'

const TREND = [62, 68, 71, 79, 84, 91, 98].map((value, index) => ({ id: String(index), label: `${index + 1}`, value }))

function Step({ number, title, detail, children }: { number: number; title: string; detail: string; children: ReactNode }) {
  return (
    <li className="flex min-w-0 flex-col gap-4 border-line py-8 desk:border-l desk:px-8 desk:py-0 desk:first:border-l-0 desk:first:pl-0 desk:last:pr-0">
      <div className="grid h-52 place-items-center">{children}</div>
      <div>
        <p className="numeric text-3xl font-bold text-lagoon-deep">{number}</p>
        <h3 className="mt-1 text-2xl font-bold">{title}</h3>
        <p className="mt-2 max-w-[40ch] text-slate">{detail}</p>
      </div>
    </li>
  )
}

function Audience({ who, children }: { who: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 border-t border-line py-6 tablet:grid-cols-[14rem_minmax(0,1fr)] tablet:gap-8">
      <h3 className="text-2xl font-bold">{who}</h3>
      <p className="max-w-[58ch] text-lg text-slate">{children}</p>
    </div>
  )
}

/** The public front door. Every claim here is something the product does today, and nothing is a made-up number. */
export function LandingPage() {
  const { t } = useTranslation()
  const [range, setRange] = useState<[number, number]>([20, 120])
  return (
    <div className="bg-mist">
      <section className="on-dark bg-ink text-paper">
        <div className="mx-auto max-w-[90rem] px-5 tablet:px-10">
          <header className="flex items-center justify-between gap-4 py-5">
            <Link to="/" className="flex items-center gap-3 rounded-control">
              <img src="/logo-96.png" alt="" width={36} height={36} className="rounded-lg" />
              <span className="font-display text-2xl font-bold">Motivance</span>
            </Link>
            <div className="flex items-center gap-3">
              <div className="hidden tablet:block"><LanguageSwitch /></div>
              <ButtonLink to="/sign-in" variant="bright">{t('auth.signIn')}</ButtonLink>
            </div>
          </header>
          <div className="grid items-center gap-x-16 gap-y-10 pb-16 pt-8 desk:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] desk:pb-20 desk:pt-6">
            <div>
              <h1 className="text-5xl font-bold tablet:text-6xl">{t('landing.title')}</h1>
              <p className="mt-6 max-w-[46ch] text-xl text-night-ink">{t('landing.lead')}</p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <ButtonLink to="/sign-in" variant="bright" size="lg">{t('landing.signInStaff')}</ButtonLink>
                <a href="#how" className="rounded-control px-3 py-3 font-semibold text-paper underline-offset-4 hover:underline">{t('landing.how')}</a>
              </div>
            </div>
            <MovementDemo />
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-[90rem] px-5 tablet:px-10">
        <section id="how" className="scroll-mt-6 py-16 desk:py-24">
          <h2 className="mb-10 text-4xl font-bold">{t('landing.how')}</h2>
          <ol className="grid divide-y divide-line desk:grid-cols-3 desk:divide-y-0">
            <Step number={1} title={t('landing.step1')} detail={t('landing.step1Detail')}>
              <div className="w-full max-w-72"><RangeArc low={range[0]} high={range[1]} description={t('landing.step1')} lowLabel={t('assign.low')} highLabel={t('assign.high')} onChange={(low, high) => setRange([low, high])} /></div>
            </Step>
            <Step number={2} title={t('landing.step2')} detail={t('landing.step2Detail')}>
              <div className="on-dark grid h-52 w-32 place-items-center gap-1 rounded-card border-4 border-ink bg-night px-2 py-5 text-paper">
                <RangeDial dark low={20} high={120} reached={[14, 112]} width={92} label={t('patients.dial', { low: 14, high: 112, targetLow: 20, targetHigh: 120 })} />
                <p className="numeric text-3xl font-bold">6</p>
                <p className="text-center text-xs text-night-ink">{t('landing.phoneCount')}</p>
              </div>
            </Step>
            <Step number={3} title={t('landing.step3')} detail={t('landing.step3Detail')}>
              <div className="w-full"><TrendChart title={t('progress.rom')} points={TREND} unit="°" max={120} plain /></div>
            </Step>
          </ol>
        </section>

        <section className="pb-16 desk:pb-24">
          <h2 className="mb-6 text-4xl font-bold">{t('landing.forWhom')}</h2>
          <Audience who={t('landing.therapists')}>{t('landing.therapistsDetail')}</Audience>
          <Audience who={t('landing.administrators')}>{t('landing.administratorsDetail')}</Audience>
          <Audience who={t('landing.patients')}>{t('landing.patientsDetail')}</Audience>
        </section>
      </main>

      <section className="bg-tide">
        <div className="mx-auto grid max-w-[90rem] gap-8 px-5 py-16 tablet:px-10 desk:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] desk:gap-16">
          <h2 className="text-4xl font-bold">{t('landing.privacyTitle')}</h2>
          <div className="max-w-[52ch] text-lg">
            <p>{t('landing.privacyDetail')}</p>
            <p className="mt-4 text-slate">{t('landing.notValidated')}</p>
          </div>
        </div>
      </section>

      <footer className="on-dark bg-ink text-paper">
        <div className="mx-auto flex max-w-[90rem] flex-wrap items-center justify-between gap-4 px-5 py-8 tablet:px-10">
          <span className="font-display text-xl font-bold">Motivance</span>
          <div className="flex items-center gap-4">
            <LanguageSwitch />
            <Link to="/sign-in" className="font-semibold underline-offset-4 hover:underline">{t('auth.signIn')}</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
