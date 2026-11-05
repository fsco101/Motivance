import { LinkSimpleIcon } from '@phosphor-icons/react'
import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { DataTable, type Column } from '@/components/DataTable'
import { ConfirmDialog } from '@/components/Dialog'
import { Avatar, EmptyState, Notice, PageHeader, Panel, StatusPill, Tabs } from '@/components/Display'
import { TextField } from '@/components/Field'
import { Loadable, SkeletonLines, type Load } from '@/features/shared'
import { patientChoices, pickerValue, resolveAccount, therapistChoices } from './links'
import type { AdminAccount, AdminLink } from './types'

export const LINK_DISPLAY_LIMIT = 500
/** Choose from the loaded directory or paste an ID, as on Android. */
function AccountPicker({ title, value, onChange, accounts, error }: { title: string; value: string; onChange: (value: string) => void; accounts: readonly AdminAccount[]; error?: string | null }) {
  const { t } = useTranslation()
  const list = useId()
  return (
    <>
      <TextField label={title} placeholder={t('admin.pickerHelp')} value={value} list={list} error={error} onChange={(event) => onChange(event.target.value)} className="min-w-64 flex-1" />
      <datalist id={list}>{accounts.map((account) => <option key={account.id} value={pickerValue(account)} />)}</datalist>
    </>
  )
}

type Filter = 'active' | 'revoked' | 'all'
type Pending = { title: string; message: string; confirm: string; destructive: boolean; run: () => void }

export function LinksView({ load, onLink, onMore }: { load: Load<{ links: AdminLink[]; accounts: AdminAccount[]; hasMore?: boolean }>; onLink: (therapist: string, patient: string, active: boolean) => void; onMore?: () => void }) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<Filter>('active')
  const [needle, setNeedle] = useState('')
  const [therapist, setTherapist] = useState('')
  const [patient, setPatient] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const data = load.status === 'ready' ? load.data : null
  const accounts = useMemo(() => data?.accounts ?? [], [data])
  const shown = useMemo(() => {
    const term = needle.trim().toLowerCase()
    return (data?.links ?? []).filter((link) => (filter === 'all' || link.active === (filter === 'active'))
      && [link.therapistName, link.patientName, link.therapist, link.patient].some((value) => value.toLowerCase().includes(term))).slice(0, LINK_DISPLAY_LIMIT)
      .toSorted((a, b) => a.therapistName.localeCompare(b.therapistName) || a.therapist.localeCompare(b.therapist))
  }, [data, filter, needle])
  const therapistLabel = (link: AdminLink) => link.therapistName || link.therapist.slice(0, 8)
  const patientLabel = (link: AdminLink) => link.patientName || link.patient.slice(0, 8)
  const columns: ReadonlyArray<Column<AdminLink>> = [
    { key: 'patient', header: t('admin.rolePatient'), cell: (link) => <span className="flex items-center gap-3 font-semibold"><Avatar name={patientLabel(link)} size={28} /><span className="truncate">{patientLabel(link)}</span></span> },
    { key: 'status', header: t('admin.status'), cell: (link) => <StatusPill tone={link.active ? 'positive' : 'neutral'}>{t(link.active ? 'admin.linkActive' : 'admin.linkRevoked')}</StatusPill> },
    { key: 'action', header: t('patients.columnActions'), align: 'end', cell: (link) => {
      const name = therapistLabel(link)
      const person = patientLabel(link)
      return (
        <Button size="sm" variant={link.active ? 'secondary' : 'quiet'} onClick={() => setPending(link.active
          ? { title: t('admin.unlink'), message: t('admin.confirmUnlink', { therapist: name, patient: person }), confirm: t('admin.unlink'), destructive: true, run: () => onLink(link.therapist, link.patient, false) }
          : { title: t('admin.restoreLink'), message: `${t('admin.confirmLink', { therapist: name, patient: person })} ${t('admin.relinkNotice')}`, confirm: t('admin.restoreLink'), destructive: false, run: () => onLink(link.therapist, link.patient, true) })}>
          {t(link.active ? 'admin.unlink' : 'admin.restoreLink')}
        </Button>
      )
    } },
  ]
  // The confirmation shows the email too, so an administrator can see exactly who they are linking.
  const nameOf = (id: string) => {
    const account = accounts.find((item) => item.id === id)
    return account ? pickerValue(account) : id
  }
  const submit = () => {
    const chosenTherapist = resolveAccount(therapist, therapistChoices(accounts))
    const chosenPatient = resolveAccount(patient, patientChoices(accounts))
    setInvalid(!chosenTherapist || !chosenPatient)
    if (!chosenTherapist || !chosenPatient) return
    if (data?.links.some((link) => link.therapist === chosenTherapist && link.patient === chosenPatient && link.active)) return
    setPending({ title: t('admin.link'), message: t('admin.confirmLink', { therapist: nameOf(chosenTherapist), patient: nameOf(chosenPatient) }), confirm: t('admin.link'), destructive: false, run: () => onLink(chosenTherapist, chosenPatient, true) })
  }
  const exists = data?.links.some((link) => link.active && link.therapist === resolveAccount(therapist, accounts) && link.patient === resolveAccount(patient, accounts))
  return (
    <>
      <PageHeader title={t('admin.linksTitle')} description={t('admin.linkHelp')} />
      <Loadable load={load} skeleton={<SkeletonLines />}>
        {({ links }) => (
          <div className="flex flex-col gap-5">
            <Panel title={t('admin.newLink')}>
              <div className="flex flex-wrap items-start gap-3">
                <AccountPicker title={t('admin.roleTherapist')} value={therapist} onChange={setTherapist} accounts={therapistChoices(accounts)} error={invalid ? t('admin.pickerInvalid') : null} />
                <AccountPicker title={t('admin.rolePatient')} value={patient} onChange={setPatient} accounts={patientChoices(accounts)} />
                <Button className="mt-6.5" onClick={submit} disabled={exists} leading={<LinkSimpleIcon weight="bold" aria-hidden />}>{t('admin.link')}</Button>
              </div>
              {exists && <p className="mt-2 text-sm text-slate">{t('admin.linkExists')}</p>}
              {data?.hasMore && <Button variant="quiet" size="sm" className="mt-2" onClick={onMore}>{t('admin.more')}</Button>}
            </Panel>
            <Panel flush
              toolbar={(
                <>
                  <Tabs label={t('admin.filterLabel')} value={filter} onChange={(value) => setFilter(value as Filter)}
                    tabs={[{ value: 'active', label: t('admin.linkActive') }, { value: 'revoked', label: t('admin.linkRevoked') }, { value: 'all', label: t('admin.filter.all') }]} />
                  <TextField label={t('admin.linkSearch')} labelHidden placeholder={t('admin.linkSearch')} value={needle} onChange={(event) => setNeedle(event.target.value)} className="w-72" />
                </>
              )}>
              <DataTable caption={t('admin.linksTitle')} columns={columns} rows={shown} rowKey={(link) => `${link.therapist}:${link.patient}`} empty={<EmptyState title={t('admin.linksEmpty')} detail={t('admin.linksEmptyDetail')} />}
                group={(link) => {
                  const name = therapistLabel(link)
                  const count = shown.filter((item) => item.therapist === link.therapist).length
                  return { key: link.therapist, label: name, header: <span className="flex items-center gap-2.5"><Avatar name={name} size={24} /><span className="min-w-0 flex-1 truncate">{name}</span><span className="text-xs font-normal text-slate">{t('admin.patientCount', { count })}</span></span> }
                }} />
            </Panel>
            {links.length >= LINK_DISPLAY_LIMIT && <Notice tone="info">{t('admin.linksLimit', { count: LINK_DISPLAY_LIMIT })}</Notice>}
          </div>
        )}
      </Loadable>
      <ConfirmDialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null) }} title={pending?.title ?? ''} message={pending?.message ?? ''} confirmLabel={pending?.confirm ?? ''}
        destructive={pending?.destructive} onConfirm={() => pending?.run()} />
    </>
  )
}
