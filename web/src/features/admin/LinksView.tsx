import { LinkSimpleIcon } from '@phosphor-icons/react'
import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { ConfirmDialog } from '@/components/Dialog'
import { Avatar, EmptyState, Notice, PageHeader, StatusPill, Tabs } from '@/components/Display'
import { TextField } from '@/components/Field'
import { Loadable, SkeletonLines, type Load } from '@/features/shared'
import { pickerValue, resolveAccount } from './links'
import { primaryRole, type AdminAccount, type AdminLink } from './types'

export const LINK_DISPLAY_LIMIT = 500
/** Choose from the loaded directory or paste an ID, as on Android. */
function AccountPicker({ title, value, onChange, accounts, error }: { title: string; value: string; onChange: (value: string) => void; accounts: readonly AdminAccount[]; error?: string | null }) {
  const { t } = useTranslation()
  const list = useId()
  return (
    <>
      <TextField label={title} hint={t('admin.pickerHelp')} value={value} list={list} error={error} onChange={(event) => onChange(event.target.value)} className="min-w-64 flex-1" />
      <datalist id={list}>{accounts.map((account) => <option key={account.id} value={pickerValue(account)} />)}</datalist>
    </>
  )
}

type Filter = 'active' | 'revoked' | 'all'
type Pending = { title: string; message: string; confirm: string; destructive: boolean; run: () => void }

export function LinksView({ load, onLink }: { load: Load<{ links: AdminLink[]; accounts: AdminAccount[] }>; onLink: (therapist: string, patient: string, active: boolean) => void }) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<Filter>('active')
  const [needle, setNeedle] = useState('')
  const [therapist, setTherapist] = useState('')
  const [patient, setPatient] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const data = load.status === 'ready' ? load.data : null
  const accounts = useMemo(() => data?.accounts ?? [], [data])
  const groups = useMemo(() => {
    const term = needle.trim().toLowerCase()
    const shown = (data?.links ?? []).filter((link) => (filter === 'all' || link.active === (filter === 'active'))
      && [link.therapistName, link.patientName, link.therapist, link.patient].some((value) => value.toLowerCase().includes(term))).slice(0, LINK_DISPLAY_LIMIT)
    return [...Map.groupBy(shown, (link) => link.therapist).values()]
  }, [data, filter, needle])
  // The confirmation shows the email too, so an administrator can see exactly who they are linking.
  const nameOf = (id: string) => {
    const account = accounts.find((item) => item.id === id)
    return account ? pickerValue(account) : id
  }
  const submit = () => {
    const chosenTherapist = resolveAccount(therapist, accounts.filter((account) => account.roles.includes('therapist')))
    const chosenPatient = resolveAccount(patient, accounts.filter((account) => primaryRole(account) === 'patient' || account.roles.includes('patient')))
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
          <>
            <section aria-label={t('admin.newLink')} className="mb-8 rounded-card border border-line bg-paper p-5">
              <h2 className="mb-3 text-xl font-bold">{t('admin.newLink')}</h2>
              <div className="flex flex-wrap items-start gap-4">
                <AccountPicker title={t('admin.roleTherapist')} value={therapist} onChange={setTherapist} accounts={accounts.filter((account) => account.roles.includes('therapist'))} error={invalid ? t('admin.pickerInvalid') : null} />
                <AccountPicker title={t('admin.rolePatient')} value={patient} onChange={setPatient} accounts={accounts.filter((account) => account.roles.includes('patient'))} />
                <Button className="mt-7" onClick={submit} disabled={exists} leading={<LinkSimpleIcon weight="bold" aria-hidden />}>{t('admin.link')}</Button>
              </div>
              {exists && <p className="mt-2 text-sm text-slate">{t('admin.linkExists')}</p>}
            </section>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
              <Tabs className="flex-1" label={t('admin.filterLabel')} value={filter} onChange={(value) => setFilter(value as Filter)}
                tabs={[{ value: 'active', label: t('admin.linkActive') }, { value: 'revoked', label: t('admin.linkRevoked') }, { value: 'all', label: t('admin.filter.all') }]} />
              <TextField label={t('admin.linkSearch')} value={needle} onChange={(event) => setNeedle(event.target.value)} className="w-72" />
            </div>
            {groups.length === 0 ? <EmptyState title={t('admin.linksEmpty')} detail={t('admin.linksEmptyDetail')} /> : (
              <div className="flex flex-col gap-8">
                {groups.map((group) => {
                  const head = group[0]!
                  const name = head.therapistName || head.therapist.slice(0, 8)
                  return (
                    <section key={head.therapist} aria-label={name}>
                      <div className="mb-1 flex items-center gap-3 border-b border-line-strong pb-2">
                        <Avatar name={name} size={36} />
                        <h2 className="min-w-0 flex-1 truncate text-xl font-bold">{name}</h2>
                        <span className="text-sm text-slate">{t('admin.patientCount', { count: group.length })}</span>
                      </div>
                      <ul className="divide-y divide-line">
                        {group.map((link) => {
                          const patientName = link.patientName || link.patient.slice(0, 8)
                          return (
                            <li key={link.patient} className="flex flex-wrap items-center gap-3 py-2.5">
                              <Avatar name={patientName} size={32} />
                              <span className="min-w-0 flex-1 truncate font-semibold">{patientName}</span>
                              <StatusPill tone={link.active ? 'positive' : 'neutral'}>{t(link.active ? 'admin.linkActive' : 'admin.linkRevoked')}</StatusPill>
                              <Button size="sm" variant={link.active ? 'secondary' : 'quiet'} onClick={() => setPending(link.active
                                ? { title: t('admin.unlink'), message: t('admin.confirmUnlink', { therapist: name, patient: patientName }), confirm: t('admin.unlink'), destructive: true, run: () => onLink(link.therapist, link.patient, false) }
                                : { title: t('admin.restoreLink'), message: `${t('admin.confirmLink', { therapist: name, patient: patientName })} ${t('admin.relinkNotice')}`, confirm: t('admin.restoreLink'), destructive: false, run: () => onLink(link.therapist, link.patient, true) })}>
                                {t(link.active ? 'admin.unlink' : 'admin.restoreLink')}
                              </Button>
                            </li>
                          )
                        })}
                      </ul>
                    </section>
                  )
                })}
              </div>
            )}
            {links.length > LINK_DISPLAY_LIMIT && <Notice tone="info" className="mt-4">{t('admin.linksLimit', { count: LINK_DISPLAY_LIMIT })}</Notice>}
          </>
        )}
      </Loadable>
      <ConfirmDialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null) }} title={pending?.title ?? ''} message={pending?.message ?? ''} confirmLabel={pending?.confirm ?? ''}
        destructive={pending?.destructive} onConfirm={() => pending?.run()} />
    </>
  )
}
