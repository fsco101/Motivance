import { CheckCircleIcon, MinusIcon, PlusIcon } from '@phosphor-icons/react'
import { AnimatePresence, m as motion } from 'motion/react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton } from '@/components/Button'
import { Dialog } from '@/components/Dialog'
import { Avatar, Notice, PageHeader, StatusPill } from '@/components/Display'
import { TextField } from '@/components/Field'
import type { CatalogueExercise, Joint } from '@/data/catalogue'
import { JOINTS } from '@/data/catalogue'
import { readTiming, secondsText, validRange, validRepetitions, type CustomExerciseDraft, type PrescriptionDraft } from '@/data/therapist'
import type { PlanSummary } from '@/data/workspace'
import { Loadable, SkeletonLines, type Load } from '@/features/shared'
import { cn } from '@/lib/cn'
import { RANGE_MIN_GAP } from '@/motion/geometry'
import { RangeArc } from '@/motion/RangeArc'
import { RangeDial } from '@/motion/RangeDial'
import { duration, ease, spring } from '@/motion/tokens'
import { CustomExerciseForm } from './CustomExerciseForm'

export type AssignmentContext = { patient: { id: string; name: string; photo?: string | null }; catalogue: CatalogueExercise[] }

function Step({ number, title, help, done, children }: { number: number; title: string; help: string; done: boolean; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <section className="grid gap-x-4 gap-y-3 rounded-card border border-line bg-paper p-5 shadow-rest tablet:grid-cols-[2rem_minmax(0,1fr)]">
      <motion.span animate={{ scale: done ? [1, 1.12, 1] : 1 }} transition={{ duration: duration.slow }}
        className={cn('numeric grid size-8 place-items-center rounded-full text-base font-bold transition-colors transition-quick', done ? 'bg-sprout text-paper' : 'bg-tide text-ink')}>
        {done ? <CheckCircleIcon weight="fill" aria-label={t('common.done')} /> : number}
      </motion.span>
      <div className="min-w-0">
        <h2 className="text-base font-bold">{title}</h2>
        <p className="mb-3 text-sm text-slate">{help}</p>
        {children}
      </div>
    </section>
  )
}

function Choice({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onClick}
      className={cn('min-h-9 rounded-control border px-3 text-left text-sm font-semibold transition-colors transition-quick', selected ? 'border-lagoon bg-tide text-ink' : 'border-line-strong bg-paper hover:border-lagoon')}>
      {children}
    </button>
  )
}

type EditorProps = { existing?: PlanSummary; busy?: boolean; onPublish: (draft: PrescriptionDraft) => void; onCreateExercise: (draft: CustomExerciseDraft) => Promise<string> }

const number = (value: unknown, fallback: number) => (typeof value === 'number' ? value : fallback)

function Editor({ context, existing, busy, onPublish, onCreateExercise }: EditorProps & { context: AssignmentContext }) {
  const { t } = useTranslation()
  const parameters = existing?.parameters ?? {}
  const [exercise, setExercise] = useState(existing?.exerciseId ?? '')
  const [side, setSide] = useState<'left' | 'right'>(existing?.side === 'right' ? 'right' : 'left')
  const [focus, setFocus] = useState<Joint | ''>(typeof parameters.focus_joint === 'string' ? (parameters.focus_joint as Joint) : '')
  const [low, setLow] = useState(existing?.low ?? 20)
  const [high, setHigh] = useState(existing?.high ?? 90)
  const [repetitions, setRepetitions] = useState(existing?.repetitions ?? 5)
  const [timing, setTiming] = useState(false)
  // Typed and shown in seconds; the plan still stores milliseconds.
  const [minimum, setMinimum] = useState(secondsText(number(parameters.minimum_cycle_ms, 600)))
  const [maximum, setMaximum] = useState(secondsText(number(parameters.maximum_cycle_ms, 30000)))
  const [hold, setHold] = useState(secondsText(number(parameters.peak_hold_ms, 100)))
  const [lean, setLean] = useState(String(number(parameters.max_trunk_lean_degrees, 20)))
  const [adding, setAdding] = useState(false)

  const rangeError = validRange(low, high) ? null : t('assign.rangeError')
  const repsError = validRepetitions(repetitions) ? null : t('assign.repsError')
  const parsed = readTiming({ minimum, maximum, hold, lean })
  const timingError = parsed ? null : t('assign.timingError')

  const chosen = context.catalogue.find((item) => item.id === exercise)
  const publishable = Boolean(chosen) && !chosen?.retired && !rangeError && !repsError && parsed !== null
  // An older version stays available to the plan already pinned to it.
  const options = context.catalogue.filter((item) => item.selectable || item.id === existing?.exerciseId)
  return (
    <>
            <PageHeader title={existing ? t('assign.editing', { version: existing.version }) : t('assign.title')}>
              <div className="mt-3 flex items-center gap-2"><Avatar name={context.patient.name} photo={context.patient.photo} size={28} /><span className="font-semibold">{context.patient.name}</span></div>
            </PageHeader>
            <div className="grid items-start gap-5 desk:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="flex min-w-0 flex-col gap-4">
                <Step number={1} title={t('assign.exercise')} help={t('assign.exerciseHelp')} done={Boolean(chosen)}>
                  {chosen?.retired && <div className="mb-3"><Notice tone="info">{t('assign.removedHint')}</Notice></div>}
                  <div role="radiogroup" aria-label={t('assign.exercise')} className="grid gap-2 tablet:grid-cols-2">
                    {options.map((item) => (
                      <button key={item.id} type="button" role="radio" aria-checked={exercise === item.id} onClick={() => setExercise(item.id)}
                        className={cn('rounded-control border p-3 text-left transition-colors transition-quick', exercise === item.id ? 'border-lagoon bg-tide' : 'border-line bg-paper hover:border-lagoon')}>
                        <span className="flex flex-wrap items-center gap-2 text-sm font-bold">{item.name}{!item.selectable && <StatusPill tone="caution">{t(item.retired ? 'assign.removed' : 'assign.pinned')}</StatusPill>}</span>
                        <span className="line-clamp-2 text-sm text-slate">{item.instructions}</span>
                      </button>
                    ))}
                  </div>
                  <Button variant="quiet" size="sm" className="mt-2" onClick={() => setAdding(true)} leading={<PlusIcon weight="bold" aria-hidden />}>{t('custom.add')}</Button>
                </Step>
                <Step number={2} title={t('assign.side')} help={t('assign.sideHelp')} done>
                  <div role="radiogroup" aria-label={t('assign.side')} className="flex flex-wrap gap-2">
                    {(['left', 'right'] as const).map((value) => <Choice key={value} selected={side === value} onClick={() => setSide(value)}>{t(`common.${value}`)}</Choice>)}
                  </div>
                  <h3 className="mb-2 mt-4 text-sm font-semibold">{t('assign.focus')}</h3>
                  <div role="radiogroup" aria-label={t('assign.focus')} className="flex flex-wrap gap-2">
                    <Choice selected={focus === ''} onClick={() => setFocus('')}>{t('record.focusAutomatic')}</Choice>
                    {JOINTS.map((joint) => <Choice key={joint} selected={focus === joint} onClick={() => setFocus(joint)}>{t(`joints.${joint}`)}</Choice>)}
                  </div>
                </Step>
                <Step number={3} title={t('assign.targets')} help={t('assign.targetsHelp')} done={!rangeError && !repsError}>
                  <div className="grid items-center gap-8 tablet:grid-cols-[minmax(0,1fr)_12rem]">
                    <RangeArc low={low} high={high} description={t('assign.rangeLabel', { low, high })} lowLabel={t('assign.low')} highLabel={t('assign.high')} onChange={(nextLow, nextHigh) => { setLow(nextLow); setHigh(nextHigh) }} />
                    <div className="flex flex-col gap-3">
                      <TextField label={t('assign.low')} type="number" inputMode="numeric" min={0} max={180} value={low} onChange={(event) => setLow(Number(event.target.value))} />
                      <TextField label={t('assign.high')} type="number" inputMode="numeric" min={0} max={180} value={high} onChange={(event) => setHigh(Number(event.target.value))} error={rangeError} />
                      <div>
                        <p className="mb-1.5 text-sm font-semibold">{t('record.repetitions')}</p>
                        <div className="flex items-center justify-between rounded-control border border-line-strong bg-paper p-1">
                          <IconButton label={t('assign.fewer')} onClick={() => setRepetitions((value) => Math.max(1, value - 1))}><MinusIcon weight="bold" aria-hidden /></IconButton>
                          <output aria-live="polite" className="numeric text-2xl font-bold">{repetitions}</output>
                          <IconButton label={t('assign.more')} onClick={() => setRepetitions((value) => Math.min(1000, value + 1))}><PlusIcon weight="bold" aria-hidden /></IconButton>
                        </div>
                      </div>
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-slate">{t('assign.gapHint', { gap: RANGE_MIN_GAP })}</p>
                </Step>
                <Step number={4} title={t('assign.timing')} help={t('assign.timingHelp')} done={!timingError}>
                  <Button variant="secondary" size="sm" aria-expanded={timing} onClick={() => setTiming((value) => !value)}>{t(timing ? 'assign.hideTiming' : 'assign.showTiming')}</Button>
                  {timingError && !timing && <p className="mt-2 text-sm text-alarm">{timingError}</p>}
                  <AnimatePresence initial={false}>
                    {timing && (
                      <motion.div className="overflow-hidden" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: duration.slow, ease: ease.out }}>
                        <div className="grid gap-4 pt-4 tablet:grid-cols-2">
                          <TextField label={t('assign.minimumCycle')} hint={t('assign.minimumCycleHint')} inputMode="decimal" value={minimum} onChange={(event) => setMinimum(event.target.value)} />
                          <TextField label={t('assign.maximumCycle')} hint={t('assign.maximumCycleHint')} inputMode="decimal" value={maximum} onChange={(event) => setMaximum(event.target.value)} />
                          <TextField label={t('assign.hold')} hint={t('assign.holdHint')} inputMode="decimal" value={hold} onChange={(event) => setHold(event.target.value)} />
                          <TextField label={t('assign.lean')} hint={t('assign.leanHint')} type="number" value={lean} onChange={(event) => setLean(event.target.value)} error={timingError} />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Step>
              </div>
              <aside className="on-dark rounded-card bg-ink p-5 text-sm text-paper desk:sticky desk:top-19">
                <h2 className="text-base font-bold">{t('assign.review')}</h2>
                <p className="mb-4 text-night-ink">{t('assign.reviewHelp')}</p>
                <div className="grid place-items-center pb-4"><RangeDial dark low={low} high={high} width={220} label={t('assign.rangeLabel', { low, high })} /></div>
                <motion.dl layout transition={spring.layout} className="grid gap-3 border-t border-night-line pt-4">
                  <div className="flex justify-between gap-4"><dt className="text-night-ink">{t('assign.exercise')}</dt><dd className="text-right font-semibold">{chosen?.name ?? t('assign.notChosen')}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-night-ink">{t('record.side')}</dt><dd className="font-semibold">{t(`common.${side}`)}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-night-ink">{t('assign.range')}</dt><dd className="numeric font-semibold">{low}° to {high}°</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-night-ink">{t('record.repetitions')}</dt><dd className="numeric font-semibold">{repetitions}</dd></div>
                </motion.dl>
                {existing && <p className="mt-4 text-sm text-night-ink">{t('assign.nextVersion', { version: existing.version + 1 })}</p>}
                <Button variant="bright" className="mt-5 w-full" disabled={!publishable} busy={busy} busyLabel={t('common.working')}
                  onClick={() => { if (parsed) onPublish({ ...parsed, exerciseId: exercise, side, focus: focus || null, low, high, repetitions, confidence: number(parameters.confidence, 0.7) }) }}>{t('assign.publish')}</Button>
                {!exercise && <p className="mt-2 text-sm text-night-ink">{t('assign.publishHint')}</p>}
              </aside>
            </div>
            <Dialog open={adding} onOpenChange={setAdding} title={t('custom.title')} description={t('custom.help')}>
              <CustomExerciseForm onCancel={() => setAdding(false)} onSave={async (draft) => {
                const version = await onCreateExercise(draft)
                setExercise(version)
                setAdding(false)
              }} />
            </Dialog>
    </>
  )
}

export function AssignmentEditorView({ load, ...props }: EditorProps & { load: Load<AssignmentContext> }) {
  return <Loadable load={load} skeleton={<SkeletonLines rows={8} />}>{(context) => <Editor context={context} {...props} />}</Loadable>
}
