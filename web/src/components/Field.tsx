import { CaretDownIcon, CheckIcon, EyeIcon, EyeSlashIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { Select as RadixSelect } from 'radix-ui'
import { useId, useState, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'

const control = cn('w-full rounded-control border border-line-strong bg-paper px-3 text-sm text-ink transition-colors transition-quick',
  'placeholder:text-slate hover:border-lagoon disabled:cursor-not-allowed disabled:bg-mist disabled:text-slate',
  'aria-invalid:border-alarm')

type Wrap = { label: string; labelHidden?: boolean; hint?: string; error?: string | null; children: (ids: { id: string; describedBy?: string }) => ReactNode; className?: string }

function FieldWrap({ label, labelHidden, hint, error, children, className }: Wrap) {
  const id = useId()
  const help = `${id}-help`
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className={labelHidden ? 'sr-only' : 'text-sm font-semibold text-ink'}>{label}</label>
      {children({ id, describedBy: hint || error ? help : undefined })}
      {(hint || error) && (
        <p id={help} className={cn('flex items-start gap-1.5 text-sm', error ? 'text-alarm' : 'text-slate')}>
          {error && <WarningCircleIcon weight="fill" className="mt-0.5 shrink-0" aria-hidden />}
          <span>{error ?? hint}</span>
        </p>
      )}
    </div>
  )
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label: string; labelHidden?: boolean; hint?: string; error?: string | null; trailing?: ReactNode }

export function TextField({ label, labelHidden, hint, error, className, trailing, ...input }: InputProps) {
  return (
    <FieldWrap label={label} labelHidden={labelHidden} hint={hint} error={error} className={className}>
      {({ id, describedBy }) => (
        <div className="relative">
          <input id={id} aria-describedby={describedBy} aria-invalid={error ? true : undefined} className={cn(control, 'h-10', trailing ? 'pr-12' : null)} {...input} />
          {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
        </div>
      )}
    </FieldWrap>
  )
}

export function PasswordField(props: Omit<InputProps, 'type' | 'trailing'>) {
  const { t } = useTranslation()
  const [shown, setShown] = useState(false)
  return (
    <TextField {...props} type={shown ? 'text' : 'password'} trailing={
      <button type="button" onClick={() => setShown((value) => !value)} aria-label={t(shown ? 'common.hidePassword' : 'common.showPassword')} aria-pressed={shown}
        className="grid size-9 place-items-center rounded-control text-lg text-slate hover:bg-tide hover:text-ink">
        {shown ? <EyeSlashIcon aria-hidden /> : <EyeIcon aria-hidden />}
      </button>
    } />
  )
}

type AreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string; error?: string | null }

export function TextArea({ label, hint, error, className, rows = 4, ...area }: AreaProps) {
  return (
    <FieldWrap label={label} hint={hint} error={error} className={className}>
      {({ id, describedBy }) => <textarea id={id} rows={rows} aria-describedby={describedBy} aria-invalid={error ? true : undefined} className={cn(control, 'py-2.5')} {...area} />}
    </FieldWrap>
  )
}

type SelectProps = {
  label: string
  value: string
  onChange: (value: string) => void
  options: ReadonlyArray<{ value: string; label: string }>
  placeholder?: string
  hint?: string
  error?: string | null
  disabled?: boolean
  className?: string
}

export function SelectField({ label, value, onChange, options, placeholder, hint, error, disabled, className }: SelectProps) {
  return (
    <FieldWrap label={label} hint={hint} error={error} className={className}>
      {({ id, describedBy }) => (
        <RadixSelect.Root value={value} onValueChange={onChange} disabled={disabled}>
          <RadixSelect.Trigger id={id} aria-describedby={describedBy} aria-invalid={error ? true : undefined} className={cn(control, 'flex h-10 items-center justify-between gap-2 text-left')}>
            <RadixSelect.Value placeholder={placeholder} />
            <RadixSelect.Icon><CaretDownIcon aria-hidden /></RadixSelect.Icon>
          </RadixSelect.Trigger>
          <RadixSelect.Portal>
            <RadixSelect.Content position="popper" sideOffset={6} className="z-50 min-w-(--radix-select-trigger-width) overflow-hidden rounded-control border border-line bg-paper shadow-float">
              <RadixSelect.Viewport className="p-1">
                {options.map((option) => (
                  <RadixSelect.Item key={option.value} value={option.value} className="flex min-h-9 cursor-pointer items-center justify-between gap-3 rounded-md px-3 text-sm outline-none data-highlighted:bg-tide">
                    <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                    <RadixSelect.ItemIndicator><CheckIcon weight="bold" className="text-lagoon" aria-hidden /></RadixSelect.ItemIndicator>
                  </RadixSelect.Item>
                ))}
              </RadixSelect.Viewport>
            </RadixSelect.Content>
          </RadixSelect.Portal>
        </RadixSelect.Root>
      )}
    </FieldWrap>
  )
}
