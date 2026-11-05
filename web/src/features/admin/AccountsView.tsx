import { CheckIcon, CopyIcon, MagnifyingGlassIcon, XIcon } from '@phosphor-icons/react'
import { AnimatePresence, m as motion } from 'motion/react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { Button, IconButton } from '@/components/Button'
import { DataTable, LoadMore, type Column } from '@/components/DataTable'
import { ConfirmDialog } from '@/components/Dialog'
import { Avatar, EmptyState, Notice, PageHeader, Panel, StatusPill, Tabs } from '@/components/Display'
import { TextField } from '@/components/Field'
import { Fact, Loadable, SkeletonLines, useFormat, type Load } from '@/features/shared'
import { spring } from '@/motion/tokens'
import { label, primaryRole, type AdminAccount, type StaffRole } from './types'

const FILTERS = ['all', 'patients', 'therapists', 'admins', 'disabled'] as const
type Filter = (typeof FILTERS)[number]

const accepts = (filter: Filter, account: AdminAccount) => (
  filter === 'all' ? true : filter === 'patients' ? primaryRole(account) === 'patient' : filter === 'therapists' ? account.roles.includes('therapist')
    : filter === 'admins' ? account.roles.includes('admin') : !account.active
)

type Pending = { title: string; message: string; confirm: string; destructive: boolean; run: () => void }
export type AccountActions = {
  onSearch: (query: string) => void; onMore?: () => void; onActive: (id: string, active: boolean) => void
  onRole: (id: string, role: StaffRole, granted: boolean) => void; onClearPhoto: (id: string) => void
}

function Details({ account, self, actions, onClose, confirm }: { account: AdminAccount; self: boolean; actions: AccountActions; onClose: () => void; confirm: (pending: Pending) => void }) {
  const { t } = useTranslation()
  const format = useFormat()
  const [copied, setCopied] = useState(false)
  const name = label(account)
  const roles: ReadonlyArray<{ role: StaffRole; title: string; revokeDetail: string }> = [
    { role: 'therapist', title: t('admin.roleTherapist'), revokeDetail: t('admin.revokeTherapistDetail') },
    { role: 'admin', title: t('admin.roleAdmin'), revokeDetail: t('admin.revokeAdminDetail') },
  ]
  const copy = async () => {
    await navigator.clipboard.writeText(account.id)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }
  return (
    <motion.aside aria-label={t('admin.accountDetails', { name })} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={spring.layout}
      className="rounded-card border border-line bg-paper p-5 shadow-rest desk:sticky desk:top-19">
      <div className="flex items-start gap-3">
        <Avatar name={name} photo={account.photo} size={52} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-bold">{name}</h2>
          <p className="truncate text-sm text-slate">{account.email}</p>
        </div>
        <IconButton label={t('common.close')} onClick={onClose} className="-mr-2 -mt-2"><XIcon aria-hidden /></IconButton>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-3">
        <Fact term={t('admin.joined')}>{account.joined ? format.date(account.joined) : t('admin.never')}</Fact>
        <Fact term={t('admin.lastSignIn')}>{account.lastSignIn ? format.date(account.lastSignIn) : t('admin.never')}</Fact>
        <Fact term={t('admin.roles')}>{account.roles.map((role) => t(`admin.role${role === 'admin' ? 'Admin' : role === 'therapist' ? 'Therapist' : 'Patient'}`)).join(', ')}</Fact>
        {account.username && <Fact term={t('profile.username')}>{account.username}</Fact>}
      </dl>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="min-w-0"><p className="text-sm text-slate">{t('admin.accountId')}</p><p className="truncate font-semibold">{account.id}</p></div>
        <IconButton label={t(copied ? 'common.copied' : 'admin.copyId')} onClick={() => void copy()}>{copied ? <CheckIcon weight="bold" className="text-sprout" aria-hidden /> : <CopyIcon aria-hidden />}</IconButton>
      </div>
      {self ? <Notice tone="info" className="mt-5">{t('admin.selfNotice')}</Notice> : (
        <>
          <h3 className="mb-2 mt-6 text-lg font-bold">{t('admin.access')}</h3>
          {!account.active && <p className="mb-2 text-sm text-slate">{t('admin.rolesNeedActive')}</p>}
          <ul className="divide-y divide-line border-y border-line">
            {roles.map(({ role, title, revokeDetail }) => {
              const held = account.roles.includes(role)
              return (
                <li key={role} className="flex items-center justify-between gap-3 py-2">
                  <span className="font-semibold">{title}</span>
                  <Button size="sm" variant={held ? 'secondary' : 'quiet'} disabled={!account.active}
                    onClick={() => confirm(held
                      ? { title: t('admin.confirmRevokeTitle', { role: title }), message: `${t('admin.confirmRevoke', { role: title, name })} ${revokeDetail}`, confirm: t('admin.revoke'), destructive: true, run: () => actions.onRole(account.id, role, false) }
                      : { title: t('admin.confirmGrantTitle', { role: title }), message: t('admin.confirmGrant', { role: title, name }), confirm: t('admin.grant'), destructive: false, run: () => actions.onRole(account.id, role, true) })}>
                    {t(held ? 'admin.revoke' : 'admin.grant')}
                  </Button>
                </li>
              )
            })}
          </ul>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button size="sm" variant={account.active ? 'secondary' : 'primary'}
              onClick={() => confirm(account.active
                ? { title: t('admin.disable'), message: t('admin.confirmDisable', { name }), confirm: t('admin.disable'), destructive: true, run: () => actions.onActive(account.id, false) }
                : { title: t('admin.enable'), message: t('admin.confirmEnable', { name }), confirm: t('admin.enable'), destructive: false, run: () => actions.onActive(account.id, true) })}>
              {t(account.active ? 'admin.disable' : 'admin.enable')}
            </Button>
            {account.photo && (
              <Button size="sm" variant="quiet" onClick={() => confirm({ title: t('admin.removePhoto'), message: t('admin.confirmRemovePhoto', { name }), confirm: t('admin.removePhoto'), destructive: true, run: () => actions.onClearPhoto(account.id) })}>
                {t('admin.removePhoto')}
              </Button>
            )}
          </div>
        </>
      )}
    </motion.aside>
  )
}

export function AccountsView({ load, self, actions }: { load: Load<{ accounts: AdminAccount[]; hasMore: boolean; loadingMore?: boolean }>; self: string; actions: AccountActions }) {
  const { t } = useTranslation()
  const format = useFormat()
  const [params] = useSearchParams()
  const [filter, setFilter] = useState<Filter>(FILTERS.find((value) => value === params.get('filter')) ?? 'all')
  const [query, setQuery] = useState('')
  const [searched, setSearched] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const accounts = load.status === 'ready' ? load.data.accounts : []
  const shown = accounts.filter((account) => accepts(filter, account))
  const chosen = accounts.find((account) => account.id === selected)
  const search = (event: FormEvent) => {
    event.preventDefault()
    setSearched(query.trim())
    actions.onSearch(query.trim())
  }
  const columns: ReadonlyArray<Column<AdminAccount>> = [
    { key: 'name', header: t('admin.account'), cell: (a) => (
      <button type="button" aria-pressed={a.id === selected} onClick={(event) => { event.stopPropagation(); setSelected(a.id === selected ? null : a.id) }}
        className="flex min-w-0 items-center gap-3 rounded-control text-left">
        <Avatar name={label(a)} photo={a.photo} size={32} />
        <span className="min-w-0"><span className="block truncate font-semibold">{label(a)}</span><span className="block truncate text-xs text-slate">{a.email}</span></span>
      </button>
    ) },
    { key: 'role', header: t('admin.role'), cell: (a) => <StatusPill tone={primaryRole(a) === 'patient' ? 'neutral' : 'primary'}>{t(`admin.role${primaryRole(a) === 'admin' ? 'Admin' : primaryRole(a) === 'therapist' ? 'Therapist' : 'Patient'}`)}</StatusPill> },
    { key: 'status', header: t('admin.status'), hideBelow: 'desk', cell: (a) => (a.active ? <span className="text-slate">{t('admin.active')}</span> : <StatusPill tone="danger">{t('admin.disabled')}</StatusPill>) },
    { key: 'seen', header: t('admin.lastSignIn'), hideBelow: 'wide', align: 'end', cell: (a) => <span className="whitespace-nowrap text-slate">{a.lastSignIn ? format.date(a.lastSignIn) : t('admin.never')}</span> },
  ]
  return (
    <>
      <PageHeader title={t('nav.accounts')} description={t('admin.searchHelp')} />
      <div className={chosen ? 'grid items-start gap-5 desk:grid-cols-[minmax(0,1fr)_22rem]' : undefined}>
        <Panel flush className="min-w-0"
          toolbar={(
            <>
              <form onSubmit={search} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <TextField label={t('admin.search')} labelHidden placeholder={t('admin.search')} value={query} maxLength={100} onChange={(event) => setQuery(event.target.value)} className="min-w-56 max-w-sm flex-1" />
                <Button type="submit" variant="secondary" leading={<MagnifyingGlassIcon aria-hidden />}>{t('admin.searchAction')}</Button>
                {searched && <Button variant="quiet" onClick={() => { setQuery(''); setSearched(''); actions.onSearch('') }}>{t('admin.searchClear')}</Button>}
              </form>
              <Tabs label={t('admin.filterLabel')} value={filter} onChange={(value) => setFilter(value as Filter)}
                tabs={FILTERS.map((value) => ({ value, label: t(`admin.filter.${value}`), count: accounts.filter((account) => accepts(value, account)).length }))} />
            </>
          )}
          footer={load.status === 'ready' && <LoadMore shown={t('admin.shownCount', { shown: shown.length, total: load.data.accounts.length })} onLoad={load.data.hasMore ? actions.onMore : undefined} busy={load.data.loadingMore} label={t('admin.more')} />}>
          {searched && <p className="border-b border-line px-4 py-2 text-sm text-slate">{t('admin.searchFor', { query: searched })}</p>}
          <Loadable load={load} skeleton={<div className="p-4"><SkeletonLines rows={8} /></div>}>
            {(data) => (
              <DataTable caption={t('nav.accounts')} columns={columns} rows={shown} rowKey={(a) => a.id} onRowClick={(a) => setSelected(a.id === selected ? null : a.id)} selectedKey={selected}
                empty={<EmptyState title={t('admin.accountsEmpty')} detail={t(data.hasMore ? 'admin.accountsEmptyMore' : 'admin.accountsEmptyDetail')} />} />
            )}
          </Loadable>
        </Panel>
        <AnimatePresence>{chosen && <Details key={chosen.id} account={chosen} self={chosen.id === self} actions={actions} onClose={() => setSelected(null)} confirm={setPending} />}</AnimatePresence>
      </div>
      <ConfirmDialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null) }} title={pending?.title ?? ''} message={pending?.message ?? ''} confirmLabel={pending?.confirm ?? ''}
        destructive={pending?.destructive} onConfirm={() => pending?.run()} />
    </>
  )
}
