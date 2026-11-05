import { m as motion } from 'motion/react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { setLanguage, type Language } from '@/locales/i18n'
import { spring } from '@/motion/tokens'

const LANGUAGES: ReadonlyArray<{ value: Language; label: string }> = [{ value: 'en', label: 'English' }, { value: 'fil', label: 'Filipino' }]

export function LanguageSwitch({ className }: { className?: string }) {
  const { t, i18n } = useTranslation()
  const group = useId()
  return (
    <div role="group" aria-label={t('common.language')} className={cn('inline-flex rounded-control bg-mist p-0.5', className)}>
      {LANGUAGES.map((language) => {
        const active = i18n.language === language.value
        return (
          <button key={language.value} type="button" lang={language.value} aria-pressed={active} onClick={() => setLanguage(language.value)}
            className={cn('relative min-h-7 rounded-md px-2.5 text-xs font-semibold transition-colors transition-quick', active ? 'text-paper' : 'text-ink hover:text-lagoon-deep')}>
            {active && <motion.span layoutId={group} transition={spring.layout} className="absolute inset-0 rounded-md bg-ink" />}
            <span className="relative">{language.label}</span>
          </button>
        )
      })}
    </div>
  )
}
