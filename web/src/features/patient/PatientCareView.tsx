import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { ConfirmDialog } from '@/components/Dialog'
import { Panel, StatusPill } from '@/components/Display'
import { TextField } from '@/components/Field'
import { validInvitation, type ConsentState, type DataRequest, type DataRequestKind } from '@/data/patient'
import { Loadable, SkeletonLines, useFormat, type Load } from '@/features/shared'

export function ConnectPanel({ onConnect }: { onConnect: (code: string) => Promise<void> }) {
  const { t } = useTranslation()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!validInvitation(code)) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    setBusy(true)
    void onConnect(code).then(() => setCode('')).finally(() => setBusy(false))
  }
  return (
    <Panel title={t('patient.connectTitle')} description={t('patient.connectDetail')}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <TextField label={t('patient.connectCode')} value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" error={invalid ? t('patient.connectInvalid') : undefined} />
        <div><Button type="submit" busy={busy} busyLabel={t('patient.connecting')} disabled={!code.trim()}>{t('patient.connectAccept')}</Button></div>
      </form>
    </Panel>
  )
}

export type PrivacyState = { consent: ConsentState; requests: readonly DataRequest[] }
type PrivacyProps = { load: Load<PrivacyState>; onWithdraw: () => Promise<void>; onRequest: (kind: DataRequestKind) => Promise<void> }

/** The same choices and wording as Android, because these are the patient's rights rather than a feature of one app. */
export function PrivacyPanel({ load, onWithdraw, onRequest }: PrivacyProps) {
  const { t } = useTranslation()
  const format = useFormat()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState<DataRequestKind | 'withdraw' | null>(null)
  const run = (what: typeof busy, work: () => Promise<void>) => {
    setBusy(what)
    void work().finally(() => setBusy(null))
  }
  return (
    <Panel title={t('patient.privacyTitle')}>
      <Loadable load={load} skeleton={<SkeletonLines rows={3} />}>
        {({ consent, requests }) => {
          const open = (kind: DataRequestKind) => requests.some((request) => request.kind === kind && request.status === 'requested')
          return (
            <>
              <p className="max-w-[62ch] text-sm text-slate">{t('patient.consentPolicy')}</p>
              {consent && <div className="mt-3"><StatusPill tone={consent === 'granted' ? 'positive' : 'neutral'}>{t(consent === 'granted' ? 'patient.consentGranted' : 'patient.consentWithdrawn')}</StatusPill></div>}
              {consent === 'granted' && <Button className="mt-3" variant="secondary" busy={busy === 'withdraw'} busyLabel={t('common.working')} onClick={() => setConfirming(true)}>{t('patient.consentWithdraw')}</Button>}
              <hr className="my-5 border-line" />
              <p className="max-w-[62ch] text-sm text-slate">{t('patient.requestHelp')}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" disabled={open('export')} busy={busy === 'export'} busyLabel={t('common.working')} onClick={() => run('export', () => onRequest('export'))}>{t('patient.requestExport')}</Button>
                <Button variant="secondary" disabled={open('delete')} busy={busy === 'delete'} busyLabel={t('common.working')} onClick={() => run('delete', () => onRequest('delete'))}>{t('patient.requestDelete')}</Button>
              </div>
              {requests.length > 0 && (
                <ul className="mt-4 divide-y divide-line border-t border-line">
                  {requests.map((request) => (
                    <li key={request.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                      <span>{t(request.kind === 'export' ? 'patient.requestExport' : 'patient.requestDelete')}<span className="block text-slate">{format.date(request.createdAt)}</span></span>
                      <StatusPill tone={request.status === 'fulfilled' ? 'positive' : request.status === 'declined' ? 'caution' : 'neutral'}>{t(`patient.requestStatus.${request.status}`)}</StatusPill>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )
        }}
      </Loadable>
      <ConfirmDialog open={confirming} onOpenChange={setConfirming} title={t('patient.consentWithdraw')} message={t('patient.consentConfirm')} confirmLabel={t('patient.consentWithdraw')} destructive
        onConfirm={() => run('withdraw', onWithdraw)} />
    </Panel>
  )
}
