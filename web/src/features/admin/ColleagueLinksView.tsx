import { LinkSimpleIcon } from '@phosphor-icons/react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { ConfirmDialog } from '@/components/Dialog'
import { Panel, PersonName, StatusPill } from '@/components/Display'
import { TextField } from '@/components/Field'
import type { ColleagueLink } from '@/data/colleagues'
import { Loadable, SkeletonLines, type Load } from '@/features/shared'
import { pickerValue, resolveAccount, therapistChoices } from './links'
import type { AdminAccount } from './types'

/**
 * Colleague links between therapists (#173), the same on Android: link two therapists directly, and end any link or request.
 * A link only lets each see the other's patients who chose to share with colleagues.
 */
export function ColleagueLinksPanel({ load, accounts, onSet }: { load: Load<ColleagueLink[]>; accounts: readonly AdminAccount[]; onSet: (first: string, second: string, active: boolean) => void }) {
  const { t } = useTranslation()
  const list = useId()
  const [first, setFirst] = useState('')
  const [second, setSecond] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [pending, setPending] = useState<{ first: string; second: string; active: boolean; message: string } | null>(null)
  const therapists = therapistChoices(accounts)
  const label = (id: string) => { const account = accounts.find((item) => item.id === id); return account ? pickerValue(account) : id }
  const submit = () => {
    const a = resolveAccount(first, therapists)
    const b = resolveAccount(second, therapists)
    setInvalid(!a || !b || a === b)
    if (!a || !b || a === b) return
    setPending({ first: a, second: b, active: true, message: t('colleagues.admin.confirmLink', { first: label(a), second: label(b) }) })
  }
  return (
    <Panel title={t('colleagues.admin.title')} description={t('colleagues.admin.description')}>
      <div className="flex flex-wrap items-start gap-3">
        {[[first, setFirst, 'colleagues.admin.first'], [second, setSecond, 'colleagues.admin.second']].map(([value, set, key]) => (
          <TextField key={key as string} label={t(key as string)} placeholder={t('admin.pickerHelp')} value={value as string} list={list} className="min-w-64 flex-1"
            error={invalid && key === 'colleagues.admin.first' ? t('colleagues.admin.invalid') : null} onChange={(event) => (set as (next: string) => void)(event.target.value)} />
        ))}
        <datalist id={list}>{therapists.map((account) => <option key={account.id} value={pickerValue(account)} />)}</datalist>
        <Button className="mt-6.5" onClick={submit} leading={<LinkSimpleIcon weight="bold" aria-hidden />}>{t('colleagues.admin.link')}</Button>
      </div>
      <Loadable load={load} skeleton={<SkeletonLines rows={2} />}>
        {(links) => links.length === 0 ? <p className="mt-4 text-sm text-slate">{t('colleagues.admin.none')}</p> : (
          <ul aria-label={t('colleagues.admin.title')} className="mt-4 divide-y divide-line">
            {links.map((link) => (
              <li key={link.id} className="flex flex-wrap items-center gap-3 py-3">
                <PersonName name={link.firstName} size={28} className="font-semibold" />
                <span aria-hidden className="text-slate">↔</span>
                <PersonName name={link.secondName} size={28} className="min-w-0 flex-1 font-semibold" />
                <StatusPill tone={link.state === 'active' ? 'positive' : 'caution'}>{t(link.state === 'active' ? 'colleagues.linked' : 'colleagues.waiting')}</StatusPill>
                <Button size="sm" variant="secondary" onClick={() => setPending({ first: link.firstId, second: link.secondId, active: false,
                  message: t('colleagues.admin.confirmEnd', { first: link.firstName, second: link.secondName }) })}>{t('colleagues.end')}</Button>
              </li>
            ))}
          </ul>
        )}
      </Loadable>
      <ConfirmDialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null) }} title={t(pending?.active ? 'colleagues.admin.link' : 'colleagues.end')}
        message={pending?.message ?? ''} confirmLabel={t(pending?.active ? 'colleagues.admin.link' : 'colleagues.end')} destructive={pending?.active === false}
        onConfirm={() => { if (pending) onSet(pending.first, pending.second, pending.active); setPending(null) }} />
    </Panel>
  )
}
