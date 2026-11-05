import { PlusIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { DataTable, type Column } from '@/components/DataTable'
import { ConfirmDialog, Dialog } from '@/components/Dialog'
import { EmptyState, PageHeader, Panel, StatusPill } from '@/components/Display'
import type { CatalogueExercise } from '@/data/catalogue'
import type { CustomExerciseDraft } from '@/data/therapist'
import { Loadable, SkeletonLines, type Load } from '@/features/shared'
import { CustomExerciseForm } from './CustomExerciseForm'

type Props = { load: Load<CatalogueExercise[]>; onCreate: (draft: CustomExerciseDraft) => Promise<void>; onRemove: (exercise: CatalogueExercise) => void }

export function ExercisesView({ load, onCreate, onRemove }: Props) {
  const { t } = useTranslation()
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<CatalogueExercise | null>(null)
  return (
    <>
      <PageHeader title={t('nav.exercises')} description={t('exercises.description')} actions={<Button onClick={() => setAdding(true)} leading={<PlusIcon weight="bold" aria-hidden />}>{t('custom.add')}</Button>} />
      <Loadable load={load} skeleton={<SkeletonLines />}>
        {(catalogue) => {
          const choices = catalogue.filter((item) => item.selectable)
          const name: Column<CatalogueExercise> = { key: 'name', header: t('exercises.columnName'), cell: (item) => <h3 className="flex flex-wrap items-center gap-2 font-sans text-sm font-semibold">{item.name}{item.joint && <StatusPill tone="primary">{t(`joints.${item.joint}`)}</StatusPill>}</h3> }
          const instructions: Column<CatalogueExercise> = { key: 'instructions', header: t('exercises.columnInstructions'), hideBelow: 'desk', cell: (item) => <p className="line-clamp-2 max-w-[72ch] text-slate">{item.instructions}</p> }
          const mine = choices.filter((item) => item.custom)
          return (
            <div className="flex flex-col gap-5">
              <Panel title={t('exercises.mine')} flush>
                <DataTable caption={t('exercises.mine')} rows={mine} rowKey={(item) => item.id} empty={<EmptyState title={t('exercises.emptyTitle')} detail={t('exercises.emptyDetail')} />}
                  columns={[name, instructions, { key: 'remove', header: t('patients.columnActions'), align: 'end', cell: (item) => <Button variant="quiet" size="sm" onClick={() => setRemoving(item)}>{t('custom.remove')}</Button> }]} />
              </Panel>
              <Panel title={t('exercises.standard')} flush>
                <DataTable caption={t('exercises.standard')} rows={choices.filter((item) => !item.custom)} rowKey={(item) => item.id} columns={[name, instructions]} />
              </Panel>
            </div>
          )
        }}
      </Loadable>
      <Dialog open={adding} onOpenChange={setAdding} title={t('custom.title')} description={t('custom.help')}>
        <CustomExerciseForm onCancel={() => setAdding(false)} onSave={async (draft) => { await onCreate(draft); setAdding(false) }} />
      </Dialog>
      <ConfirmDialog open={removing !== null} onOpenChange={(open) => { if (!open) setRemoving(null) }} destructive title={t('custom.removeTitle', { name: removing?.name })} message={t('custom.removeDetail')}
        confirmLabel={t('custom.remove')} onConfirm={() => { if (removing) onRemove(removing) }} />
    </>
  )
}
