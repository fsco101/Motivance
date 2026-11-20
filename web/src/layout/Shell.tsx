import { CalendarBlankIcon, CalendarCheckIcon, CalendarDotsIcon, CalendarPlusIcon, CaretDoubleLeftIcon, CaretDoubleRightIcon, CaretDownIcon, CaretRightIcon, ChartLineUpIcon, ChatCircleDotsIcon, ClockCounterClockwiseIcon, GaugeIcon, HouseIcon, LinkSimpleIcon, ListChecksIcon, PersonSimpleTaiChiIcon, SignOutIcon, SwapIcon, TrayIcon, UserCircleIcon, UsersThreeIcon, type Icon } from '@phosphor-icons/react'
import { m as motion } from 'motion/react'
import { DropdownMenu, Tooltip as RadixTooltip } from 'radix-ui'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink, useLocation, useMatches } from 'react-router'
import type { Workspace } from '@/auth/roles'
import { Avatar, Tooltip } from '@/components/Display'
import { cn } from '@/lib/cn'
import { spring } from '@/motion/tokens'
import { setLanguage, type Language } from '@/locales/i18n'
import { ExerciseModeContext } from './exerciseMode'
import { LANGUAGES, LanguageSwitch } from './LanguageSwitch'

type NavItem = { path: string; label: string; icon: Icon; end?: boolean; /** For the bottom bar, where a long label would be cut off. */ short?: string; /** Left off the bottom bar, which holds five. The pages around it link to it. */ wide?: boolean }

const NAV: Record<Workspace, readonly NavItem[]> = {
  therapist: [
    { path: '', label: 'nav.home', icon: HouseIcon, end: true },
    { path: 'schedule', label: 'nav.schedule', icon: CalendarCheckIcon },
    { path: 'patients', label: 'nav.patients', icon: UsersThreeIcon },
    { path: 'exercises', label: 'nav.exercises', icon: PersonSimpleTaiChiIcon },
    { path: 'progress', label: 'nav.progress', icon: ChartLineUpIcon },
    { path: 'messages', label: 'nav.messages', icon: ChatCircleDotsIcon },
  ],
  patient: [
    { path: '', label: 'nav.home', icon: HouseIcon, end: true },
    { path: 'schedule', label: 'nav.schedule', short: 'nav.scheduleShort', icon: CalendarCheckIcon },
    { path: 'book', label: 'nav.book', icon: CalendarPlusIcon, wide: true },
    { path: 'bookings', label: 'nav.bookings', short: 'nav.bookingsShort', icon: CalendarBlankIcon },
    { path: 'exercises', label: 'nav.exercises', icon: PersonSimpleTaiChiIcon },
    { path: 'progress', label: 'nav.progress', icon: ChartLineUpIcon },
    // The bottom bar is full, so on a phone the way in is the icon beside the bell.
    { path: 'messages', label: 'nav.messages', icon: ChatCircleDotsIcon, wide: true },
  ],
  scheduler: [
    { path: '', label: 'nav.home', icon: HouseIcon, end: true },
    { path: 'requests', label: 'nav.requests', icon: TrayIcon },
    { path: 'schedule', label: 'nav.scheduleShort', icon: CalendarCheckIcon },
    { path: 'calendar', label: 'nav.calendar', icon: CalendarDotsIcon },
  ],
  admin: [
    { path: '', label: 'nav.overview', icon: GaugeIcon, end: true },
    { path: 'accounts', label: 'nav.accounts', icon: UsersThreeIcon },
    { path: 'links', label: 'nav.links', icon: LinkSimpleIcon },
    { path: 'catalogue', label: 'nav.catalogue', icon: ListChecksIcon },
    { path: 'activity', label: 'nav.activity', icon: ClockCounterClockwiseIcon },
  ],
}

const SIDEBAR_KEY = 'motivance.sidebar'
const readCollapsed = () => { try { return window.localStorage.getItem(SIDEBAR_KEY) === 'collapsed' } catch { return false } }
/** True while the window matches `query`, following resizes. */
function useMedia(query: string) {
  const subscribe = useCallback((changed: () => void) => {
    const list = window.matchMedia(query)
    list.addEventListener('change', changed)
    return () => list.removeEventListener('change', changed)
  }, [query])
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => true)
}
/** True on a window wide enough for the sidebar's labels. Narrower windows fold it to icons by themselves. */
const useWideWindow = () => useMedia('(min-width: 64rem)')
/** True from tablet width up; below it, the header has room only for the page's title. */
const useTabletWindow = () => useMedia('(min-width: 48rem)')

/**
 * The sidebar keeps the goniometer's graduated edge, and a needle marks where you are. The person can fold it to icons with
 * the button at its foot, and it stays folded in this browser; a narrow window folds it by itself. Folded, each icon names
 * itself in a tooltip, and the labels stay for screen readers.
 */
function Sidebar({ workspace, base }: { workspace: Workspace; base: string }) {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const wideWindow = useWideWindow()
  const open = wideWindow && !collapsed
  const toggle = () => {
    const next = !collapsed
    setCollapsed(next)
    try { window.localStorage.setItem(SIDEBAR_KEY, next ? 'collapsed' : 'open') } catch { /* The choice then lasts for this page only. */ }
  }
  // The tooltip sits on a wrapper, because a link's class is a function of whether it is the current page, which the tooltip
  // cannot merge into. Focus reaches the wrapper from the link inside, so keyboard users get the name too.
  const named = (label: string, element: ReactElement) => (open ? element : <Tooltip label={label} side="right"><span className="block">{element}</span></Tooltip>)
  return (
    <div className={cn('bg-ink', workspace === 'patient' && 'hidden tablet:block')}>
      <nav aria-label={t('nav.main')} className={cn('on-dark graduated sticky top-0 flex h-dvh flex-col overflow-hidden text-night-ink transition-[width] duration-200 motion-reduce:transition-none', open ? 'w-60' : 'w-16')}>
        <Link to={base} aria-label={`Motivance, ${t('nav.home')}`} className={cn('flex h-14 shrink-0 items-center gap-2.5', open ? 'px-5' : 'px-3.5')}>
          <img src="/logo-96.png" alt="" width={30} height={30} className="rounded-md" />
          {open && <span className="whitespace-nowrap font-display text-lg font-bold text-paper">Motivance</span>}
        </Link>
        {open && <p className="px-5 pb-2 pt-4 text-xs font-semibold">{t(`nav.workspace.${workspace}`)}</p>}
        <ul className={cn('flex flex-col gap-0.5', open ? 'pl-3 pr-5' : 'mt-3 pl-2 pr-4')}>
          {NAV[workspace].map((item) => (
            <li key={item.label}>
              {named(t(item.label), (
                <NavLink to={item.path ? `${base}/${item.path}` : base} end={item.end}
                  className={({ isActive }) => cn('relative flex h-10 items-center gap-3 rounded-control text-sm font-semibold transition-colors transition-quick', open ? 'justify-start px-3' : 'justify-center', isActive ? 'bg-night-panel text-paper' : 'hover:bg-night-panel/60 hover:text-paper')}>
                  {({ isActive }) => (
                    <>
                      <item.icon weight={isActive ? 'fill' : 'regular'} aria-hidden className="shrink-0 text-xl" />
                      <span className={open ? undefined : 'sr-only'}>{t(item.label)}</span>
                      {/* Folding swaps the needle rather than sliding it, because the sidebar is changing width while it would measure. */}
                      {isActive && (
                        <motion.span layoutId={open ? 'rail-needle' : 'rail-needle-folded'} transition={spring.needle} aria-hidden className={cn('absolute top-[calc(50%-1px)] flex h-0.5 items-center bg-sprout-bright', open ? '-right-5 w-5' : '-right-4 w-4')}>
                          <span className="-ml-1 size-2 rounded-full bg-sprout-bright" />
                        </motion.span>
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </li>
          ))}
        </ul>
        {wideWindow && (
          <div className={cn('mt-auto pb-4', open ? 'pl-3 pr-5' : 'pl-2 pr-4')}>
            {named(t('nav.expand'), (
              <button type="button" onClick={toggle} aria-expanded={open} aria-label={t(open ? 'nav.collapse' : 'nav.expand')}
                className={cn('flex h-10 w-full items-center gap-3 rounded-control text-sm font-semibold transition-colors transition-quick hover:bg-night-panel/60 hover:text-paper', open ? 'justify-start px-3' : 'justify-center')}>
                {open ? <CaretDoubleLeftIcon aria-hidden className="shrink-0 text-xl" /> : <CaretDoubleRightIcon aria-hidden className="shrink-0 text-xl" />}
                {open && <span>{t('nav.collapse')}</span>}
              </button>
            ))}
          </div>
        )}
      </nav>
    </div>
  )
}

/** Patients are often on a phone, so below tablet width their pages move to the bottom edge, in reach of a thumb. */
function BottomBar({ workspace, base }: { workspace: Workspace; base: string }) {
  const { t } = useTranslation()
  return (
    <nav aria-label={t('nav.main')} className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-paper pb-[env(safe-area-inset-bottom)] tablet:hidden">
      {NAV[workspace].filter((item) => !item.wide).map((item) => (
        <NavLink key={item.label} to={item.path ? `${base}/${item.path}` : base} end={item.end}
          className={({ isActive }) => cn('flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-semibold', isActive ? 'text-lagoon-deep' : 'text-slate')}>
          {({ isActive }) => <><item.icon weight={isActive ? 'fill' : 'regular'} aria-hidden className="text-xl" /><span className="max-w-full truncate px-1">{t(item.short ?? item.label)}</span></>}
        </NavLink>
      ))}
    </nav>
  )
}

/** A quiet line under every workspace page. The patient's bottom bar covers the last strip of the window, so the footer clears it. */
function Footer({ clearBottomBar }: { clearBottomBar: boolean }) {
  const { t } = useTranslation()
  return (
    <footer aria-label={t('nav.footer')} className={cn('border-t border-line px-5 py-4 text-xs text-slate desk:px-7', clearBottomBar && 'max-tablet:pb-24')}>
      <div className={cn(CONTENT_WIDTH, 'flex flex-col gap-1 tablet:flex-row tablet:items-center tablet:justify-between tablet:gap-4')}>
        <p>© {new Date().getFullYear()} Motivance</p>
        <p>{t('nav.footerNote')}</p>
      </div>
    </footer>
  )
}

/** The widest a workspace page gets, centred in the space beside the sidebar. */
const CONTENT_WIDTH = 'mx-auto w-full max-w-[100rem]'

export type Crumb = { crumb?: string | ((params: Record<string, string | undefined>) => string) }

function Breadcrumbs() {
  const { t } = useTranslation()
  const trail = useMatches().flatMap((match) => {
    const crumb = (match.handle as Crumb | undefined)?.crumb
    if (!crumb) return []
    return [{ id: match.id, path: match.pathname, label: typeof crumb === 'string' ? t(crumb) : crumb(match.params) }]
  })
  const page = trail[trail.length - 1]
  return (
    <nav aria-label={t('nav.breadcrumbs')} className="min-w-0">
      {/* A phone has room for the page's title, not the trail to it (#148). */}
      {page && <p aria-current="page" className="truncate font-display text-lg font-bold text-ink tablet:hidden">{page.label}</p>}
      <ol className="hidden items-center gap-1.5 text-sm text-slate tablet:flex">
        {trail.map((step, index) => {
          const last = index === trail.length - 1
          return (
            <li key={step.id} className="flex min-w-0 items-center gap-1.5">
              {index > 0 && <CaretRightIcon aria-hidden className="shrink-0" />}
              {last ? <span aria-current="page" className="truncate font-semibold text-ink">{step.label}</span> : <Link to={step.path} className="truncate hover:text-lagoon-deep">{step.label}</Link>}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export type ShellAccount = { name: string; email: string; photo?: string | null; workspaces: readonly Workspace[] }

function AccountMenu({ account, current, profilePath, onSwitch, onSignOut }: { account: ShellAccount; current: Workspace; profilePath: string; onSwitch: (workspace: Workspace) => void; onSignOut: () => void }) {
  const { t } = useTranslation()
  const item = 'flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm outline-none data-highlighted:bg-tide'
  // On a phone the header has no room for the language switch, so it moves in here.
  const phone = !useTabletWindow()
  const { i18n } = useTranslation()
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger aria-label={`${t('account.menu')}: ${account.name}`} className="flex items-center gap-2 rounded-control p-1 text-sm font-semibold transition-colors transition-quick hover:bg-mist">
        <Avatar name={account.name} photo={account.photo} size={30} />
        <span className="hidden max-w-40 truncate desk:block">{account.name}</span>
        <CaretDownIcon aria-hidden className="hidden text-slate desk:block" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={8} className="z-50 w-64 rounded-control border border-line bg-paper p-1 shadow-float">
          <div className="px-2.5 py-2">
            <p className="truncate font-semibold">{account.name}</p>
            <p className="truncate text-sm text-slate">{account.email}</p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item asChild className={item}><Link to={profilePath}><UserCircleIcon aria-hidden className="text-lg" />{t('account.profile')}</Link></DropdownMenu.Item>
          {account.workspaces.filter((workspace) => workspace !== current).map((workspace) => (
            <DropdownMenu.Item key={workspace} className={item} onSelect={() => onSwitch(workspace)}><SwapIcon aria-hidden className="text-lg" />{t(`account.open.${workspace}`)}</DropdownMenu.Item>
          ))}
          {phone && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-line" />
              <DropdownMenu.Label className="px-2.5 pb-1 pt-1.5 text-xs font-semibold text-slate">{t('common.language')}</DropdownMenu.Label>
              <DropdownMenu.RadioGroup value={i18n.language === 'fil' ? 'fil' : 'en'} onValueChange={(value) => setLanguage(value as Language)}>
                {LANGUAGES.map((language) => (
                  <DropdownMenu.RadioItem key={language.value} value={language.value} lang={language.value} className={item} onSelect={(event) => event.preventDefault()}>
                    <span aria-hidden className="grid size-4 place-items-center rounded-full border border-line-strong">
                      <DropdownMenu.ItemIndicator className="size-2 rounded-full bg-lagoon" />
                    </span>
                    {language.label}
                  </DropdownMenu.RadioItem>
                ))}
              </DropdownMenu.RadioGroup>
              <DropdownMenu.Separator className="my-1 h-px bg-line" />
            </>
          )}
          <DropdownMenu.Item className={item} onSelect={onSignOut}><SignOutIcon aria-hidden className="text-lg" />{t('account.signOut')}</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

type Props = { workspace: Workspace; base: string; account: ShellAccount; onSwitch: (workspace: Workspace) => void; onSignOut: () => void; /** Beside the account menu, where a workspace has anything to announce. */ bell?: ReactNode; children: ReactNode }

/** The frame of both workspaces. It takes everything as props, so the design gallery runs the same frame on sample data. */
export function Shell({ workspace, base, account, onSwitch, onSignOut, bell, children }: Props) {
  const { t } = useTranslation()
  const [exercising, setExercising] = useState(false)
  // In exercise mode the frame is hidden, not unmounted, so the page in <main> keeps its place in the tree and its state.
  const frame = exercising ? 'hidden' : undefined
  // From tablet width the window stays still and the page scrolls beside the sidebar, so the sidebar is always full height.
  // A new page starts at its top, as a whole-window scroll would.
  const scroller = useRef<HTMLDivElement>(null)
  const { pathname } = useLocation()
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }) }, [pathname])
  return (
    <ExerciseModeContext.Provider value={setExercising}>
    <RadixTooltip.Provider>
      <a href="#main" className={cn('sr-only focus:not-sr-only focus:fixed focus:left-20 focus:top-3 focus:z-50 focus:rounded-control focus:bg-paper focus:px-3 focus:py-2 focus:shadow-float', frame)}>{t('nav.skip')}</a>
      <div className={cn('grid min-h-dvh tablet:h-dvh tablet:overflow-hidden', exercising ? 'grid-cols-1' : 'grid-cols-[auto_minmax(0,1fr)]')}>
        {/* Pinned as well, for a phone, where the whole window scrolls. */}
        <div className={cn('sticky top-0 h-dvh self-start', frame)}><Sidebar workspace={workspace} base={base} /></div>
        <div ref={scroller} data-scroll="page" className="scroll-area flex min-w-0 flex-col tablet:overflow-y-auto">
          <div className={cn('sticky top-0 z-30 border-b border-line bg-paper px-5 desk:px-7', frame)}>
            <div className={cn(CONTENT_WIDTH, 'flex h-14 items-center justify-between gap-4')}>
              <Breadcrumbs />
              <div className="flex shrink-0 items-center gap-3">
                <span className="hidden tablet:block"><LanguageSwitch /></span>
                {bell}
                <AccountMenu account={account} current={workspace} profilePath={`${base}/profile`} onSwitch={onSwitch} onSignOut={onSignOut} />
              </div>
            </div>
          </div>
          {/* Centred, so a wide screen has the same margin on both sides; the header and footer line up with it. */}
          <main id="main" tabIndex={-1} className={cn('w-full flex-1 outline-none', exercising ? 'bg-night' : 'px-5 pb-12 pt-5 desk:px-7')}>
            <div className={exercising ? undefined : CONTENT_WIDTH}>{children}</div>
          </main>
          <div className={frame}><Footer clearBottomBar={workspace === 'patient'} /></div>
        </div>
      </div>
      {workspace === 'patient' && <div className={frame}><BottomBar workspace={workspace} base={base} /></div>}
    </RadixTooltip.Provider>
    </ExerciseModeContext.Provider>
  )
}
