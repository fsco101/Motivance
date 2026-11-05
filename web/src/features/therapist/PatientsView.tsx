import { CheckIcon, CopyIcon, MagnifyingGlassIcon, PlusIcon } from '@phosphor-icons/react'
import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton } from '@/components/Button'
import type { Sort } from '@/components/DataTable'
import { ConfirmDialog, Dialog } from '@/components/Dialog'
import { EmptyState, Notice, PageHeader, Panel } from '@/components/Display'
import { TextField } from '@/components/Field'
import { failureKey } from '@/data/errors'
import { Loadable, SkeletonLines, type Load } from '@/features/shared'
import { PatientTable, type PatientSummary } from './PatientTable'

function Invite({ open, onOpenChange, onInvite }: { open: boolean; onOpenChange: (open: boolean) => void; onInvite: (email: string) => Promise<string> }) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setFailed(null)
    try {
      setCode(await onInvite(email.trim()))
    } catch (failure) {
      setFailed(t(failureKey(failure)))
    } finally {
      setBusy(false)
    }
  }
  const copy = async () => {
    if (!code) return
    await navigator.clipboard.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('patients.invite')} description={t(code ? 'patients.inviteShare' : 'patients.inviteDetail')}>
      {code ? (
        <div className="flex items-center gap-2 rounded-control bg-mist p-3">
          <code className="min-w-0 flex-1 break-all text-sm">{code}</code>
          <IconButton label={t(copied ? 'common.copied' : 'common.copy')} onClick={() => void copy()}>{copied ? <CheckIcon weight="bold" className="text-sprout" aria-hidden /> : <CopyIcon aria-hidden />}</IconButton>
        </div>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          {failed && <Notice>{failed}</Notice>}
          <TextField label={t('auth.email')} type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          <Button type="submit" busy={busy} busyLabel={t('common.working')} className="self-end">{t('patients.createInvite')}</Button>
        </form>
      )}
    </Dialog>
  )
}

export function PatientsView({ load, base, onInvite, onRevoke }: { load: Load<PatientSummary[]>; base: string; onInvite: (email: string) => Promise<string>; onRevoke: (id: string) => void }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>({ key: 'name', direction: 'asc' })
  const [inviting, setInviting] = useState(false)
  const [revoking, setRevoking] = useState<PatientSummary | null>(null)
  const patients = load.status === 'ready' ? load.data : null
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const order = sort.direction === 'asc' ? 1 : -1
    return (patients ?? []).filter((patient) => patient.name.toLowerCase().includes(needle)).sort((a, b) => order * (
      sort.key === 'plans' ? a.plans - b.plans : sort.key === 'recent' ? (a.latest?.when ?? '').localeCompare(b.latest?.when ?? '') : 0
    ) || a.name.localeCompare(b.name) * (sort.key === 'name' ? order : 1))
  }, [patients, query, sort])
  return (
    <>
      <PageHeader title={t('nav.patients')} description={t('patients.description')} actions={<Button onClick={() => setInviting(true)} leading={<PlusIcon weight="bold" aria-hidden />}>{t('patients.invite')}</Button>} />
      <Loadable load={load} skeleton={<SkeletonLines />}>
        {(data) => data.length === 0 ? (
          <Panel><EmptyState title={t('patients.emptyTitle')} detail={t('patients.emptyDetail')} action={<Button onClick={() => setInviting(true)}>{t('patients.invite')}</Button>} /></Panel>
        ) : (
          <Panel flush
            toolbar={<TextField label={t('common.search')} labelHidden value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('patients.searchHint')} className="w-80" trailing={<MagnifyingGlassIcon aria-hidden className="mr-2.5 text-lg text-slate" />} />}
            footer={<p role="status" className="text-sm text-slate">{t('patients.shown', { count: shown.length })}</p>}>
            {shown.length === 0 ? <div className="p-4"><Notice tone="info">{t('patients.noMatch', { query })}</Notice></div>
              : <PatientTable patients={shown} base={base} sort={sort} onSort={setSort} onRevoke={setRevoking} />}
          </Panel>
        )}
      </Loadable>
      <Invite key={String(inviting)} open={inviting} onOpenChange={setInviting} onInvite={onInvite} />
      <ConfirmDialog open={revoking !== null} onOpenChange={(open) => { if (!open) setRevoking(null) }} destructive title={t('patients.revokeTitle', { name: revoking?.name })} message={t('patients.revokeMessage', { name: revoking?.name })}
        confirmLabel={t('patients.revoke')} onConfirm={() => { if (revoking) onRevoke(revoking.id) }} />
    </>
  )
}
