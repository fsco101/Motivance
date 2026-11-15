import { ImageBrokenIcon, PlayIcon } from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog } from '@/components/Dialog'
import { Skeleton } from '@/components/Display'
import { attachmentOf, expired, LINK_SECONDS, type ChatMessage } from '@/data/chat'
import { cn } from '@/lib/cn'

/** Links are re-made a minute before they run out, so an open conversation never shows a broken picture. */
const LINK_FRESH_MS = (LINK_SECONDS - 60) * 1000

const seconds = (ms: number | null) => (ms === null ? '' : `0:${String(Math.round(ms / 1000)).padStart(2, '0')}`)

function useLink(path: string | null, link: (path: string) => Promise<string>) {
  return useQuery({ queryKey: ['chat', 'link', path], enabled: Boolean(path), staleTime: LINK_FRESH_MS, gcTime: LINK_FRESH_MS, retry: 1, queryFn: () => link(path!) })
}

/**
 * A photo or video in the thread: its small preview, which opens the full file. A file still on its way shows the copy on
 * this device. After 15 days the server gives no link, so the bubble says the file has expired instead of showing a gap.
 */
export function MediaBubble({ message, mine, link }: { message: ChatMessage; mine: boolean; link: (path: string) => Promise<string> }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const attachment = attachmentOf(message)
  const local = typeof message.data.local_preview === 'string' ? message.data.local_preview : null
  const kind = attachment?.kind ?? (message.data.attachment_kind === 'video' ? 'video' : 'image')
  const gone = attachment !== null && expired(attachment)
  const preview = useLink(attachment && !gone && !local ? attachment.previewPath : null, link)
  const full = useLink(open && attachment && !gone ? attachment.mediaPath : null, link)
  const name = t(kind === 'video' ? 'chat.media.video' : 'chat.media.photo')
  const frame = cn('block overflow-clip rounded-card border', mine ? 'border-lagoon-deep' : 'border-line')

  if (gone || preview.isError) {
    return (
      <p className={cn('flex items-center gap-2 rounded-card border border-dashed border-line-strong px-3.5 py-2 text-sm text-slate')}>
        <ImageBrokenIcon aria-hidden className="text-lg" />{t(gone ? (kind === 'video' ? 'chat.media.videoExpired' : 'chat.media.photoExpired') : 'chat.media.unavailable')}
      </p>
    )
  }
  const width = attachment ? Math.min(260, attachment.width) : 200
  const height = attachment ? Math.round((width * attachment.height) / attachment.width) : 150
  const source = local ?? preview.data
  return (
    <>
      <button type="button" disabled={!attachment} onClick={() => setOpen(true)} aria-label={kind === 'video' && attachment ? `${t('chat.media.open', { kind: name })} ${seconds(attachment.durationMs)}` : t('chat.media.open', { kind: name })}
        className={cn(frame, 'relative bg-mist disabled:cursor-default')} style={{ width, maxWidth: '100%', aspectRatio: `${width} / ${height}` }}>
        {source ? <img src={source} alt="" className="size-full object-cover" /> : <Skeleton className="size-full rounded-none" />}
        {kind === 'video' && (
          <span aria-hidden className="absolute inset-0 grid place-items-center">
            <span className="grid size-11 place-items-center rounded-full bg-night/70 text-paper"><PlayIcon weight="fill" className="text-xl" /></span>
            {attachment && <span className="numeric absolute bottom-1.5 right-1.5 rounded bg-night/70 px-1.5 text-xs text-paper">{seconds(attachment.durationMs)}</span>}
          </span>
        )}
      </button>
      {attachment && (
        <Dialog open={open} onOpenChange={setOpen} title={name} description={t('chat.media.expires')} wide>
          {full.data
            ? kind === 'video'
              ? <video src={full.data} poster={preview.data} controls autoPlay playsInline className="max-h-[70dvh] w-full rounded-control bg-night" />
              : <img src={full.data} alt={t('chat.media.photoAlt')} className="max-h-[70dvh] w-full rounded-control object-contain" />
            : full.isError ? <p className="text-slate">{t('chat.media.unavailable')}</p> : <Skeleton className="aspect-video w-full" />}
        </Dialog>
      )}
    </>
  )
}
