import { CheckIcon, EyeIcon, UserPlusIcon, XIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Button } from '@/components/Button'
import { ConfirmDialog, Dialog } from '@/components/Dialog'
import { Avatar, EmptyState, Notice, Panel, PersonName, StatusPill } from '@/components/Display'
import { TextField } from '@/components/Field'
import type { Colleague, ColleagueAccess, ColleaguePatient, ColleaguePlanItem } from '@/data/colleagues'
import { Loadable, SkeletonLines, useFormat, type Load } from '@/features/shared'

export type ColleagueActions = {
  onInvite: (email: string) => Promise<void>
  onRespond: (colleague: Colleague, accept: boolean) => Promise<void>
  onEnd: (colleague: Colleague) => Promise<void>
}

/** Colleagues (#173): invite by email, accept or decline an invitation, and end a link at any time. */
export function ColleaguesPanel({ load, actions }: { load: Load<Colleague[]>; actions: ColleagueActions }) {
  const { t } = useTranslation()
  const [inviting, setInviting] = useState(false)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [ending, setEnding] = useState<Colleague | null>(null)
  const run = async (work: () => Promise<void>) => { setBusy(true); try { await work() } catch { /* The page has said what went wrong. */ } finally { setBusy(false) } }
  return (
    <Panel title={t('colleagues.title')} description={t('colleagues.description')}
      action={<Button size="sm" variant="secondary" leading={<UserPlusIcon aria-hidden />} onClick={() => { setEmail(''); setInviting(true) }}>{t('colleagues.invite')}</Button>}>
      <Loadable load={load} skeleton={<SkeletonLines rows={2} />}>
        {(colleagues) => colleagues.length === 0 ? <p className="text-sm text-slate">{t('colleagues.none')}</p> : (
          <ul aria-label={t('colleagues.title')} className="divide-y divide-line">
            {colleagues.map((colleague) => (
              <li key={colleague.id} className="flex flex-wrap items-center gap-3 py-3">
                <PersonName name={colleague.name} photo={colleague.photo} size={32} className="min-w-0 flex-1 font-semibold" />
                <StatusPill tone={colleague.state === 'active' ? 'positive' : 'caution'}>
                  {t(colleague.state === 'active' ? 'colleagues.linked' : colleague.incoming ? 'colleagues.invitedYou' : 'colleagues.waiting')}
                </StatusPill>
                {colleague.state === 'requested' && colleague.incoming ? (
                  <span className="flex gap-2">
                    <Button size="sm" leading={<CheckIcon aria-hidden />} busy={busy} onClick={() => void run(() => actions.onRespond(colleague, true))}>{t('colleagues.accept')}</Button>
                    <Button size="sm" variant="secondary" leading={<XIcon aria-hidden />} disabled={busy} onClick={() => void run(() => actions.onRespond(colleague, false))}>{t('colleagues.decline')}</Button>
                  </span>
                ) : (
                  <Button size="sm" variant="quiet" onClick={() => setEnding(colleague)}>{t(colleague.state === 'active' ? 'colleagues.end' : 'colleagues.withdraw')}</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Loadable>
      <Dialog open={inviting} onOpenChange={setInviting} title={t('colleagues.inviteTitle')} description={t('colleagues.inviteDetail')}>
        <form onSubmit={(event) => { event.preventDefault(); void run(async () => { await actions.onInvite(email); setInviting(false) }) }}>
          <TextField label={t('colleagues.email')} type="email" autoComplete="off" required value={email} onChange={(event) => setEmail(event.target.value)} />
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setInviting(false)}>{t('common.cancel')}</Button>
            <Button type="submit" busy={busy} disabled={!email.includes('@')}>{t('colleagues.send')}</Button>
          </div>
        </form>
      </Dialog>
      <ConfirmDialog open={ending !== null} onOpenChange={(open) => { if (!open) setEnding(null) }} destructive
        title={t('colleagues.endTitle', { name: ending?.name })} message={t('colleagues.endMessage', { name: ending?.name })} confirmLabel={t('colleagues.end')}
        onConfirm={() => { const target = ending; setEnding(null); if (target) void run(() => actions.onEnd(target)) }} />
    </Panel>
  )
}

/** Colleagues' patients, apart from one's own and labelled as such. Opening one is recorded. */
export function ColleaguePatientsPanel({ load, base }: { load: Load<ColleaguePatient[]>; base: string }) {
  const { t } = useTranslation()
  return (
    <Panel title={t('colleagues.patientsTitle')} description={t('colleagues.patientsDescription')}>
      <Loadable load={load} skeleton={<SkeletonLines rows={2} />}>
        {(patients) => patients.length === 0 ? <p className="text-sm text-slate">{t('colleagues.noPatients')}</p> : (
          <ul aria-label={t('colleagues.patientsTitle')} className="divide-y divide-line">
            {patients.map((patient) => (
              <li key={patient.id}>
                <Link to={`${base}/colleague-patients/${patient.id}`} className="flex items-center gap-3 rounded-control py-3 hover:bg-mist">
                  <Avatar name={patient.name} photo={patient.photo} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{patient.name}</span>
                    <span className="block text-sm text-slate">{t('colleagues.patientOf', { name: patient.therapistName })}</span>
                  </span>
                  <StatusPill tone="neutral" icon={<EyeIcon aria-hidden />}>{t('colleagues.readOnly')}</StatusPill>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Loadable>
    </Panel>
  )
}

/** The header of a colleague's patient: who they are, whose patient, and that this view is read-only. */
export function ColleaguePatientHeader({ patient }: { patient: { name: string; photo: string | null; therapists: string[] } }) {
  const { t } = useTranslation()
  return (
    <div className="mb-5 flex flex-wrap items-center gap-4 rounded-card border border-line bg-paper p-4 shadow-rest">
      <Avatar name={patient.name} photo={patient.photo} size={56} />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-title font-bold">{patient.name}</h1>
        <p className="text-sm text-slate">{t('colleagues.patientOf', { name: patient.therapists.join(', ') })}</p>
      </div>
      <StatusPill tone="primary" icon={<EyeIcon aria-hidden />}>{t('colleagues.colleaguePatient')}</StatusPill>
      <Notice tone="info" className="w-full">{t('colleagues.readOnlyDetail')}</Notice>
    </div>
  )
}

export function ColleaguePlan({ load }: { load: Load<ColleaguePlanItem[]> }) {
  const { t } = useTranslation()
  return (
    <Panel title={t('colleagues.planTitle')} className="mb-5">
      <Loadable load={load} skeleton={<SkeletonLines rows={2} />}>
        {(items) => items.length === 0 ? <p className="text-sm text-slate">{t('colleagues.noPlan')}</p> : (
          <ul className="divide-y divide-line">
            {items.map((item) => (
              <li key={item.assignmentId} className="py-2">
                <p className="font-semibold">{item.exercise || t('progress.unknown')}</p>
                <p className="text-sm text-slate">{t('colleagues.planLine', { side: t(`common.${item.side}`, item.side), low: item.low, high: item.high, repetitions: item.repetitions })}</p>
              </li>
            ))}
          </ul>
        )}
      </Loadable>
    </Panel>
  )
}

/** For a patient's own therapist: whether the patient shares with colleagues, who can see their progress, and when each last looked. */
export function ColleagueAccessPanel({ load }: { load: Load<ColleagueAccess> }) {
  const { t } = useTranslation()
  const format = useFormat()
  return (
    <section aria-labelledby="colleague-access" className="mt-6 border-t border-line pt-5">
      <h2 id="colleague-access" className="font-sans text-base font-bold">{t('colleagues.accessTitle')}</h2>
      <Loadable load={load} skeleton={<SkeletonLines rows={1} />}>
        {(access) => !access.sharing ? <p className="mt-1 text-sm text-slate">{t('colleagues.accessOff')}</p>
          : access.colleagues.length === 0 ? <p className="mt-1 text-sm text-slate">{t('colleagues.accessNone')}</p> : (
            <ul className="mt-2 flex flex-col gap-2">
              {access.colleagues.map((colleague) => (
                <li key={colleague.id} className="text-sm">
                  <PersonName name={colleague.name} photo={colleague.photo} size={24} className="font-semibold" />
                  <span className="block text-slate">{colleague.lastViewedAt ? t('colleagues.lastViewed', { when: format.dateTime(colleague.lastViewedAt) }) : t('colleagues.neverViewed')}</span>
                </li>
              ))}
            </ul>
          )}
      </Loadable>
    </section>
  )
}

/** An empty state for a colleague's patient who can no longer be seen: the link ended, or the patient turned sharing off. */
export function ColleagueUnavailable() {
  const { t } = useTranslation()
  return <EmptyState title={t('colleagues.unavailableTitle')} detail={t('colleagues.unavailableDetail')} />
}

/**
 * The patient's own choice (#173): whether the therapist's linked colleagues may see their progress. Off until they turn it on;
 * turning it off ends every colleague's access at once. Contact details, messages and the plan's management stay with their therapist.
 */
export function ColleagueSharingPanel({ load, onChange }: { load: Load<boolean>; onChange: (granted: boolean) => Promise<void> }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  // Shows the choice at once, then whatever the server holds once it answers.
  const [chosen, setChosen] = useState<boolean | null>(null)
  const change = async (granted: boolean) => { setChosen(granted); setBusy(true); try { await onChange(granted) } finally { setBusy(false); setChosen(null) } }
  return (
    <Panel title={t('colleagues.sharingTitle')} description={t('colleagues.sharingDetail')}>
      <Loadable load={load} skeleton={<SkeletonLines rows={2} />}>
        {(stored) => { const granted = chosen ?? stored; return (
          <div className="flex flex-col gap-3">
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
              {[1, 2, 3].map((n) => <li key={n}>{t(`colleagues.sharingPoint${n}`)}</li>)}
            </ul>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control border border-line px-3 py-2">
              <input type="checkbox" role="switch" className="size-5 accent-lagoon" checked={granted} disabled={busy} onChange={(event) => void change(event.target.checked)} />
              <span className="font-semibold">{t('colleagues.sharingSwitch')}</span>
            </label>
            <p role="status" className="text-sm text-slate">{t(granted ? 'colleagues.sharingOn' : 'colleagues.sharingOff')}</p>
          </div>
        ) }}
      </Loadable>
    </Panel>
  )
}
