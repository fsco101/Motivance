import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { Notice } from '@/components/Display'
import { TextArea, TextField } from '@/components/Field'
import { JOINTS, type Joint } from '@/data/catalogue'
import { failureKey } from '@/data/errors'
import { INSTRUCTIONS_LIMIT, NAME_LIMIT, validDraft, type CustomExerciseDraft } from '@/data/therapist'
import { cn } from '@/lib/cn'

const zeroHint = (joint: Joint) => (joint === 'SHOULDER' ? 'custom.zeroSide' : joint === 'ANKLE' ? 'custom.zeroAnkle' : 'custom.zeroStraight')

/** A therapist's own exercise: the words the patient reads and the joint the camera measures. Targets are set per assignment. */
export function CustomExerciseForm({ onSave, onCancel }: { onSave: (draft: CustomExerciseDraft) => Promise<void>; onCancel: () => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [joint, setJoint] = useState<Joint | null>(null)
  const [english, setEnglish] = useState('')
  const [filipino, setFilipino] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  // One ID per set of contents, so retrying after a lost response cannot create a duplicate.
  const request = useRef({ key: '', id: '' })
  const ready = joint !== null && validDraft({ name, joint, english, filipino })
  const save = async () => {
    if (!joint) return
    const key = JSON.stringify([name, joint, english, filipino])
    if (request.current.key !== key) request.current = { key, id: crypto.randomUUID() }
    setBusy(true)
    setFailed(null)
    try {
      await onSave({ id: request.current.id, name, joint, english, filipino })
    } catch (failure) {
      setFailed(t(failureKey(failure)))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-4">
      {failed && <Notice>{failed}</Notice>}
      <TextField label={t('custom.name')} maxLength={NAME_LIMIT} value={name} onChange={(event) => setName(event.target.value)} disabled={busy} />
      <div>
        <p id="custom-joint" className="mb-1.5 text-sm font-semibold">{t('custom.joint')}</p>
        <div role="radiogroup" aria-labelledby="custom-joint" className="flex flex-wrap gap-2">
          {JOINTS.map((item) => (
            <button key={item} type="button" role="radio" aria-checked={joint === item} disabled={busy} onClick={() => setJoint(item)}
              className={cn('min-h-9 rounded-control border px-3 text-sm font-semibold transition-colors transition-quick', joint === item ? 'border-lagoon bg-tide' : 'border-line-strong bg-paper hover:border-lagoon')}>
              {t(`joints.${item}`)}
            </button>
          ))}
        </div>
        {joint && <p className="mt-2 text-sm text-slate">{t(zeroHint(joint))}</p>}
        <p className="mt-2 text-sm text-slate">{t('custom.cameraLimit')}</p>
      </div>
      <TextArea label={t('custom.instructions')} rows={3} maxLength={INSTRUCTIONS_LIMIT} value={english} onChange={(event) => setEnglish(event.target.value)} disabled={busy} />
      <TextArea label={t('custom.instructionsFil')} rows={3} maxLength={INSTRUCTIONS_LIMIT} value={filipino} onChange={(event) => setFilipino(event.target.value)} disabled={busy} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>{t('common.cancel')}</Button>
        <Button disabled={!ready} busy={busy} busyLabel={t('custom.saving')} onClick={() => void save()}>{t('custom.save')}</Button>
      </div>
    </div>
  )
}
