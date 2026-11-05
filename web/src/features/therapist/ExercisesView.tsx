import { PlusIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { ConfirmDialog, Dialog } from '@/components/Dialog'
import { EmptyState, PageHeader, SectionHeading, StatusPill } from '@/components/Display'
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
          const mine = choices.filter((item) => item.custom)
          return (
            <div className="flex flex-col gap-12">
              <section>
                <SectionHeading title={t('exercises.mine')} />
                {mine.length === 0 ? <EmptyState title={t('exercises.emptyTitle')} detail={t('exercises.emptyDetail')} /> : (
                  <ul className="divide-y divide-line border-y border-line">
                    {mine.map((item) => (
                      <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
                        <div className="min-w-0 flex-1 basis-80">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-bold">{item.name}</h3>
                            {item.joint && <StatusPill tone="primary">{t(`joints.${item.joint}`)}</StatusPill>}
                          </div>
                          <p className="mt-1 max-w-[62ch] text-slate">{item.instructions}</p>
                        </div>
                        <Button variant="quiet" size="sm" onClick={() => setRemoving(item)}>{t('custom.remove')}</Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section>
                <SectionHeading title={t('exercises.standard')} />
                <ul className="divide-y divide-line border-y border-line">
                  {choices.filter((item) => !item.custom).map((item) => (
                    <li key={item.id} className="py-4">
                      <h3 className="text-lg font-bold">{item.name}</h3>
                      <p className="mt-1 max-w-[62ch] text-slate">{item.instructions}</p>
                    </li>
                  ))}
                </ul>
              </section>
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
