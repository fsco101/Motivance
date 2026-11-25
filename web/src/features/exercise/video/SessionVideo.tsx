import { CloudArrowUpIcon, DownloadSimpleIcon, ShareNetworkIcon } from '@phosphor-icons/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBlocker } from 'react-router'
import { Button } from '@/components/Button'
import { ConfirmDialog, Dialog } from '@/components/Dialog'
import { Notice, Panel } from '@/components/Display'
import { supabase } from '@/data/client'
import { stopSharingVideo, type SessionVideo } from '@/data/sessionVideos'
import { useFormat } from '@/features/shared'
import '@/locales/exercise'
import type { SessionState } from '../session/controller'
import { shareRefusalKey, videoFileName } from './plan'
import { prepareForSharing } from './prepare'
import { accepted, declined, neverAsk, readPrompt, shouldAsk, unrecorded, writePrompt, type RecordPrompt } from './prompt'
import { recordingSupport, SessionRecorder, type RecordedVideo, type RecordingSupport } from './recorder'
import type { QueuedVideo } from './uploadQueue'
import { useVideoQueue } from './useVideoQueue'

/** Whether this browser can record, found once when the camera opens. Undefined while checking. */
export function useRecordingSupport() {
  const [support, setSupport] = useState<RecordingSupport | undefined>(undefined)
  useEffect(() => {
    let current = true
    void recordingSupport().then((found) => { if (current) setSupport(found) }, () => { if (current) setSupport(null) })
    return () => { current = false }
  }, [])
  return support
}

/**
 * The run's recording (SessionRecorder on Android, #114). It begins with the session, so opening the camera records nothing.
 * Each side of a set joins the same video, and the video is finished when the run ends. The recorder is handed to the frame
 * loop through `recorder`, so drawing a frame never waits for React.
 */
export function useSessionRecording(state: SessionState, record: boolean, support: RecordingSupport | undefined, camera: { width: number; height: number } | null) {
  const recorder = useRef<SessionRecorder | null>(null)
  const [live, setLive] = useState(false)
  const [video, setVideo] = useState<RecordedVideo | null>(null)
  const [finishing, setFinishing] = useState(false)
  const [failed, setFailed] = useState(false)
  const done = state.phase === 'done'
  const { sessionId } = state

  useEffect(() => {
    if (!record || !support || !camera || !sessionId || done) return
    if (recorder.current) { recorder.current.join(sessionId); return }
    const next = new SessionRecorder(support, camera.width, camera.height)
    next.join(sessionId)
    recorder.current = next
    next.start().then(() => setLive(true), () => { if (recorder.current === next) recorder.current = null; setFailed(true) })
  }, [record, support, camera, sessionId, done])

  useEffect(() => {
    const active = recorder.current
    if (!done || !active) return
    recorder.current = null
    setLive(false)
    setFinishing(true)
    active.finish().then((made) => setVideo(made), () => setFailed(true)).finally(() => setFinishing(false))
  }, [done])

  // Leaving the page mid-run drops the unfinished recording; a finished one is let go with the tab.
  useEffect(() => () => { recorder.current?.cancel(); recorder.current = null }, [])
  useEffect(() => () => { if (video) URL.revokeObjectURL(video.url) }, [video])
  return { recorder, live, video, finishing, failed }
}

/**
 * The recording's own agreement, apart from movement summaries. It leads with why recording helps (#175), then what is recorded,
 * where it stays and for how long. When the app asks again after Not now, the patient can also stop it asking.
 */
export function RecordConsentDialog({ open, onDecline, onAccept, onNever }: { open: boolean; onDecline: () => void; onAccept: () => void; onNever?: () => void }) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onDecline() }} title={t('recording.consentTitle')}>
      <p className="mb-4 font-semibold">{t('recording.consentBenefit')}</p>
      <ul className="flex list-disc flex-col gap-2 pl-5">
        {[1, 2, 3, 4, 5].map((n) => <li key={n}>{t(`recording.consentPoint${n}`)}</li>)}
      </ul>
      <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
        {onNever && <Button variant="quiet" className="mr-auto" onClick={onNever}>{t('recording.neverAsk')}</Button>}
        <Button variant="secondary" onClick={onDecline}>{t('recording.consentDecline')}</Button>
        <Button onClick={onAccept}>{t('recording.consentAccept')}</Button>
      </div>
    </Dialog>
  )
}

/**
 * Whether this session records (#175). Once the patient agrees, every prescribed session starts recorded and the switch turns it
 * off for this one. A patient who has not agreed is asked when the session opens, by the rules in prompt.ts; turning the switch
 * on asks too, but Not now there is their own choice and does not count as one of the times the app asked.
 */
export function useRecordChoice(owner: string, canRecord: boolean) {
  const [prompt, setPrompt] = useState(() => readPrompt(owner))
  const [record, setRecord] = useState(() => prompt.agreed)
  // Asked at most once when the page opens, by what was stored then; answering ends it.
  const [opened] = useState(() => ({ prompt, at: Date.now() }))
  const [answered, setAnswered] = useState(false)
  const [switchAsking, setSwitchAsking] = useState(false)
  const appAsking = canRecord && !answered && shouldAsk(opened.prompt, opened.at)
  const save = (next: RecordPrompt) => { writePrompt(owner, next); setPrompt(next) }
  const change = (on: boolean) => {
    if (!on) setRecord(false)
    else if (prompt.agreed) setRecord(true)
    else setSwitchAsking(true)
  }
  const accept = () => { save(accepted(prompt)); setAnswered(true); setSwitchAsking(false); setRecord(true) }
  const decline = () => { if (appAsking) save(declined(prompt, Date.now())); setAnswered(true); setSwitchAsking(false) }
  const never = () => { save(neverAsk(prompt)); setAnswered(true); setSwitchAsking(false) }
  /** A prescribed session saved without recording counts toward asking again. */
  const finished = useCallback((recorded: boolean) => {
    if (recorded) return
    const next = unrecorded(readPrompt(owner))
    writePrompt(owner, next)
    setPrompt(next)
  }, [owner])
  return { record, change, asking: appAsking || switchAsking, canNever: appAsking && prompt.declines > 0, accept, decline, never, finished }
}

/** The status of one video going to the therapist (#175), on the finish screen and wherever waiting videos are listed. */
export function UploadStatus({ item, onCancel, onRetry }: { item: QueuedVideo; onCancel: () => void; onRetry: () => void }) {
  const { t } = useTranslation()
  if (item.state === 'uploading') return (
    <div role="status" className="flex flex-col gap-2">
      <p className="font-semibold">{t('recording.status.uploading', { percent: Math.floor(item.progress * 100) })}</p>
      <div aria-hidden className="h-1.5 w-full overflow-hidden rounded-full bg-tide"><div className="h-full bg-lagoon transition-[width]" style={{ width: `${item.progress * 100}%` }} /></div>
    </div>
  )
  if (item.state === 'failed') return (
    <div className="flex flex-col gap-2">
      <Notice tone="error" title={t('recording.status.failed', { reason: t(shareRefusalKey(new Error(item.reason ?? ''))) })}>{t('recording.status.failedDetail')}</Notice>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onRetry}>{t('recording.tryAgain')}</Button>
        <Button size="sm" variant="secondary" onClick={onCancel}>{t('recording.remove')}</Button>
      </div>
    </div>
  )
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div role="status">
        <p className="font-semibold">{t('recording.status.waiting')}</p>
        <p className="text-sm text-slate">{t('recording.status.waitingDetail')}</p>
      </div>
      <Button size="sm" variant="secondary" onClick={onCancel}>{t('recording.cancelUpload')}</Button>
    </div>
  )
}

/** Videos still waiting to go up, on the patient's pages after a reload or a closed tab. Nothing shows when there are none. */
export function WaitingVideos({ owner }: { owner: string }) {
  const { t } = useTranslation()
  const format = useFormat()
  const queue = useVideoQueue(owner)
  if (queue.items.length === 0) return null
  return (
    <Panel title={t('recording.waitingTitle')} description={t('recording.waitingDescription')} className="mb-5">
      <ul className="flex flex-col gap-4">
        {queue.items.map((item) => (
          <li key={item.id} data-testid="waiting-video" className="flex flex-col gap-2 border-b border-line pb-4 last:border-b-0 last:pb-0">
            <p className="text-sm text-slate">{t('recording.recordedOn', { when: format.dateTime(new Date(item.createdAt).toISOString()) })}</p>
            <UploadStatus item={item} onCancel={() => void queue.cancel(item.id)} onRetry={() => void queue.retry(item.id)} />
          </li>
        ))}
      </ul>
    </Panel>
  )
}

type ShareStage = { kind: 'idle' } | { kind: 'preparing'; progress: number } | { kind: 'shared'; video: SessionVideo } | { kind: 'stopped' }

/**
 * The finished run's video, kept only in this tab (owner's decision for #139): watch it, download it, or upload a smaller copy for
 * the therapist (#175). Once the patient chooses Upload, the copy is made and kept in this browser until it has gone up, so a lost
 * connection or a reload does not lose it. Until then, leaving the page asks first, because the video goes with the tab.
 */
export function SessionVideoPanel({ video, owner }: { video: RecordedVideo; owner: string }) {
  const { t } = useTranslation()
  const format = useFormat()
  const queue = useVideoQueue(owner)
  const session = video.sessions[0] ?? null
  const queued = queue.items.find((item) => item.sessionId === session) ?? null
  const [downloaded, setDownloaded] = useState(false)
  const [stage, setStage] = useState<ShareStage>({ kind: 'idle' })
  const [later, setLater] = useState(false)
  const [asking, setAsking] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const shared = stage.kind === 'shared' ? stage.video : (session ? queue.shared[session] ?? null : null)
  const kept = downloaded || shared !== null || queued !== null
  const leaving = useRef(false)

  useEffect(() => {
    if (kept) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [kept])
  const blocker = useBlocker(({ currentLocation, nextLocation }) => !kept && currentLocation.pathname !== nextLocation.pathname)

  // The smaller copy is made now, while the recording is here; then it waits in the queue for a connection.
  const upload = async () => {
    if (!session || stage.kind === 'preparing' || queued) return
    setError(null)
    setStage({ kind: 'preparing', progress: 0 })
    try {
      const draft = await prepareForSharing(video, (share) => setStage({ kind: 'preparing', progress: share }))
      await queue.enqueue(session, draft)
      setStage({ kind: 'idle' })
    } catch (failure) {
      setStage({ kind: 'idle' })
      setError(t(shareRefusalKey(failure)))
    }
  }
  const stop = async () => {
    if (!shared) return
    try {
      await stopSharingVideo(supabase(), shared.id)
      setStage({ kind: 'stopped' })
    } catch (failure) { setError(t(shareRefusalKey(failure))) }
  }
  const idle = stage.kind === 'idle' && !queued && !shared

  return (
    <Panel title={t('recording.title')}>
      <div className="flex flex-col gap-3">
        {idle && !later && (
          <section aria-labelledby="upload-ask" className="flex flex-col gap-3 rounded-card border border-lagoon bg-tide p-4">
            <h3 id="upload-ask" className="text-lg font-bold">{t('recording.uploadAsk')}</h3>
            <p className="text-sm">{t('recording.uploadWhat')}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="lg" leading={<CloudArrowUpIcon aria-hidden />} onClick={() => void upload()}>{t('recording.upload')}</Button>
              <Button size="lg" variant="secondary" onClick={() => setLater(true)}>{t('recording.notNow')}</Button>
            </div>
          </section>
        )}
        {/* No captions: the video is the camera picture with the measurement drawn on it, and has no speech. */}
        <video src={video.url} controls playsInline aria-label={t('recording.title')} className="max-h-[60dvh] w-full rounded-control bg-night" />
        {!kept && <p className="text-sm text-slate">{t('recording.tabOnly')}</p>}
        <div className="flex flex-wrap gap-3">
          <a href={video.url} download={videoFileName(video.at)} onClick={() => setDownloaded(true)}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-control border border-line-strong bg-paper px-6 font-semibold text-ink transition-colors hover:border-lagoon hover:bg-mist">
            <DownloadSimpleIcon aria-hidden /> {t('recording.download')}
          </a>
          {idle && later && <Button size="lg" leading={<ShareNetworkIcon aria-hidden />} onClick={() => setAsking(true)}>{t('recording.share')}</Button>}
        </div>
        {downloaded && <p role="status" className="text-sm text-slate">{t('recording.downloaded')}</p>}
        {stage.kind === 'preparing' && (
          <div role="status" className="flex flex-col gap-2">
            <p>{t('recording.preparing', { percent: Math.floor(stage.progress * 100) })}</p>
            <div aria-hidden className="h-1.5 w-full overflow-hidden rounded-full bg-tide"><div className="h-full bg-lagoon" style={{ width: `${stage.progress * 100}%` }} /></div>
          </div>
        )}
        {queued && <UploadStatus item={queued} onCancel={() => void queue.cancel(queued.id)} onRetry={() => void queue.retry(queued.id)} />}
        {shared && stage.kind !== 'stopped' && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p role="status" className="font-semibold text-sprout-deep">{t('recording.status.shared', { date: format.date(shared.expiresAt) })}</p>
            <Button variant="secondary" onClick={() => setStopping(true)}>{t('recording.stop')}</Button>
          </div>
        )}
        {stage.kind === 'stopped' && <p role="status" className="text-sm text-slate">{t('recording.stopped')}</p>}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
      <ConfirmDialog open={asking} onOpenChange={setAsking} title={t('recording.shareTitle')} message={t('recording.shareDetail')}
        confirmLabel={t('recording.shareConfirm')} onConfirm={() => void upload()} />
      <ConfirmDialog open={stopping} onOpenChange={setStopping} title={t('recording.stopTitle')} message={t('recording.stopDetail')}
        confirmLabel={t('recording.stop')} destructive onConfirm={() => void stop()} />
      {/* Confirming also closes the dialog, which must not cancel the navigation it just allowed. */}
      <ConfirmDialog open={blocker.state === 'blocked'} onOpenChange={(open) => { if (!open && !leaving.current && blocker.state === 'blocked') blocker.reset() }}
        title={t('recording.leaveTitle')} message={t('recording.leaveDetail')} confirmLabel={t('recording.leave')} cancelLabel={t('recording.stay')} destructive
        onConfirm={() => { if (blocker.state === 'blocked') { leaving.current = true; blocker.proceed() } }} />
    </Panel>
  )
}
