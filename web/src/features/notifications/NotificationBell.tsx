import { BellIcon } from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { supabase } from '@/data/client'
import { loadInbox } from '@/data/notifications'

/** How often an open page looks for news. Nothing here is urgent enough to hold a connection open. */
const CHECK_EVERY = 60_000

export function BellLink({ to, count }: { to: string; count: number }) {
  const { t } = useTranslation()
  return (
    <Link to={to} aria-label={count > 0 ? t('nav.notificationsUnread', { count }) : t('nav.notifications')}
      className="relative grid size-11 shrink-0 place-items-center rounded-control text-slate transition-colors transition-quick hover:bg-mist hover:text-ink">
      <BellIcon aria-hidden className="text-xl" />
      {count > 0 && <span aria-hidden className="absolute right-1 top-1 min-w-4 rounded-full bg-lagoon-deep px-1 text-center text-[0.625rem] font-bold leading-4 text-paper">{count > 9 ? '9+' : count}</span>}
    </Link>
  )
}

export function NotificationBell({ base }: { base: string }) {
  const inbox = useQuery({ queryKey: ['notifications'], queryFn: () => loadInbox(supabase()), refetchInterval: CHECK_EVERY })
  return <BellLink to={`${base}/notifications`} count={inbox.data?.unread ?? 0} />
}
