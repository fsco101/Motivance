import { CheckCircleIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { ConfirmDialog } from '@/components/Dialog'
import { Panel, StatusPill } from '@/components/Display'
import type { ChatConsent } from '@/data/chat'
import { Loadable, SkeletonLines, useFormat, type Load } from '@/features/shared'

/** What a patient agrees to by turning messages on, in the same words as Android. Version care-chat-v2; the fifth point is what v2 added. */
export const AGREEMENT_POINTS = ['chat.agreement.point1', 'chat.agreement.point2', 'chat.agreement.point3', 'chat.agreement.point4', 'chat.agreement.point5'] as const

export function AgreementPoints({ only }: { only?: ReadonlyArray<typeof AGREEMENT_POINTS[number]> }) {
  const { t } = useTranslation()
  return (
    <ul className="grid gap-2">
      {(only ?? AGREEMENT_POINTS).map((key) => (
        <li key={key} className="flex gap-2.5"><CheckCircleIcon aria-hidden weight="fill" className="mt-0.5 shrink-0 text-lg text-lagoon" /><span>{t(key)}</span></li>
      ))}
    </ul>
  )
}

/** Shown in place of the conversations until the patient chooses. Nobody can write to them before then. */
export function ChatAgreementPanel({ busy, onAccept }: { busy: boolean; onAccept: () => void }) {
  const { t } = useTranslation()
  return (
    <Panel title={t('chat.agreement.title')} description={t('chat.agreement.detail')} className="mb-5">
      <AgreementPoints />
      <Button className="mt-4" busy={busy} busyLabel={t('common.working')} onClick={onAccept}>{t('chat.agreement.accept')}</Button>
    </Panel>
  )
}

/** For a patient who agreed before photos and video existed: what they are agreeing to now, and the way to agree. */
export function MediaAgreementPanel({ busy, onAccept }: { busy: boolean; onAccept: () => void }) {
  const { t } = useTranslation()
  return (
    <Panel title={t('chat.agreement.mediaTitle')} description={t('chat.agreement.mediaDetail')} className="mb-5">
      <AgreementPoints only={['chat.agreement.point5']} />
      <Button className="mt-4" busy={busy} busyLabel={t('common.working')} onClick={onAccept}>{t('chat.agreement.allowMedia')}</Button>
    </Panel>
  )
}

/** On Profile, beside the other privacy choices: whether messages are on, and the way to change it. */
export function ChatConsentPanel({ load, onChange }: { load: Load<ChatConsent>; onChange: (granted: boolean) => Promise<void> }) {
  const { t } = useTranslation()
  const format = useFormat()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const change = (granted: boolean) => { setBusy(true); void onChange(granted).finally(() => setBusy(false)) }
  return (
    <Panel title={t('chat.agreement.profileTitle')} description={t('chat.agreement.profileDetail')}>
      <Loadable load={load} skeleton={<SkeletonLines rows={2} />}>
        {(consent) => (
          <div className="flex flex-col items-start gap-3">
            <p className="flex flex-wrap items-center gap-2">
              <StatusPill tone={consent.granted ? 'positive' : 'neutral'}>{t(consent.granted ? 'chat.agreement.on' : 'chat.agreement.off')}</StatusPill>
              {consent.at && <span className="text-sm text-slate">{t('chat.agreement.since', { when: format.date(consent.at) })}</span>}
            </p>
            {consent.granted && !consent.media && <><AgreementPoints only={['chat.agreement.point5']} /><Button busy={busy} busyLabel={t('common.working')} onClick={() => change(true)}>{t('chat.agreement.allowMedia')}</Button></>}
            {consent.granted
              ? <Button variant="secondary" busy={busy} busyLabel={t('common.working')} onClick={() => setConfirming(true)}>{t('chat.agreement.turnOff')}</Button>
              : <><AgreementPoints /><Button busy={busy} busyLabel={t('common.working')} onClick={() => change(true)}>{t('chat.agreement.accept')}</Button></>}
          </div>
        )}
      </Loadable>
      <ConfirmDialog open={confirming} onOpenChange={setConfirming} title={t('chat.agreement.turnOffTitle')} message={t('chat.agreement.turnOffDetail')}
        confirmLabel={t('chat.agreement.turnOff')} cancelLabel={t('chat.agreement.keepOn')} destructive onConfirm={() => change(false)} />
    </Panel>
  )
}
