import { DotsThreeIcon } from '@phosphor-icons/react'
import { m as motion } from 'motion/react'
import { DropdownMenu } from 'radix-ui'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { IconButton } from '@/components/Button'
import { RangeBar } from '@/components/Charts'
import { DataTable, type Column, type Sort } from '@/components/DataTable'
import { Avatar } from '@/components/Display'
import { useFormat } from '@/features/shared'
import { spring } from '@/motion/tokens'

export type PatientSummary = {
  id: string; name: string; photo?: string | null; plans: number
  latest?: { exercise: string; low: number; high: number; reached?: readonly [number, number] | null; when?: string | null } | null
}

function Actions({ patient, onRevoke }: { patient: PatientSummary; onRevoke: () => void }) {
  const { t } = useTranslation()
  const trigger = useRef<HTMLButtonElement>(null)
  const chosen = useRef(false)
  // The confirmation waits for the menu to close, so it opens from the button and focus can return there if cancelled.
  const confirmAfterClose = (event: Event) => {
    if (!chosen.current) return
    chosen.current = false
    event.preventDefault()
    trigger.current?.focus()
    onRevoke()
  }
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild ref={trigger}><IconButton press={false} label={t('patients.actions', { name: patient.name })} className="size-8"><DotsThreeIcon weight="bold" aria-hidden /></IconButton></DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" className="z-50 rounded-control border border-line bg-paper p-1 text-sm shadow-float" onCloseAutoFocus={confirmAfterClose}>
          <DropdownMenu.Item onSelect={() => { chosen.current = true }} className="flex min-h-9 cursor-pointer items-center rounded-md px-3 text-alarm outline-none data-highlighted:bg-alarm-soft">{t('patients.revoke')}</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

type Props = { patients: readonly PatientSummary[]; base: string; sort?: Sort; onSort?: (sort: Sort) => void; onRevoke?: (patient: PatientSummary) => void }

export function PatientTable({ patients, base, sort, onSort, onRevoke }: Props) {
  const { t } = useTranslation()
  const format = useFormat()
  const navigate = useNavigate()
  const open = (patient: PatientSummary) => `${base}/patients/${patient.id}`
  const columns: Array<Column<PatientSummary>> = [
    { key: 'name', header: t('patients.columnPatient'), sortable: true, cell: (patient) => (
      <Link to={open(patient)} aria-label={t('patients.open', { name: patient.name })} onClick={(event) => event.stopPropagation()} className="flex min-w-0 items-center gap-3 rounded-control font-semibold">
        <motion.span layoutId={`patient-${patient.id}`} transition={spring.layout} className="inline-flex"><Avatar name={patient.name} photo={patient.photo} size={32} /></motion.span>
        <span className="truncate">{patient.name}</span>
      </Link>
    ) },
    { key: 'exercise', header: t('patients.columnExercise'), cell: (patient) => (patient.latest ? patient.latest.exercise : <span className="text-slate">{t('patients.noPlan')}</span>) },
    { key: 'range', header: t('patients.columnRange'), hideBelow: 'desk', cell: (patient) => patient.latest && (
      <div className="w-52">
        <p className="mb-1 text-slate">{patient.latest.reached ? t('patients.reached', { low: patient.latest.reached[0], high: patient.latest.reached[1] }) : t('patients.noSessions')}</p>
        <RangeBar low={patient.latest.low} high={patient.latest.high} reached={patient.latest.reached} />
      </div>
    ) },
    { key: 'plans', header: t('patients.columnPlans'), align: 'end', sortable: true, cell: (patient) => <span className="numeric">{patient.plans}</span> },
    { key: 'recent', header: t('patients.columnLast'), align: 'end', sortable: true, hideBelow: 'wide', cell: (patient) => <span className="whitespace-nowrap text-slate">{patient.latest?.when ? format.date(patient.latest.when) : ''}</span> },
  ]
  if (onRevoke) {
    columns.push({ key: 'actions', header: t('patients.columnActions'), align: 'end', cell: (patient) => <span onClick={(event) => event.stopPropagation()} className="inline-flex"><Actions patient={patient} onRevoke={() => onRevoke(patient)} /></span> })
  }
  return <DataTable caption={t('nav.patients')} columns={columns} rows={patients} rowKey={(patient) => patient.id} sort={sort} onSort={onSort} onRowClick={(patient) => void navigate(open(patient))} />
}
