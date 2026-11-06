import { CalendarBlankIcon, CalendarCheckIcon, CalendarDotsIcon, CalendarPlusIcon, CaretDownIcon, CaretRightIcon, ChartLineUpIcon, ClockCounterClockwiseIcon, GaugeIcon, HouseIcon, LinkSimpleIcon, ListChecksIcon, PersonSimpleTaiChiIcon, SignOutIcon, SwapIcon, TrayIcon, UserCircleIcon, UsersThreeIcon, type Icon } from '@phosphor-icons/react'
import { m as motion } from 'motion/react'
import { DropdownMenu, Tooltip as RadixTooltip } from 'radix-ui'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink, useMatches } from 'react-router'
import type { Workspace } from '@/auth/roles'
import { Avatar } from '@/components/Display'
import { cn } from '@/lib/cn'
import { spring } from '@/motion/tokens'
import { LanguageSwitch } from './LanguageSwitch'

type NavItem = { path: string; label: string; icon: Icon; end?: boolean; /** For the bottom bar, where a long label would be cut off. */ short?: string; /** Left off the bottom bar, which holds five. The pages around it link to it. */ wide?: boolean }

const NAV: Record<Workspace, readonly NavItem[]> = {
  therapist: [
    { path: '', label: 'nav.home', icon: HouseIcon, end: true },
    { path: 'schedule', label: 'nav.schedule', icon: CalendarCheckIcon },
    { path: 'patients', label: 'nav.patients', icon: UsersThreeIcon },
    { path: 'exercises', label: 'nav.exercises', icon: PersonSimpleTaiChiIcon },
    { path: 'progress', label: 'nav.progress', icon: ChartLineUpIcon },
  ],
  patient: [
    { path: '', label: 'nav.home', icon: HouseIcon, end: true },
    { path: 'schedule', label: 'nav.schedule', short: 'nav.scheduleShort', icon: CalendarCheckIcon },
    { path: 'book', label: 'nav.book', icon: CalendarPlusIcon, wide: true },
    { path: 'bookings', label: 'nav.bookings', short: 'nav.bookingsShort', icon: CalendarBlankIcon },
    { path: 'exercises', label: 'nav.exercises', icon: PersonSimpleTaiChiIcon },
    { path: 'progress', label: 'nav.progress', icon: ChartLineUpIcon },
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

/**
 * The sidebar keeps the goniometer's graduated edge, and a needle marks where you are. On a narrow window it folds to icons,
 * and the labels stay for screen readers.
 */
function Sidebar({ workspace, base }: { workspace: Workspace; base: string }) {
  const { t } = useTranslation()
  return (
    <div className={cn('bg-ink', workspace === 'patient' && 'hidden tablet:block')}>
      <nav aria-label={t('nav.main')} className="on-dark graduated sticky top-0 flex h-dvh w-16 flex-col text-night-ink desk:w-60">
        <Link to={base} aria-label={`Motivance, ${t('nav.home')}`} className="flex h-14 shrink-0 items-center gap-2.5 px-3.5 desk:px-5">
          <img src="/logo-96.png" alt="" width={30} height={30} className="rounded-md" />
          <span className="hidden font-display text-lg font-bold text-paper desk:block">Motivance</span>
        </Link>
        <p className="hidden px-5 pb-2 pt-4 text-xs font-semibold desk:block">{t(`nav.workspace.${workspace}`)}</p>
        <ul className="mt-3 flex flex-col gap-0.5 pl-2 pr-4 desk:mt-0 desk:pl-3 desk:pr-5">
          {NAV[workspace].map((item) => (
            <li key={item.label}>
              <NavLink to={item.path ? `${base}/${item.path}` : base} end={item.end}
                className={({ isActive }) => cn('relative flex h-10 items-center justify-center gap-3 rounded-control text-sm font-semibold transition-colors transition-quick desk:justify-start desk:px-3', isActive ? 'bg-night-panel text-paper' : 'hover:bg-night-panel/60 hover:text-paper')}>
                {({ isActive }) => (
                  <>
                    <item.icon weight={isActive ? 'fill' : 'regular'} aria-hidden className="shrink-0 text-xl" />
                    <span className="sr-only desk:not-sr-only">{t(item.label)}</span>
                    {isActive && (
                      <motion.span layoutId="rail-needle" transition={spring.needle} aria-hidden className="absolute -right-4 top-[calc(50%-1px)] flex h-0.5 w-4 items-center bg-sprout-bright desk:-right-5 desk:w-5">
                        <span className="-ml-1 size-2 rounded-full bg-sprout-bright" />
                      </motion.span>
                    )}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
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

export type Crumb = { crumb?: string | ((params: Record<string, string | undefined>) => string) }

function Breadcrumbs() {
  const { t } = useTranslation()
  const trail = useMatches().flatMap((match) => {
    const crumb = (match.handle as Crumb | undefined)?.crumb
    if (!crumb) return []
    return [{ id: match.id, path: match.pathname, label: typeof crumb === 'string' ? t(crumb) : crumb(match.params) }]
  })
  return (
    <nav aria-label={t('nav.breadcrumbs')} className="min-w-0">
      <ol className="flex items-center gap-1.5 text-sm text-slate">
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
  return (
    <RadixTooltip.Provider>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-20 focus:top-3 focus:z-50 focus:rounded-control focus:bg-paper focus:px-3 focus:py-2 focus:shadow-float">{t('nav.skip')}</a>
      <div className="grid min-h-dvh grid-cols-[auto_minmax(0,1fr)]">
        <Sidebar workspace={workspace} base={base} />
        <div className="flex min-w-0 flex-col">
          <div className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-line bg-paper px-5 desk:px-7">
            <Breadcrumbs />
            <div className="flex shrink-0 items-center gap-3">
              <LanguageSwitch />
              {bell}
              <AccountMenu account={account} current={workspace} profilePath={`${base}/profile`} onSwitch={onSwitch} onSignOut={onSignOut} />
            </div>
          </div>
          <main id="main" tabIndex={-1} className={cn('w-full max-w-[100rem] flex-1 px-5 pb-12 pt-5 outline-none desk:px-7', workspace === 'patient' && 'max-tablet:pb-24')}>{children}</main>
        </div>
      </div>
      {workspace === 'patient' && <BottomBar workspace={workspace} base={base} />}
    </RadixTooltip.Provider>
  )
}
