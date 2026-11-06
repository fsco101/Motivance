import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@/components/Button'
import { PAGE_SIZE } from '@/data/scheduler'

export function Pager({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
  const { t } = useTranslation()
  const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1)
  const first = total === 0 ? 0 : page * PAGE_SIZE + 1
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-sm text-slate">{t('scheduler.showing', { first, last: Math.min((page + 1) * PAGE_SIZE, total), total })}</span>
      <div className="flex items-center gap-1">
        <IconButton label={t('scheduler.previousPage')} disabled={page === 0} onClick={() => onPage(page - 1)}><CaretLeftIcon aria-hidden /></IconButton>
        <span className="text-sm">{t('scheduler.page', { page: page + 1, pages })}</span>
        <IconButton label={t('scheduler.nextPage')} disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}><CaretRightIcon aria-hidden /></IconButton>
      </div>
    </div>
  )
}
