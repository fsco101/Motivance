import { CaretDownIcon, CaretUpDownIcon, CaretUpIcon } from '@phosphor-icons/react'
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
export type RowGroup = { key: string; label: string; header: ReactNode }

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
  /** Sections the table, for example links under each therapist. */
  group?: (row: Row) => RowGroup
}

const hidden = { desk: 'hidden desk:table-cell', wide: 'hidden wide:table-cell' }

/**
 * Sits inside a Panel. The header stays under the top bar while the page scrolls.
 * A row click is only a larger target, so a clickable table still needs a real button or link in a cell for keyboards.
 */
export function DataTable<Row>({ caption, columns, rows, rowKey, loading, sort, onSort, onRowClick, selectedKey, empty, group }: Props<Row>) {
  const { t } = useTranslation()
  if (!loading && rows.length === 0 && empty) return <>{empty}</>
  const sections = group
    ? [...Map.groupBy(rows, (row) => group(row).key).values()].map((items) => ({ info: group(items[0]!), items }))
    : [{ info: null, items: rows }]
  const line = (row: Row) => {
    const key = rowKey(row)
    return (
      <tr key={key} onClick={onRowClick ? () => onRowClick(row) : undefined}
        className={cn('border-b border-line transition-colors transition-quick last:border-b-0', onRowClick && 'cursor-pointer', selectedKey === key ? 'bg-tide' : onRowClick && 'hover:bg-mist')}>
        {columns.map((column) => (
          <td key={column.key} className={cn('px-4 py-2.5 align-middle', column.align === 'end' && 'text-right', column.hideBelow && hidden[column.hideBelow])}>{column.cell(row)}</td>
        ))}
      </tr>
    )
  }
  return (
    <table className="w-full border-collapse text-left text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead className="sticky top-14 z-10 bg-mist">
        <tr className="border-b border-line">
          {columns.map((column) => {
            const sorted = sort?.key === column.key ? sort.direction : null
            const Arrow = sorted === 'asc' ? CaretUpIcon : sorted === 'desc' ? CaretDownIcon : CaretUpDownIcon
            return (
              <th key={column.key} scope="col" aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                className={cn('h-9 whitespace-nowrap px-4 text-xs font-semibold text-slate', column.align === 'end' && 'text-right', column.hideBelow && hidden[column.hideBelow])}>
                {column.sortable && onSort ? (
                  <button type="button" onClick={() => onSort({ key: column.key, direction: sorted === 'asc' ? 'desc' : 'asc' })} className="inline-flex min-h-7 items-center gap-1 hover:text-ink">
                    {column.header}<Arrow weight="bold" aria-hidden className={sorted ? 'text-lagoon-deep' : 'opacity-50'} />
                  </button>
                ) : column.header}
              </th>
            )
          })}
        </tr>
      </thead>
      {loading ? (
        <tbody aria-busy>
          {Array.from({ length: 6 }, (_, index) => (
            <tr key={index} className="border-b border-line">
              {columns.map((column) => <td key={column.key} className={cn('px-4 py-3.5', column.hideBelow && hidden[column.hideBelow])}><Skeleton className="h-4 w-3/4" /></td>)}
            </tr>
          ))}
        </tbody>
      ) : sections.map(({ info, items }, index) => (
        <tbody key={info?.key ?? index} aria-label={info?.label}>
          {info && <tr className="border-b border-line bg-mist/60"><th scope="rowgroup" colSpan={columns.length} className="px-4 py-2 text-left font-semibold">{info.header}</th></tr>}
          {items.map(line)}
        </tbody>
      ))}
      {!loading && rows.length === 0 && <tfoot><tr><td colSpan={columns.length} className="px-4 py-6 text-slate">{t('common.nothingHere')}</td></tr></tfoot>}
    </table>
  )
}

/** Lists page by key, not by number, so the only way forward is the next page. */
export function LoadMore({ shown, onLoad, busy, label }: { shown: string; onLoad?: () => void; busy?: boolean; label: string }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-between gap-4">
      <p className="text-sm text-slate">{shown}</p>
      {onLoad && <Button variant="secondary" size="sm" onClick={onLoad} busy={busy} busyLabel={t('common.loading')}>{label}</Button>}
    </div>
  )
}
