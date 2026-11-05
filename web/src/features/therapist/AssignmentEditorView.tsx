import { CheckCircleIcon, MinusIcon, PlusIcon } from '@phosphor-icons/react'
import { AnimatePresence, m as motion } from 'motion/react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton } from '@/components/Button'
import { Avatar, PageHeader } from '@/components/Display'
import { TextField } from '@/components/Field'
import type { CatalogueExercise, Joint } from '@/data/catalogue'
import { JOINTS } from '@/data/catalogue'
import { Loadable, SkeletonLines, type Load } from '@/features/shared'
import { cn } from '@/lib/cn'
import { RANGE_MIN_GAP } from '@/motion/geometry'
import { RangeArc } from '@/motion/RangeArc'
import { RangeDial } from '@/motion/RangeDial'
import { duration, ease, spring } from '@/motion/tokens'

export type AssignmentContext = { patient: { id: string; name: string; photo?: string | null }; catalogue: CatalogueExercise[] }
export type PrescriptionDraft = {
  exerciseId: string; side: 'left' | 'right'; focus: Joint | null; low: number; high: number; repetitions: number
  minimumCycleMs: number; maximumCycleMs: number; peakHoldMs: number; maxTrunkLean: number
}

function Step({ number, title, help, done, children }: { number: number; title: string; help: string; done: boolean; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <section className="grid gap-x-4 gap-y-3 tablet:grid-cols-[2.5rem_minmax(0,1fr)]">
      <motion.span animate={{ scale: done ? [1, 1.12, 1] : 1 }} transition={{ duration: duration.slow }}
        className={cn('numeric grid size-10 place-items-center rounded-full text-lg font-bold transition-colors transition-quick', done ? 'bg-sprout text-paper' : 'bg-tide text-ink')}>
        {done ? <CheckCircleIcon weight="fill" aria-label={t('common.done')} /> : number}
      </motion.span>
      <div className="min-w-0 border-b border-line pb-8">
        <h2 className="text-2xl font-bold">{title}</h2>
        <p className="mb-4 text-slate">{help}</p>
        {children}
      </div>
    </section>
  )
}

function Choice({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onClick}
      className={cn('min-h-11 rounded-control border px-4 text-left font-semibold transition-colors transition-quick', selected ? 'border-lagoon bg-tide text-ink' : 'border-line-strong bg-paper hover:border-lagoon')}>
      {children}
    </button>
  )
}

export function AssignmentEditorView({ load, onPublish }: { load: Load<AssignmentContext>; onPublish: (draft: PrescriptionDraft) => void }) {
  const { t } = useTranslation()
  const [exercise, setExercise] = useState('')
  const [side, setSide] = useState<'left' | 'right'>('left')
  const [focus, setFocus] = useState<Joint | ''>('')
  const [low, setLow] = useState(20)
  const [high, setHigh] = useState(90)
  const [repetitions, setRepetitions] = useState(5)
  const [timing, setTiming] = useState(false)
  const [minimum, setMinimum] = useState('600')
  const [maximum, setMaximum] = useState('30000')
  const [hold, setHold] = useState('100')
  const [lean, setLean] = useState('20')

  const rangeError = !(low >= 0 && high <= 180 && high > low + 10) ? t('assign.rangeError') : null
  const repsError = repetitions < 1 || repetitions > 1000 ? t('assign.repsError') : null
  const min = Number(minimum); const max = Number(maximum); const peak = Number(hold); const trunk = Number(lean)
  const timingError = !(min >= 100 && min <= 30000 && max > min && max <= 300000 && peak >= 0 && peak <= 5000 && trunk >= 0 && trunk <= 90) ? t('assign.timingError') : null
  const publishable = Boolean(exercise) && !rangeError && !repsError && !timingError

  return (
    <Loadable load={load} skeleton={<SkeletonLines rows={8} />}>
      {(context) => {
        const chosen = context.catalogue.find((item) => item.id === exercise)
        return (
          <>
            <PageHeader title={t('assign.title')}>
              <div className="mt-3 flex items-center gap-2"><Avatar name={context.patient.name} photo={context.patient.photo} size={28} /><span className="font-semibold">{context.patient.name}</span></div>
            </PageHeader>
            <div className="grid items-start gap-10 wide:grid-cols-[minmax(0,1fr)_24rem]">
              <div className="flex min-w-0 flex-col gap-8">
                <Step number={1} title={t('assign.exercise')} help={t('assign.exerciseHelp')} done={Boolean(chosen)}>
                  <div role="radiogroup" aria-label={t('assign.exercise')} className="grid gap-2 tablet:grid-cols-2">
                    {context.catalogue.filter((item) => item.selectable).map((item) => (
                      <button key={item.id} type="button" role="radio" aria-checked={exercise === item.id} onClick={() => setExercise(item.id)}
                        className={cn('rounded-card border p-4 text-left transition-colors transition-quick', exercise === item.id ? 'border-lagoon bg-tide' : 'border-line bg-paper hover:border-lagoon')}>
                        <span className="block text-lg font-bold">{item.name}</span>
                        <span className="line-clamp-2 text-sm text-slate">{item.instructions}</span>
                      </button>
                    ))}
                  </div>
                  <Button variant="quiet" size="sm" className="mt-2" leading={<PlusIcon weight="bold" aria-hidden />}>{t('assign.addCustom')}</Button>
                </Step>
                <Step number={2} title={t('assign.side')} help={t('assign.sideHelp')} done>
                  <div role="radiogroup" aria-label={t('assign.side')} className="flex flex-wrap gap-2">
                    {(['left', 'right'] as const).map((value) => <Choice key={value} selected={side === value} onClick={() => setSide(value)}>{t(`common.${value}`)}</Choice>)}
                  </div>
                  <h3 className="mb-2 mt-5 font-semibold">{t('assign.focus')}</h3>
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
                  <AnimatePresence initial={false}>
                    {timing && (
                      <motion.div className="overflow-hidden" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: duration.slow, ease: ease.out }}>
                        <div className="grid gap-4 pt-4 tablet:grid-cols-2">
                          <TextField label={t('assign.minimumCycle')} hint={t('assign.minimumCycleHint')} type="number" value={minimum} onChange={(event) => setMinimum(event.target.value)} />
                          <TextField label={t('assign.maximumCycle')} hint={t('assign.maximumCycleHint')} type="number" value={maximum} onChange={(event) => setMaximum(event.target.value)} />
                          <TextField label={t('assign.hold')} hint={t('assign.holdHint')} type="number" value={hold} onChange={(event) => setHold(event.target.value)} />
                          <TextField label={t('assign.lean')} hint={t('assign.leanHint')} type="number" value={lean} onChange={(event) => setLean(event.target.value)} error={timingError} />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Step>
              </div>
              <aside className="on-dark rounded-stage bg-ink p-6 text-paper wide:sticky wide:top-6">
                <h2 className="text-2xl font-bold">{t('assign.review')}</h2>
                <p className="mb-5 text-night-ink">{t('assign.reviewHelp')}</p>
                <div className="grid place-items-center pb-4"><RangeDial dark low={low} high={high} width={220} label={t('assign.rangeLabel', { low, high })} /></div>
                <motion.dl layout transition={spring.layout} className="grid gap-3 border-t border-night-line pt-4">
                  <div className="flex justify-between gap-4"><dt className="text-night-ink">{t('assign.exercise')}</dt><dd className="text-right font-semibold">{chosen?.name ?? t('assign.notChosen')}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-night-ink">{t('record.side')}</dt><dd className="font-semibold">{t(`common.${side}`)}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-night-ink">{t('assign.range')}</dt><dd className="numeric font-semibold">{low}° to {high}°</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-night-ink">{t('record.repetitions')}</dt><dd className="numeric font-semibold">{repetitions}</dd></div>
                </motion.dl>
                <Button variant="bright" size="lg" className="mt-6 w-full" disabled={!publishable} onClick={() => onPublish({ exerciseId: exercise, side, focus: focus || null, low, high, repetitions, minimumCycleMs: min, maximumCycleMs: max, peakHoldMs: peak, maxTrunkLean: trunk })}>{t('assign.publish')}</Button>
                {!exercise && <p className="mt-2 text-sm text-night-ink">{t('assign.publishHint')}</p>}
              </aside>
            </div>
          </>
        )
      }}
    </Loadable>
  )
}
