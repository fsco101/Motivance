import { CaretDownIcon, CaretUpIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { Button } from './Button'
import { Skeleton } from './Display'

export type Column<Row> = {
  key: string
  header: string
  cell: (row: Row) => ReactNode
  align?: 'start' | 'end'
  sortable?: boolean
  /** Hidden below this width so a narrow window never scrolls sideways. */
  hideBelow?: 'desk' | 'wide'
}
export type Sort = { key: string; direction: 'asc' | 'desc' }

type Props<Row> = {
  caption: string
  columns: ReadonlyArray<Column<Row>>
  rows: ReadonlyArray<Row>
  rowKey: (row: Row) => string
  loading?: boolean
  sort?: Sort
  onSort?: (sort: Sort) => void
  onRowClick?: (row: Row) => void
  selectedKey?: string | null
  empty?: ReactNode
}

const hidden = { desk: 'hidden desk:table-cell', wide: 'hidden wide:table-cell' }

/**
 * Rows sit on the page rather than in a card: hairlines separate them, and the row under the pointer shows it can open.
 * A row click is only a larger target, so a clickable table still needs a real button or link in a cell for keyboards.
 */
export function DataTable<Row>({ caption, columns, rows, rowKey, loading, sort, onSort, onRowClick, selectedKey, empty }: Props<Row>) {
  const { t } = useTranslation()
  if (!loading && rows.length === 0 && empty) return <>{empty}</>
  return (
    <table className="w-full border-collapse text-left">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-line-strong">
          {columns.map((column) => {
            const sorted = sort?.key === column.key ? sort.direction : null
            return (
              <th key={column.key} scope="col" aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                className={cn('px-3 pb-2 text-sm font-semibold text-slate first:pl-0 last:pr-0', column.align === 'end' && 'text-right', column.hideBelow && hidden[column.hideBelow])}>
                {column.sortable && onSort ? (
                  <button type="button" onClick={() => onSort({ key: column.key, direction: sorted === 'asc' ? 'desc' : 'asc' })} className="inline-flex min-h-8 items-center gap-1 hover:text-ink">
                    {column.header}
                    {sorted === 'asc' && <CaretUpIcon weight="bold" aria-hidden />}
                    {sorted === 'desc' && <CaretDownIcon weight="bold" aria-hidden />}
                  </button>
                ) : column.header}
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody aria-busy={loading || undefined}>
        {loading
          ? Array.from({ length: 6 }, (_, index) => (
              <tr key={index} className="border-b border-line">
                {columns.map((column) => <td key={column.key} className={cn('px-3 py-4 first:pl-0 last:pr-0', column.hideBelow && hidden[column.hideBelow])}><Skeleton className="h-4 w-3/4" /></td>)}
              </tr>
            ))
          : rows.map((row) => {
              const key = rowKey(row)
              return (
                <tr key={key} onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn('border-b border-line transition-colors transition-quick', onRowClick && 'cursor-pointer hover:bg-tide/60', selectedKey === key && 'bg-tide')}>
                  {columns.map((column) => (
                    <td key={column.key} className={cn('px-3 py-3 first:pl-0 last:pr-0', column.align === 'end' && 'text-right', column.hideBelow && hidden[column.hideBelow])}>{column.cell(row)}</td>
                  ))}
                </tr>
              )
            })}
      </tbody>
      {!loading && rows.length === 0 && <tfoot><tr><td colSpan={columns.length} className="py-6 text-slate">{t('common.nothingHere')}</td></tr></tfoot>}
    </table>
  )
}

/** Lists page by key, not by number, so the only way forward is the next page. */
export function LoadMore({ shown, onLoad, busy, label }: { shown: string; onLoad?: () => void; busy?: boolean; label: string }) {
  const { t } = useTranslation()
  return (
    <div className="mt-4 flex items-center justify-between gap-4">
      <p className="text-sm text-slate">{shown}</p>
      {onLoad && <Button variant="secondary" size="sm" onClick={onLoad} busy={busy} busyLabel={t('common.loading')}>{label}</Button>}
    </div>
  )
}
