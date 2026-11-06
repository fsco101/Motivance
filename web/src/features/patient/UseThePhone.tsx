import { useTranslation } from 'react-i18next'
import { AppQrCode, appUrl } from '@/components/AppQrCode'
import { Button } from '@/components/Button'
import { Dialog } from '@/components/Dialog'

/** The one thing a patient cannot do here. Movement is measured through the phone's camera, so the exercise never runs in a browser. */
export function UseThePhone({ open, onOpenChange, exercise }: { open: boolean; onOpenChange: (open: boolean) => void; exercise?: string | null }) {
  const { t } = useTranslation()
  const url = appUrl()
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('patient.phoneTitle')} description={exercise ? t('patient.phoneExercise', { exercise }) : t('patient.phoneCamera')}>
      {url ? (
        <div className="flex flex-col items-center gap-5 tablet:flex-row">
          <AppQrCode url={url} label={t('patient.phoneQr')} />
          <div>
            <p className="mb-3 text-slate">{t('patient.phoneScan')}</p>
            <a href={url} target="_blank" rel="noreferrer" className="font-semibold text-lagoon-deep underline underline-offset-4">{t('patient.phoneGetApp')}</a>
          </div>
        </div>
      ) : <p className="text-slate">{t('patient.phoneOpen')}</p>}
      <div className="mt-6 flex justify-end"><Button variant="secondary" onClick={() => onOpenChange(false)}>{t('common.done')}</Button></div>
    </Dialog>
  )
}
