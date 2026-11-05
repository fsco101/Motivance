import { PencilSimpleIcon, XIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton } from '@/components/Button'
import { DataTable, type Column } from '@/components/DataTable'
import { ConfirmDialog } from '@/components/Dialog'
import { EmptyState, PageHeader, Panel, StatusPill } from '@/components/Display'
import { TextArea, TextField } from '@/components/Field'
import { Loadable, SkeletonLines, type Load } from '@/features/shared'
import type { AdminExercise } from './types'

const NAME_LIMIT = 120
const INSTRUCTION_LIMIT = 4000

type Actions = { onActive: (id: string, active: boolean) => void; onPublish: (id: string, name: string, english: string, filipino: string) => void }

function Details({ exercise, actions, onClose }: { exercise: AdminExercise; actions: Actions; onClose: () => void }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(exercise.name)
  const [english, setEnglish] = useState(exercise.english)
  const [filipino, setFilipino] = useState(exercise.filipino)
  const [confirm, setConfirm] = useState<'publish' | 'status' | null>(null)
  const dirty = name !== exercise.name || english !== exercise.english || filipino !== exercise.filipino
  const valid = name.trim().length >= 1 && english.trim().length >= 1 && filipino.trim().length >= 1
  const next = exercise.version + 1
  const discard = () => { setName(exercise.name); setEnglish(exercise.english); setFilipino(exercise.filipino); setEditing(false) }
  return (
    <aside aria-label={t('admin.accountDetails', { name: exercise.name })} className="rounded-card border border-line bg-paper p-5 shadow-rest desk:sticky desk:top-19">
      <div className="flex items-start gap-3">
        <h2 className="min-w-0 flex-1 text-lg font-bold">{exercise.name}</h2>
        <IconButton label={t('common.close')} onClick={onClose} className="-mr-2 -mt-2"><XIcon aria-hidden /></IconButton>
      </div>
      {editing ? (
        <div className="mt-3 flex flex-col gap-4">
          {dirty && <StatusPill tone="caution" className="self-start">{t('admin.unsaved')}</StatusPill>}
          <TextField label={t('admin.name')} maxLength={NAME_LIMIT} value={name} onChange={(event) => setName(event.target.value)} />
          <TextArea label={t('admin.instructionsEn')} rows={5} maxLength={INSTRUCTION_LIMIT} value={english} onChange={(event) => setEnglish(event.target.value)} />
          <TextArea label={t('admin.instructionsFil')} rows={5} maxLength={INSTRUCTION_LIMIT} value={filipino} error={filipino.trim() ? null : t('admin.required')} onChange={(event) => setFilipino(event.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button disabled={!dirty || !valid} onClick={() => setConfirm('publish')}>{t('admin.publish')}</Button>
            <Button variant="secondary" onClick={discard}>{t(dirty ? 'admin.discard' : 'admin.closeEditor')}</Button>
          </div>
        </div>
      ) : (
        <>
          <h3 className="mt-3 text-sm font-semibold text-slate">{t('admin.instructionsEn')}</h3>
          <p className="text-sm">{exercise.english}</p>
          <h3 className="mt-3 text-sm font-semibold text-slate">{t('admin.instructionsFil')}</h3>
          <p className="text-sm">{exercise.filipino}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" leading={<PencilSimpleIcon aria-hidden />} onClick={() => setEditing(true)}>{t('admin.edit')}</Button>
            <Button variant="quiet" size="sm" onClick={() => setConfirm('status')}>{t(exercise.active ? 'admin.deactivateShort' : 'admin.activateShort')}</Button>
          </div>
        </>
      )}
      <ConfirmDialog open={confirm === 'publish'} onOpenChange={() => setConfirm(null)} title={t('admin.publishVersion', { version: next })} message={t('admin.confirmPublish', { name: exercise.name, version: next })}
        confirmLabel={t('admin.publishVersion', { version: next })} onConfirm={() => actions.onPublish(exercise.id, name.trim(), english.trim(), filipino.trim())} />
      <ConfirmDialog open={confirm === 'status'} onOpenChange={() => setConfirm(null)} destructive={exercise.active} title={t(exercise.active ? 'admin.deactivate' : 'admin.activate')}
        message={t(exercise.active ? 'admin.confirmDeactivate' : 'admin.confirmActivate', { name: exercise.name })} confirmLabel={t(exercise.active ? 'admin.deactivateShort' : 'admin.activateShort')}
        onConfirm={() => actions.onActive(exercise.id, !exercise.active)} />
    </aside>
  )
}

export function CatalogueView({ load, actions }: { load: Load<AdminExercise[]>; actions: Actions }) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<string | null>(null)
  const chosen = load.status === 'ready' ? load.data.find((exercise) => exercise.id === selected) : undefined
  const toggle = (exercise: AdminExercise) => setSelected(exercise.id === selected ? null : exercise.id)
  const columns: ReadonlyArray<Column<AdminExercise>> = [
    { key: 'name', header: t('admin.name'), cell: (exercise) => <button type="button" aria-pressed={exercise.id === selected} onClick={(event) => { event.stopPropagation(); toggle(exercise) }} className="rounded-control text-left font-semibold">{exercise.name}</button> },
    { key: 'type', header: t('admin.typeColumn'), cell: (exercise) => <StatusPill>{t(exercise.custom ? 'record.custom' : 'admin.standard')}</StatusPill> },
    { key: 'version', header: t('admin.versionColumn'), cell: (exercise) => <span className="numeric">{t('admin.version', { version: exercise.version })}</span> },
    { key: 'status', header: t('admin.status'), align: 'end', cell: (exercise) => <StatusPill tone={exercise.active ? 'positive' : 'neutral'}>{t(exercise.active ? 'admin.exerciseActive' : 'admin.exerciseInactive')}</StatusPill> },
  ]
  return (
    <>
      <PageHeader title={t('admin.catalogueTitle')} description={t('admin.catalogueHelp')} />
      <div className={chosen ? 'grid items-start gap-5 desk:grid-cols-[minmax(0,1fr)_24rem]' : undefined}>
        <Panel flush className="min-w-0">
          <Loadable load={load} skeleton={<div className="p-4"><SkeletonLines /></div>}>
            {(exercises) => <DataTable caption={t('nav.catalogue')} columns={columns} rows={exercises} rowKey={(exercise) => exercise.id} onRowClick={toggle} selectedKey={selected} empty={<EmptyState title={t('admin.catalogueEmpty')} detail={t('admin.catalogueEmptyDetail')} />} />}
          </Loadable>
        </Panel>
        {chosen && <Details key={`${chosen.id}-${chosen.version}`} exercise={chosen} actions={actions} onClose={() => setSelected(null)} />}
      </div>
    </>
  )
}
