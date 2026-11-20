import { DownloadSimpleIcon, ShareNetworkIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBlocker } from 'react-router'
import { Button } from '@/components/Button'
import { ConfirmDialog, Dialog } from '@/components/Dialog'
import { Notice, Panel } from '@/components/Display'
import { supabase } from '@/data/client'
import { stopSharingVideo, type SessionVideo } from '@/data/sessionVideos'
import { useFormat } from '@/features/shared'
import type { SessionState } from '../session/controller'
import { recordVideoConsent, shareRefusalKey, videoConsented, videoFileName } from './plan'
import { prepareForSharing, shareDraft } from './prepare'
import { recordingSupport, SessionRecorder, type RecordedVideo, type RecordingSupport } from './recorder'

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

/** The recording's own agreement, apart from movement summaries, asked the first time recording is turned on. */
export function RecordConsentDialog({ open, onDecline, onAccept }: { open: boolean; onDecline: () => void; onAccept: () => void }) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onDecline() }} title={t('recording.consentTitle')}>
      <ul className="flex list-disc flex-col gap-2 pl-5">
        {[1, 2, 3, 4, 5].map((n) => <li key={n}>{t(`recording.consentPoint${n}`)}</li>)}
      </ul>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onDecline}>{t('recording.consentDecline')}</Button>
        <Button onClick={onAccept}>{t('recording.consentAccept')}</Button>
      </div>
    </Dialog>
  )
}

/** Turns recording on, asking for the agreement first if this account has not given it in this browser. */
export function useRecordChoice(owner: string) {
  const [record, setRecord] = useState(false)
  const [asking, setAsking] = useState(false)
  const change = (on: boolean) => {
    if (!on) setRecord(false)
    else if (videoConsented(owner)) setRecord(true)
    else setAsking(true)
  }
  const accept = () => { recordVideoConsent(owner, Date.now()); setAsking(false); setRecord(true) }
  return { record, change, asking, accept, decline: () => setAsking(false) }
}

type ShareStage = { kind: 'idle' } | { kind: 'sending'; progress: number } | { kind: 'shared'; video: SessionVideo } | { kind: 'stopped' }

/**
 * The finished run's video, kept only in this tab (owner's decision for #139): watch it, download it, or let the therapist see a
 * smaller copy for 15 days. If the patient does neither, the page asks before they leave, because the video goes with the tab.
 */
export function SessionVideoPanel({ video, saved }: { video: RecordedVideo; saved: boolean }) {
  const { t } = useTranslation()
  const format = useFormat()
  const [downloaded, setDownloaded] = useState(false)
  const [stage, setStage] = useState<ShareStage>({ kind: 'idle' })
  const [asking, setAsking] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const kept = downloaded || stage.kind === 'shared'
  const leaving = useRef(false)

  useEffect(() => {
    if (kept) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [kept])
  const blocker = useBlocker(({ currentLocation, nextLocation }) => !kept && currentLocation.pathname !== nextLocation.pathname)

  const share = async () => {
    const session = video.sessions[0]
    if (!session || stage.kind === 'sending') return
    setError(null)
    setStage({ kind: 'sending', progress: 0 })
    try {
      const draft = await prepareForSharing(video, (share) => setStage({ kind: 'sending', progress: share * 0.8 }))
      const shared = await shareDraft(supabase(), crypto.randomUUID(), session, draft, (share) => setStage({ kind: 'sending', progress: share }))
      setStage({ kind: 'shared', video: shared })
    } catch (failure) {
      setStage({ kind: 'idle' })
      setError(t(shareRefusalKey(failure)))
    }
  }
  const stop = async () => {
    if (stage.kind !== 'shared') return
    try {
      await stopSharingVideo(supabase(), stage.video.id)
      setStage({ kind: 'stopped' })
    } catch (failure) { setError(t(shareRefusalKey(failure))) }
  }

  return (
    <Panel title={t('recording.title')}>
      <div className="flex flex-col gap-3">
        {/* No captions: the video is the camera picture with the measurement drawn on it, and has no speech. */}
        <video src={video.url} controls playsInline aria-label={t('recording.title')} className="max-h-[60dvh] w-full rounded-control bg-night" />
        {!kept && <p className="text-sm text-slate">{t('recording.tabOnly')}</p>}
        <div className="flex flex-wrap gap-3">
          <a href={video.url} download={videoFileName(video.at)} onClick={() => setDownloaded(true)}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-control border border-line-strong bg-paper px-6 font-semibold text-ink transition-colors hover:border-lagoon hover:bg-mist">
            <DownloadSimpleIcon aria-hidden /> {t('recording.download')}
          </a>
          {stage.kind === 'idle' && (
            <Button size="lg" leading={<ShareNetworkIcon aria-hidden />} disabled={!saved} onClick={() => setAsking(true)}>{t('recording.share')}</Button>
          )}
        </div>
        {downloaded && <p role="status" className="text-sm text-slate">{t('recording.downloaded')}</p>}
        {stage.kind === 'idle' && !saved && <p className="text-sm text-slate">{t('recording.waitForSave')}</p>}
        {stage.kind === 'sending' && (
          <div role="status" className="flex flex-col gap-2">
            <p>{t('recording.sharing', { percent: Math.floor(stage.progress * 100) })}</p>
            <div aria-hidden className="h-1.5 w-full overflow-hidden rounded-full bg-tide"><div className="h-full bg-lagoon" style={{ width: `${stage.progress * 100}%` }} /></div>
          </div>
        )}
        {stage.kind === 'shared' && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p role="status" className="font-semibold text-sprout-deep">{t('recording.sharedUntil', { date: format.date(stage.video.expiresAt) })}</p>
            <Button variant="secondary" onClick={() => setStopping(true)}>{t('recording.stop')}</Button>
          </div>
        )}
        {stage.kind === 'stopped' && <p role="status" className="text-sm text-slate">{t('recording.stopped')}</p>}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
      <ConfirmDialog open={asking} onOpenChange={setAsking} title={t('recording.shareTitle')} message={t('recording.shareDetail')}
        confirmLabel={t('recording.shareConfirm')} onConfirm={() => void share()} />
      <ConfirmDialog open={stopping} onOpenChange={setStopping} title={t('recording.stopTitle')} message={t('recording.stopDetail')}
        confirmLabel={t('recording.stop')} destructive onConfirm={() => void stop()} />
      {/* Confirming also closes the dialog, which must not cancel the navigation it just allowed. */}
      <ConfirmDialog open={blocker.state === 'blocked'} onOpenChange={(open) => { if (!open && !leaving.current && blocker.state === 'blocked') blocker.reset() }}
        title={t('recording.leaveTitle')} message={t('recording.leaveDetail')} confirmLabel={t('recording.leave')} cancelLabel={t('recording.stay')} destructive
        onConfirm={() => { if (blocker.state === 'blocked') { leaving.current = true; blocker.proceed() } }} />
    </Panel>
  )
}
