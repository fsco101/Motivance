import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { ConfirmDialog, Dialog } from '@/components/Dialog'
import { Notice, Skeleton } from '@/components/Display'
import { toast } from '@/components/Toast'
import { supabase } from '@/data/client'
import { failureKey } from '@/data/errors'
import { loadSessionVideos, stopSharingVideo, videoLink, type SessionVideo } from '@/data/sessionVideos'
import { useFormat } from '@/features/shared'

/** Plays one shared video from a short-lived link. A patient watching their own can also stop sharing it. */
function VideoPlayer({ video, self, onStop }: { video: SessionVideo; self: boolean; onStop: () => void }) {
  const { t } = useTranslation()
  const format = useFormat()
  const links = useQuery({
    queryKey: ['session-video', video.id],
    queryFn: async () => ({ media: await videoLink(supabase(), video.mediaPath), poster: await videoLink(supabase(), video.previewPath).catch(() => undefined) }),
    staleTime: 240_000,
  })
  const until = format.date(video.expiresAt)
  return (
    <div className="flex flex-col gap-4">
      {links.isError ? <Notice onRetry={() => void links.refetch()}>{t('video.loadFailed')}</Notice>
        : links.data ? (
          // No captions: a session video is the camera picture with the measurement drawn on it, and has no speech.
          <video src={links.data.media} poster={links.data.poster} controls playsInline className="max-h-[60dvh] w-full rounded-control bg-night" aria-label={t('video.title')} />
        ) : <Skeleton className="aspect-video w-full rounded-control" />}
      <p className="text-sm text-slate">{t(self ? 'video.selfNote' : 'video.therapistNote', { date: until })}</p>
      {self && <div className="flex justify-end"><Button variant="secondary" onClick={onStop}>{t('video.stop')}</Button></div>}
    </div>
  )
}

/**
 * The videos shared for one patient's sessions, a way to watch each, and for the patient a way to stop sharing (#129). Only the
 * patient and the exercise's therapist ever get rows back, so for anyone else this quietly offers nothing.
 */
export function useSessionVideos(patientId: string, self: boolean) {
  const { t } = useTranslation()
  const queries = useQueryClient()
  const videos = useQuery({ queryKey: ['session-videos', patientId], enabled: Boolean(patientId), queryFn: () => loadSessionVideos(supabase(), patientId) })
  const bySession = useMemo(() => new Map((videos.data ?? []).map((video) => [video.sessionId, video])), [videos.data])
  const [watching, setWatching] = useState<SessionVideo | null>(null)
  const [stopping, setStopping] = useState<SessionVideo | null>(null)
  const stop = useMutation({
    mutationFn: (video: SessionVideo) => stopSharingVideo(supabase(), video.id),
    onSuccess: async () => {
      setWatching(null)
      await queries.invalidateQueries({ queryKey: ['session-videos', patientId] })
      toast.show(t('video.stopped'))
    },
    onError: (failure) => toast.show(t(failureKey(failure)), 'error'),
  })
  return {
    videoFor: (sessionId: string) => bySession.get(sessionId),
    onWatch: (video: SessionVideo) => setWatching(video),
    dialog: (
      <>
        <Dialog open={watching !== null} onOpenChange={(open) => { if (!open) setWatching(null) }} title={t('video.title')} wide>
          {watching && <VideoPlayer video={watching} self={self} onStop={() => setStopping(watching)} />}
        </Dialog>
        <ConfirmDialog open={stopping !== null} onOpenChange={(open) => { if (!open) setStopping(null) }} title={t('video.stopTitle')} message={t('video.stopMessage')}
          confirmLabel={t('video.stop')} destructive onConfirm={() => { if (stopping) stop.mutate(stopping) }} />
      </>
    ),
  }
}
