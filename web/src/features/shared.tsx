import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Notice, Skeleton } from '@/components/Display'

export type Load<T> = { status: 'loading' } | { status: 'error'; retry: () => void } | { status: 'ready'; data: T }

export const ready = <T,>(data: T): Load<T> => ({ status: 'ready', data })

/** Every screen has the same three moments: it is loading, it failed and says how to recover, or it shows data. */
export function Loadable<T>({ load, skeleton, children }: { load: Load<T>; skeleton: ReactNode; children: (data: T) => ReactNode }) {
  const { t } = useTranslation()
  if (load.status === 'loading') return <div role="status" aria-label={t('common.loading')}>{skeleton}</div>
  if (load.status === 'error') return <Notice title={t('common.loadFailedTitle')} onRetry={load.retry}>{t('common.loadFailed')}</Notice>
  return <>{children(load.data)}</>
}

export function SkeletonLines({ rows = 6 }: { rows?: number }) {
  return <div className="flex flex-col gap-4">{Array.from({ length: rows }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}</div>
}

export function SkeletonCards({ count = 6 }: { count?: number }) {
  return <div className="grid gap-4 tablet:grid-cols-2 wide:grid-cols-3">{Array.from({ length: count }, (_, index) => <Skeleton key={index} className="h-40 rounded-card" />)}</div>
}

export function useFormat() {
  const { i18n } = useTranslation()
  const locale = i18n.language === 'fil' ? 'fil-PH' : 'en-PH'
  return useMemo(() => {
    const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })
    const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })
    const short = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' })
    return { date: (iso: string) => date.format(new Date(iso)), dateTime: (iso: string) => dateTime.format(new Date(iso)), short: (iso: string) => short.format(new Date(iso)) }
  }, [locale])
}

/** Label and value pairs read as plain facts: no box, just a quiet term above its answer. */
export function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-slate">{term}</dt>
      <dd className="font-semibold">{children}</dd>
    </div>
  )
}
