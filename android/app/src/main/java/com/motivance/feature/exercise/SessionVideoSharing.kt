package com.motivance.feature.exercise

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.motivance.R
import com.motivance.data.local.ChatMediaStore
import com.motivance.data.local.MediaProblem
import com.motivance.data.sync.QueuedVideo
import com.motivance.data.sync.VideoQueueEvents
import com.motivance.data.sync.VideoQueueService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import com.motivance.designsystem.ToastTone
import com.motivance.designsystem.Toaster
import com.motivance.domain.RemoteFailure
import com.motivance.domain.isOffline
import com.motivance.domain.SessionVideoRepository
import com.motivance.domain.SharedVideo
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.File
import java.util.UUID
import javax.inject.Inject

/**
 * What is shared for one patient, keyed by session; the one video whose smaller copy is being made, with how far it has got; and
 * the videos waiting in the upload queue (#175).
 */
data class VideoSharingState(val shared:Map<String,SharedVideo> = emptyMap(),val sending:String?=null,val progress:Float?=null,val queue:List<QueuedVideo> = emptyList())

/**
 * "Ask to record" is offered only where it can reach the patient and is needed: an open conversation they agreed to messages in,
 * and no video ever shared. The same rule as the web's canAskToRecord (#175).
 */
fun canAskToRecord(conversation:com.motivance.domain.Conversation?,everShared:Boolean?)=
    conversation!=null && conversation.open && conversation.consented && everShared==false

/** A queued video's refusal, in the patient's words. */
internal fun queueRefusal(code:String?)=when(code) {
    "video_session_missing" -> R.string.video_share_error_uploading
    "video_unavailable" -> R.string.video_share_error_no_therapist
    "video_already_shared" -> R.string.video_share_error_already
    "video_too_large" -> R.string.video_share_error_too_large
    "video_rate_limited" -> R.string.video_share_error_rate
    else -> R.string.connected_failed
}

/** The refusals the server names, in the patient's words. Anything else is a plain failure. */
internal fun videoRefusal(e:Exception)=when((e as? RemoteFailure)?.code) {
    "video_session_missing" -> R.string.video_share_error_uploading
    "video_unavailable" -> R.string.video_share_error_no_therapist
    "video_already_shared" -> R.string.video_share_error_already
    "video_too_large" -> R.string.video_share_error_too_large
    "video_rate_limited" -> R.string.video_share_error_rate
    else -> when {e is MediaProblem -> R.string.video_share_error_prepare; e.isOffline() -> R.string.offline_action; else -> R.string.connected_failed}
}

/**
 * Sharing a session video with the therapist (#129), and watching shared ones. Nothing leaves the phone until the patient chooses to
 * share one video, and then only a smaller copy: 480p and the first five minutes. The phone's own copy is never touched.
 */
@HiltViewModel class SessionVideoViewModel @Inject constructor(
    private val repository:SessionVideoRepository,private val media:ChatMediaStore,private val toasts:Toaster,
    private val uploads:VideoQueueService,
):ViewModel() {
    private val mutable=MutableStateFlow(VideoSharingState())
    val state=mutable.asStateFlow()
    private var watching:String?=null

    /** Follows this patient's upload queue, and adds each video to what is shared once it has gone up. */
    fun watchQueue(owner:String) {
        if(watching==owner || owner.isBlank()) return
        watching=owner
        viewModelScope.launch {VideoQueueEvents.changed.collect {val list=withContext(Dispatchers.IO) {uploads.list(owner)}; mutable.update {it.copy(queue=list)}}}
        viewModelScope.launch {VideoQueueEvents.shared.collect {video -> mutable.update {it.copy(shared=it.shared+(video.sessionId to video))}}}
        uploads.schedule(owner)
    }

    /**
     * Upload (#175): the smaller copy is made now, from the gallery video, and kept in the app's files; then it waits in the queue
     * and goes up by itself once there is a connection and the session's result has uploaded.
     */
    fun upload(owner:String,video:SessionVideo) {
        val session=video.sessions.firstOrNull() ?: return
        if(mutable.value.sending!=null || mutable.value.queue.any {it.sessionId==session}) return
        mutable.update {it.copy(sending=video.uri,progress=0f)}
        viewModelScope.launch {
            try {
                val draft=media.prepareSessionVideo(owner,video.uri) {share -> mutable.update {it.copy(progress=share)}}
                val id=UUID.randomUUID().toString()
                val folder=uploads.folder(owner)
                val file=File(folder,"$id.mp4"); val preview=File(folder,"$id.jpg")
                withContext(Dispatchers.IO) {
                    if(!File(draft.file).renameTo(file)) {File(draft.file).copyTo(file,true); File(draft.file).delete()}
                    if(!File(draft.preview).renameTo(preview)) {File(draft.preview).copyTo(preview,true); File(draft.preview).delete()}
                    uploads.enqueue(QueuedVideo(id,owner,session,file.path,preview.path,draft.width,draft.height,draft.durationMs ?: 1))
                }
                watchQueue(owner)
                uploads.schedule(owner)
            } catch(e:CancellationException) {throw e}
            catch(e:Exception) {toasts.show(videoRefusal(e),ToastTone.ERROR)}
            finally {mutable.update {it.copy(sending=null,progress=null)}}
        }
    }

    fun cancelUpload(owner:String,id:String) {viewModelScope.launch(Dispatchers.IO) {uploads.cancel(owner,id)}}
    fun retryUpload(owner:String,id:String) {viewModelScope.launch(Dispatchers.IO) {uploads.retry(owner,id); uploads.schedule(owner)}}

    /** The patient's own shares, or, for a therapist, the patient's videos shared with them. Quiet when it fails: watching is extra. */
    fun load(patientId:String) {
        viewModelScope.launch {
            try {
                val videos=repository.loadSharedVideos(patientId)
                mutable.update {it.copy(shared=it.shared.filterValues {v -> v.patientId!=patientId}+videos.associateBy(SharedVideo::sessionId))}
            } catch(e:CancellationException) {throw e} catch(_:Exception) {}
        }
    }

    fun stop(shared:SharedVideo) {
        viewModelScope.launch {
            try {
                repository.stopSharingVideo(shared.id)
                mutable.update {it.copy(shared=it.shared-shared.sessionId)}
                toasts.show(R.string.video_share_stopped)
            } catch(e:CancellationException) {throw e}
            catch(e:Exception) {if(e.isOffline()) toasts.show(R.string.offline_action,ToastTone.INFO) else toasts.show(R.string.connected_failed,ToastTone.ERROR)}
        }
    }

    /** Whether the patient ever shared a video with this therapist, or null when it cannot be read: then nothing is offered. */
    suspend fun everShared(patientId:String):Boolean?=try {repository.everSharedVideo(patientId)} catch(e:CancellationException) {throw e} catch(_:Exception) {null}

    /** A short-lived link to watch a shared video, or null when it cannot be had. */
    suspend fun link(shared:SharedVideo):String?=try {repository.sessionVideoLink(shared.mediaPath)} catch(e:CancellationException) {throw e} catch(_:Exception) {null}
}
