import { PencilSimpleIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { ConfirmDialog } from '@/components/Dialog'
import { EmptyState, PageHeader, StatusPill } from '@/components/Display'
import { TextArea, TextField } from '@/components/Field'
import { Loadable, SkeletonLines, type Load } from '@/features/shared'
import { ExpandableCard } from '@/motion/InteractiveCard'
import type { AdminExercise } from './types'

const NAME_LIMIT = 120
const INSTRUCTION_LIMIT = 4000

type Actions = { onActive: (id: string, active: boolean) => void; onPublish: (id: string, name: string, english: string, filipino: string) => void }

function Exercise({ exercise, actions }: { exercise: AdminExercise; actions: Actions }) {
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
    <>
      <ExpandableCard summary={
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h2 className="text-lg font-bold">{exercise.name}</h2>
          <StatusPill tone="primary">{t('admin.version', { version: exercise.version })}</StatusPill>
          <StatusPill tone={exercise.active ? 'positive' : 'neutral'}>{t(exercise.active ? 'admin.exerciseActive' : 'admin.exerciseInactive')}</StatusPill>
          {exercise.custom && <StatusPill>{t('record.custom')}</StatusPill>}
        </div>
      }>
        {editing ? (
          <div className="flex flex-col gap-4">
            {dirty && <StatusPill tone="caution" className="self-start">{t('admin.unsaved')}</StatusPill>}
            <TextField label={t('admin.name')} maxLength={NAME_LIMIT} value={name} onChange={(event) => setName(event.target.value)} />
            <TextArea label={t('admin.instructionsEn')} maxLength={INSTRUCTION_LIMIT} value={english} onChange={(event) => setEnglish(event.target.value)} />
            <TextArea label={t('admin.instructionsFil')} maxLength={INSTRUCTION_LIMIT} value={filipino} error={filipino.trim() ? null : t('admin.required')} onChange={(event) => setFilipino(event.target.value)} />
            <div className="flex flex-wrap gap-2">
              <Button disabled={!dirty || !valid} onClick={() => setConfirm('publish')}>{t('admin.publish')}</Button>
              <Button variant="secondary" onClick={discard}>{t(dirty ? 'admin.discard' : 'admin.closeEditor')}</Button>
            </div>
          </div>
        ) : (
          <>
            <p className="max-w-[62ch] text-slate">{exercise.english}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" leading={<PencilSimpleIcon aria-hidden />} onClick={() => setEditing(true)}>{t('admin.edit')}</Button>
              <Button variant="quiet" size="sm" onClick={() => setConfirm('status')}>{t(exercise.active ? 'admin.deactivateShort' : 'admin.activateShort')}</Button>
            </div>
          </>
        )}
      </ExpandableCard>
      <ConfirmDialog open={confirm === 'publish'} onOpenChange={() => setConfirm(null)} title={t('admin.publishVersion', { version: next })} message={t('admin.confirmPublish', { name: exercise.name, version: next })}
        confirmLabel={t('admin.publishVersion', { version: next })} onConfirm={() => actions.onPublish(exercise.id, name.trim(), english.trim(), filipino.trim())} />
      <ConfirmDialog open={confirm === 'status'} onOpenChange={() => setConfirm(null)} destructive={exercise.active} title={t(exercise.active ? 'admin.deactivate' : 'admin.activate')}
        message={t(exercise.active ? 'admin.confirmDeactivate' : 'admin.confirmActivate', { name: exercise.name })} confirmLabel={t(exercise.active ? 'admin.deactivateShort' : 'admin.activateShort')}
        onConfirm={() => actions.onActive(exercise.id, !exercise.active)} />
    </>
  )
}

export function CatalogueView({ load, actions }: { load: Load<AdminExercise[]>; actions: Actions }) {
  const { t } = useTranslation()
  return (
    <>
      <PageHeader title={t('admin.catalogueTitle')} description={t('admin.catalogueHelp')} />
      <Loadable load={load} skeleton={<SkeletonLines />}>
        {(exercises) => exercises.length === 0
          ? <EmptyState title={t('admin.catalogueEmpty')} detail={t('admin.catalogueEmptyDetail')} />
          : <div className="flex max-w-4xl flex-col gap-3">{exercises.map((exercise) => <Exercise key={`${exercise.id}-${exercise.version}`} exercise={exercise} actions={actions} />)}</div>}
      </Loadable>
    </>
  )
}
