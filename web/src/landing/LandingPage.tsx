import { CalendarCheckIcon, CheckCircleIcon, StethoscopeIcon, UserGearIcon, type Icon } from '@phosphor-icons/react'
import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { AppQrCode, appUrl } from '@/components/AppQrCode'
import { ButtonLink } from '@/components/Button'
import { Panel, StatusPill } from '@/components/Display'
import { activitySummary } from '@/data/history'
import { useFormat } from '@/features/shared'
import { ActivityPanel } from '@/features/therapist/ActivityPanel'
import { TrendChart } from '@/features/therapist/TrendChart'
import { LanguageSwitch } from '@/layout/LanguageSwitch'
import '@/locales/landing'
import { RangeDial } from '@/motion/RangeDial'
import { MovementDemo } from './MovementDemo'

/** Booking starts with an account, so this keeps the wish to book through sign-up and sign-in. */
const BOOK = '/sign-up?next=book'

function Step({ number, title, detail, children }: { number: number; title: string; detail: string; children: ReactNode }) {
  return (
    <li className="flex min-w-0 flex-col gap-4 border-line py-8 desk:border-l desk:px-8 desk:py-0 desk:first:border-l-0 desk:first:pl-0 desk:last:pr-0">
      <div className="grid h-44 items-center">{children}</div>
      <div>
        <p className="numeric text-3xl font-bold text-lagoon-deep">{number}</p>
        <h3 className="mt-1 text-2xl font-bold">{title}</h3>
        <p className="mt-2 max-w-[40ch] text-slate">{detail}</p>
      </div>
    </li>
  )
}

function Audience({ icon: Mark, who, children }: { icon: Icon; who: string; children: ReactNode }) {
  return (
    <div className="border-t-2 border-ink py-6">
      <Mark aria-hidden weight="duotone" className="text-4xl text-lagoon-deep" />
      <h3 className="mt-3 text-2xl font-bold">{who}</h3>
      <p className="mt-2 max-w-[44ch] text-lg text-slate">{children}</p>
    </div>
  )
}

/** Sample practice days and reach, counted back from today so the strip always ends on "Today". */
const SAMPLE_DAYS = [26, 23, 21, 19, 16, 14, 12, 9, 7, 5, 2, 1, 0]
const SAMPLE_CHART_DAYS = [26, 23, 19, 16, 12, 9, 5, 2]
const SAMPLE_REACH = [64, 71, 79, 76, 92, 98, 105, 112]

/** The same two pieces a patient finds on their Progress page, on sample numbers and labelled as such. */
function ProgressSection() {
  const { t } = useTranslation()
  const format = useFormat()
  const { summary, points } = useMemo(() => {
    const at = (daysAgo: number) => { const day = new Date(); day.setHours(9, 0, 0, 0); day.setDate(day.getDate() - daysAgo); return day.toISOString() }
    const entries = SAMPLE_DAYS.map((daysAgo) => ({ startedAt: at(daysAgo), status: 'completed' }))
    return { summary: activitySummary(entries), points: SAMPLE_CHART_DAYS.map((daysAgo, index) => ({ id: String(daysAgo), label: format.short(at(daysAgo)), value: SAMPLE_REACH[index]! })) }
  }, [format])
  return (
    <section id="progress" className="mx-auto grid max-w-[90rem] scroll-mt-6 items-start gap-10 px-5 py-16 tablet:px-10 desk:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] desk:gap-16 desk:py-24">
      <div>
        <h2 className="text-4xl font-bold">{t('landing.progressTitle')}</h2>
        <p className="mt-4 max-w-[52ch] text-lg">{t('landing.progressDetail')}</p>
        <ul className="mt-6 grid max-w-[52ch] gap-3 text-lg text-slate">
          {(['progressPoint1', 'progressPoint2', 'progressPoint3'] as const).map((key) => (
            <li key={key} className="flex gap-3"><CheckCircleIcon aria-hidden weight="fill" className="mt-1 shrink-0 text-xl text-lagoon" /><span>{t(`landing.${key}`)}</span></li>
          ))}
        </ul>
      </div>
      <div className="grid min-w-0 gap-5">
        <ActivityPanel self sample stacked summary={summary} />
        <Panel title={t('progress.rom')} description={t('landing.progressChart')}>
          <TrendChart plain title={t('assign.range')} unit="°" points={points} />
        </Panel>
      </div>
    </section>
  )
}

/** The real product's pieces at rest, so each step shows what a patient will see rather than an icon standing in for it. */
function SignupSample() {
  const { t } = useTranslation()
  return (
    <div aria-hidden className="w-full max-w-72">
      <p className="mb-2 font-semibold text-lagoon-deep">{t('signup.stepOf', { step: 2, total: 4 })}</p>
      <div className="flex gap-1.5">{[0, 1, 2, 3].map((index) => <span key={index} className={`h-1.5 flex-1 rounded-full ${index < 2 ? 'bg-lagoon' : 'bg-tide'}`} />)}</div>
      <p className="mt-4 font-display text-2xl font-bold">{t('signup.personal')}</p>
    </div>
  )
}

function SlotSample() {
  const { t } = useTranslation()
  const row = 'flex min-h-11 items-center justify-between gap-3 rounded-control border px-3 py-2 text-sm'
  return (
    <div aria-hidden className="grid w-full max-w-72 gap-2">
      <div className={`${row} border-line-strong bg-paper`}><span className="font-semibold">{t('landing.sampleMorning')}</span><span className="text-xs text-slate">{t('landing.samplePlaces')}</span></div>
      <div className={`${row} border-lagoon bg-lagoon text-paper`}><span className="font-semibold">{t('landing.sampleNoon')}</span><span className="text-xs">{t('landing.samplePlace')}</span></div>
      <div className={`${row} border-line bg-mist text-slate`}><span className="font-semibold">{t('landing.sampleAfternoon')}</span><span className="text-xs">{t('landing.sampleFull')}</span></div>
    </div>
  )
}

function ConfirmedSample() {
  const { t } = useTranslation()
  return (
    <div aria-hidden className="w-full max-w-72 border-l-4 border-sprout bg-paper p-4 shadow-rest">
      <div className="flex items-center justify-between gap-2"><span className="font-semibold">{t('landing.sampleWhen')}</span><StatusPill tone="positive">{t('landing.sampleConfirmed')}</StatusPill></div>
      <p className="mt-1 text-sm text-slate">{t('landing.sampleNoon')}</p>
    </div>
  )
}

function AppSection() {
  const { t } = useTranslation()
  const url = appUrl()
  return (
    <section id="app" className="scroll-mt-6 bg-tide">
      <div className="mx-auto grid max-w-[90rem] items-center gap-10 px-5 py-16 tablet:px-10 desk:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] desk:gap-16">
        <div>
          <h2 className="text-4xl font-bold">{t('landing.appTitle')}</h2>
          <p className="mt-4 max-w-[52ch] text-lg">{t('landing.appDetail')}</p>
          <p className="mt-4 max-w-[52ch] text-lg text-slate">{t('landing.appWeb')}</p>
          {url
            ? <a href={url} target="_blank" rel="noreferrer" className="mt-5 inline-block font-semibold text-lagoon-deep underline underline-offset-4">{t('landing.appGet')}</a>
            : <p className="mt-5 max-w-[52ch] font-semibold">{t('landing.appNoLink')}</p>}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-8">
          <div className="on-dark grid h-60 w-36 place-items-center gap-1 rounded-card border-4 border-ink bg-night px-2 py-5 text-paper">
            <RangeDial dark low={20} high={120} reached={[14, 112]} width={104} label={t('landing.appDial')} />
            <p className="numeric text-3xl font-bold">6</p>
            <p className="text-center text-xs text-night-ink">{t('landing.phoneCount')}</p>
          </div>
          {url && <AppQrCode url={url} label={t('landing.appQr')} />}
        </div>
      </div>
    </section>
  )
}

const SECTIONS = [['how', 'landing.how'], ['app', 'landing.navApp'], ['progress', 'nav.progress'], ['privacy', 'landing.navPrivacy']] as const

/** The public front door, for patients first. Every claim here is something the product does today, and nothing is a made-up number. */
export function LandingPage() {
  const { t } = useTranslation()
  return (
    <div className="bg-mist">
      <section className="on-dark bg-ink text-paper">
        <div className="mx-auto max-w-[90rem] px-5 tablet:px-10">
          <header className="flex items-center justify-between gap-3 py-5">
            <Link to="/" className="flex items-center gap-3 rounded-control">
              <img src="/logo-96.png" alt="" width={36} height={36} className="rounded-lg" />
              <span className="font-display text-2xl font-bold">Motivance</span>
            </Link>
            <nav aria-label={t('landing.sections')} className="hidden items-center gap-1 desk:flex">
              {SECTIONS.map(([id, key]) => <a key={id} href={`#${id}`} className="rounded-control px-3 py-2 font-semibold text-night-ink underline-offset-4 hover:text-paper hover:underline">{t(key)}</a>)}
            </nav>
            <div className="flex items-center gap-2 tablet:gap-3">
              <div className="hidden tablet:block"><LanguageSwitch /></div>
              <Link to="/sign-in" className="whitespace-nowrap rounded-control px-2 py-2 font-semibold text-paper underline-offset-4 hover:underline">{t('auth.signIn')}</Link>
              {/* A phone has no room for both. Its main button below leads to the same place. */}
              <div className="hidden tablet:block"><ButtonLink to="/sign-up" variant="bright">{t('landing.createAccount')}</ButtonLink></div>
            </div>
          </header>
          <div className="grid items-center gap-x-16 gap-y-10 pb-16 pt-8 desk:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] desk:pb-20 desk:pt-6">
            <div>
              <h1 className="text-5xl font-bold tablet:text-6xl">{t('landing.title')}</h1>
              <p className="mt-6 max-w-[46ch] text-xl text-night-ink">{t('landing.lead')}</p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <ButtonLink to={BOOK} variant="bright" size="lg">{t('landing.bookSession')}</ButtonLink>
                <a href="#how" className="rounded-control px-3 py-3 font-semibold text-paper underline-offset-4 hover:underline">{t('landing.how')}</a>
              </div>
              <ul className="mt-8 grid gap-2 border-t border-night-line pt-6 text-night-ink tablet:grid-cols-3 tablet:gap-6">
                {(['factPrivate', 'factLanguages', 'factBrowser'] as const).map((key) => (
                  <li key={key} className="flex items-start gap-2"><CheckCircleIcon aria-hidden weight="fill" className="mt-0.5 shrink-0 text-xl text-sprout-bright" /><span>{t(`landing.${key}`)}</span></li>
                ))}
              </ul>
            </div>
            <MovementDemo />
          </div>
        </div>
      </section>

      <main>
        <section id="how" className="mx-auto max-w-[90rem] scroll-mt-6 px-5 py-16 tablet:px-10 desk:py-24">
          <h2 className="mb-10 text-4xl font-bold">{t('landing.how')}</h2>
          <ol className="grid divide-y divide-line desk:grid-cols-3 desk:divide-y-0">
            <Step number={1} title={t('landing.step1')} detail={t('landing.step1Detail')}><SignupSample /></Step>
            <Step number={2} title={t('landing.step2')} detail={t('landing.step2Detail')}><SlotSample /></Step>
            <Step number={3} title={t('landing.step3')} detail={t('landing.step3Detail')}><ConfirmedSample /></Step>
          </ol>
          <div className="mt-10"><ButtonLink to={BOOK} size="lg">{t('landing.bookSession')}</ButtonLink></div>
        </section>

        <AppSection />

        <ProgressSection />

        <section className="border-t border-line bg-paper">
          <div className="mx-auto max-w-[90rem] px-5 py-16 tablet:px-10 desk:py-24">
            <h2 className="text-4xl font-bold">{t('landing.forWhom')}</h2>
            <p className="mb-8 mt-3 max-w-[58ch] text-lg text-slate">
              {t('signup.staffNote')} <Link to="/sign-in" className="font-semibold text-lagoon-deep underline underline-offset-4">{t('landing.staffSignIn')}</Link>
            </p>
            <div className="grid gap-x-10 desk:grid-cols-3">
              <Audience icon={StethoscopeIcon} who={t('landing.therapists')}>{t('landing.therapistsDetail')}</Audience>
              <Audience icon={CalendarCheckIcon} who={t('landing.schedulers')}>{t('landing.schedulersDetail')}</Audience>
              <Audience icon={UserGearIcon} who={t('landing.administrators')}>{t('landing.administratorsDetail')}</Audience>
            </div>
          </div>
        </section>
      </main>

      <section id="privacy" className="scroll-mt-6 bg-tide">
        <div className="mx-auto grid max-w-[90rem] gap-8 px-5 py-16 tablet:px-10 desk:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] desk:gap-16">
          <h2 className="text-4xl font-bold">{t('landing.privacyTitle')}</h2>
          <div className="max-w-[52ch] text-lg">
            <p>{t('landing.privacyDetail')}</p>
            <p className="mt-4 text-slate">{t('landing.notValidated')}</p>
          </div>
        </div>
      </section>

      <section className="on-dark bg-ink text-paper">
        <div className="mx-auto flex max-w-[90rem] flex-wrap items-center justify-between gap-x-12 gap-y-6 px-5 py-16 tablet:px-10">
          <div>
            <h2 className="text-4xl font-bold">{t('landing.closingTitle')}</h2>
            <p className="mt-3 max-w-[46ch] text-lg text-night-ink">{t('landing.closingDetail')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ButtonLink to={BOOK} variant="bright" size="lg">{t('landing.bookSession')}</ButtonLink>
            <Link to="/sign-in" className="rounded-control px-3 py-3 font-semibold text-paper underline-offset-4 hover:underline">{t('auth.signIn')}</Link>
          </div>
        </div>
      </section>

      <footer className="on-dark border-t border-night-line bg-night text-paper">
        <div className="mx-auto grid max-w-[90rem] gap-6 px-5 py-8 tablet:px-10 desk:grid-cols-[minmax(0,1fr)_auto] desk:items-center">
          <div>
            <span className="font-display text-xl font-bold">Motivance</span>
            <p className="mt-1 max-w-[58ch] text-sm text-night-ink">{t('landing.notValidated')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <LanguageSwitch />
            {SECTIONS.map(([id, key]) => <a key={id} href={`#${id}`} className="font-semibold underline-offset-4 hover:underline">{t(key)}</a>)}
            <Link to="/sign-in" className="font-semibold underline-offset-4 hover:underline">{t('auth.signIn')}</Link>
            <Link to="/sign-up" className="font-semibold underline-offset-4 hover:underline">{t('landing.createAccount')}</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
