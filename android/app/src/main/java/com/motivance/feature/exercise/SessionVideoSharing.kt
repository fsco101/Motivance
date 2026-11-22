package com.motivance.feature.exercise

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.motivance.R
import com.motivance.data.local.ChatMediaStore
import com.motivance.data.local.MediaProblem
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

/** What is shared for one patient, keyed by session, and the one video being prepared and sent, with how far it has got. */
data class VideoSharingState(val shared:Map<String,SharedVideo> = emptyMap(),val sending:String?=null,val progress:Float?=null)

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
):ViewModel() {
    private val mutable=MutableStateFlow(VideoSharingState())
    val state=mutable.asStateFlow()

    /** The patient's own shares, or, for a therapist, the patient's videos shared with them. Quiet when it fails: watching is extra. */
    fun load(patientId:String) {
        viewModelScope.launch {
            try {
                val videos=repository.loadSharedVideos(patientId)
                mutable.update {it.copy(shared=it.shared.filterValues {v -> v.patientId!=patientId}+videos.associateBy(SharedVideo::sessionId))}
            } catch(e:CancellationException) {throw e} catch(_:Exception) {}
        }
    }

    /** One video, attached to the run's first session: a both-sides run has one recording for both sides. */
    fun share(owner:String,video:SessionVideo) {
        val session=video.sessions.firstOrNull() ?: return
        if(mutable.value.sending!=null) return
        mutable.update {it.copy(sending=video.uri,progress=0f)}
        viewModelScope.launch {
            var files:List<String> = emptyList()
            try {
                val draft=media.prepareSessionVideo(owner,video.uri) {share -> mutable.update {it.copy(progress=share*.8f)}}
                files=listOf(draft.file,draft.preview)
                val id=UUID.randomUUID().toString()
                val places=repository.startSessionVideo(id,session,draft.width,draft.height,draft.durationMs ?: 1)
                repository.uploadSessionVideo(places.mediaPath,media.read(draft.file),draft.mime)
                mutable.update {it.copy(progress=.95f)}
                repository.uploadSessionVideo(places.previewPath,media.read(draft.preview),"image/jpeg")
                val shared=repository.shareSessionVideo(id)
                mutable.update {it.copy(shared=it.shared+(shared.sessionId to shared))}
                toasts.show(R.string.video_shared)
            } catch(e:CancellationException) {throw e}
            catch(e:Exception) {toasts.show(videoRefusal(e),ToastTone.ERROR)}
            finally {
                files.forEach {runCatching {File(it).delete()}}
                mutable.update {it.copy(sending=null,progress=null)}
            }
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

    /** A short-lived link to watch a shared video, or null when it cannot be had. */
    suspend fun link(shared:SharedVideo):String?=try {repository.sessionVideoLink(shared.mediaPath)} catch(e:CancellationException) {throw e} catch(_:Exception) {null}
}
