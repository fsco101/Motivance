import { DotsThreeIcon } from '@phosphor-icons/react'
import { m as motion } from 'motion/react'
import { DropdownMenu } from 'radix-ui'
import { useTranslation } from 'react-i18next'
import { Avatar } from '@/components/Display'
import { IconButton } from '@/components/Button'
import { InteractiveCard } from '@/motion/InteractiveCard'
import { RangeDial } from '@/motion/RangeDial'
import { spring } from '@/motion/tokens'

export type PatientSummary = {
  id: string; name: string; photo?: string | null; plans: number
  /** The newest plan and the movement measured against it, when there is one. */
  latest?: { exercise: string; low: number; high: number; reached?: readonly [number, number] | null; when?: string | null } | null
}

/** Hovering or focusing the card replays the patient's measured movement on its dial. */
export function PatientCard({ patient, to, onRevoke }: { patient: PatientSummary; to: string; onRevoke?: () => void }) {
  const { t } = useTranslation()
  const latest = patient.latest
  return (
    <InteractiveCard to={to} linkLabel={t('patients.open', { name: patient.name })} className="h-full">
      <div className="flex items-start gap-4 p-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <motion.span layoutId={`patient-${patient.id}`} transition={spring.layout} className="inline-flex"><Avatar name={patient.name} photo={patient.photo} size={44} /></motion.span>
            <div className="min-w-0">
              <h3 className="truncate text-lg font-bold">{patient.name}</h3>
              <p className="text-sm text-slate">{t('patients.plans', { count: patient.plans })}</p>
            </div>
          </div>
          <div className="mt-4 min-h-12">
            {latest ? (
              <>
                <p className="truncate font-semibold">{latest.exercise}</p>
                {latest.reached && <p className="text-sm text-slate">{t('patients.reached', { low: latest.reached[0], high: latest.reached[1] })}</p>}
                <p className="text-sm text-slate">{latest.reached ? t('patients.prescribed', { low: latest.low, high: latest.high }) : t('patients.noSessions')}</p>
              </>
            ) : <p className="text-sm text-slate">{t('patients.noPlan')}</p>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {onRevoke ? (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild><IconButton label={t('patients.actions', { name: patient.name })} className="-mr-2 -mt-2"><DotsThreeIcon weight="bold" aria-hidden /></IconButton></DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content align="end" className="z-50 rounded-control border border-line bg-paper p-1 shadow-float">
                  <DropdownMenu.Item onSelect={onRevoke} className="flex min-h-10 cursor-pointer items-center rounded-md px-3 text-alarm outline-none data-highlighted:bg-alarm-soft">{t('patients.revoke')}</DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          ) : <span className="size-6" />}
          {latest && <RangeDial low={latest.low} high={latest.high} reached={latest.reached} width={112}
            label={latest.reached ? t('patients.dial', { low: latest.reached[0], high: latest.reached[1], targetLow: latest.low, targetHigh: latest.high }) : t('patients.dialTarget', { targetLow: latest.low, targetHigh: latest.high })} />}
        </div>
      </div>
    </InteractiveCard>
  )
}
