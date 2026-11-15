import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { Dialog } from '@/components/Dialog'
import { Notice } from '@/components/Display'
import { SelectField, TextArea } from '@/components/Field'
import { toast } from '@/components/Toast'
import { loadConversations, shareProgress, type ProgressFacts } from '@/data/chat'
import { supabase } from '@/data/client'
import { failureKey } from '@/data/errors'

/**
 * Sharing what the Progress page shows into a conversation about this patient. A therapist shares into their conversation with
 * the patient; a patient chooses which of their therapists, when there is more than one. Only open conversations are offered.
 */
export function useShareProgress(patientId: string, self: boolean) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [facts, setFacts] = useState<ProgressFacts | null>(null)
  const [chosen, setChosen] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const conversations = useQuery({ queryKey: ['chat', 'conversations'], enabled: Boolean(patientId), queryFn: () => loadConversations(supabase()) })
  const open = (conversations.data ?? []).filter((item) => item.open && (self ? item.side === 'patient' : item.otherId === patientId))
  const target = open.find((item) => item.id === chosen) ?? open[0]
  const send = (event: FormEvent) => {
    event.preventDefault()
    if (!facts || !target) return
    setBusy(true)
    void shareProgress(supabase(), crypto.randomUUID(), target.id, facts, note)
      .then(() => { toast.show(t('chat.cards.shared')); setFacts(null); setNote(''); return client.invalidateQueries({ queryKey: ['chat'] }) })
      .catch((failure: unknown) => toast.show(t(failureKey(failure)), 'error'))
      .finally(() => setBusy(false))
  }
  const dialog = (
    <Dialog open={facts !== null} onOpenChange={(next) => { if (!next) setFacts(null) }} title={t('chat.cards.shareTitle')} description={t('chat.cards.shareDetail')}>
      {open.length === 0
        ? <Notice tone="info">{t('chat.cards.noConversation')}</Notice>
        : (
          <form onSubmit={send} className="flex flex-col gap-4">
            {open.length > 1 && <SelectField label={t('chat.cards.shareTo')} value={target?.id ?? ''} onChange={setChosen} options={open.map((item) => ({ value: item.id, label: item.otherName }))} />}
            <TextArea label={t('chat.cards.note')} value={note} rows={2} maxLength={2000} onChange={(event) => setNote(event.target.value)} />
            <div><Button type="submit" busy={busy}>{t('chat.cards.send')}</Button></div>
          </form>
        )}
    </Dialog>
  )
  return { share: (next: ProgressFacts) => setFacts(next), dialog }
}
