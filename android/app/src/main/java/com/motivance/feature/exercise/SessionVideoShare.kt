package com.motivance.feature.exercise

import androidx.core.net.toUri
import android.widget.MediaController
import android.widget.VideoView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.motivance.R
import com.motivance.designsystem.LocalToaster
import com.motivance.designsystem.Motion
import com.motivance.designsystem.ToastTone
import com.motivance.designsystem.displayDate
import com.motivance.domain.SharedVideo
import com.motivance.data.sync.QueuedVideo
import com.motivance.data.sync.VideoUploadState
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import kotlinx.coroutines.launch
import java.time.OffsetDateTime

/** The calendar day a shared video leaves the server. */
internal fun sharedUntil(video:SharedVideo)=runCatching {displayDate(OffsetDateTime.parse(video.expiresAt).toLocalDate().toString())}.getOrDefault(video.expiresAt.take(10))

/**
 * After a recorded session, on the finish screen (#175): ask to upload the video for the therapist, say in one line what happens,
 * and let the patient choose Not now, which leaves the card's own Upload button.
 */
@Composable fun UploadVideoPrompt(upload:()->Unit,later:()->Unit) {
    Surface(Modifier.fillMaxWidth().testTag("upload_prompt"),shape=MaterialTheme.shapes.large,color=MaterialTheme.colorScheme.primaryContainer) {
        Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            Text(stringResource(R.string.video_upload_ask),style=MaterialTheme.typography.titleMedium,color=MaterialTheme.colorScheme.onPrimaryContainer,
                modifier=Modifier.semantics {heading()})
            Text(stringResource(R.string.video_upload_what),style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onPrimaryContainer)
            Button(upload,Modifier.fillMaxWidth().heightIn(min=48.dp),shape=MaterialTheme.shapes.medium) {Text(stringResource(R.string.video_upload))}
            OutlinedButton(later,Modifier.fillMaxWidth().heightIn(min=48.dp),shape=MaterialTheme.shapes.medium) {Text(stringResource(R.string.video_not_now))}
        }
    }
}

/**
 * Under a session's video, for the patient (#129, #175): whether the therapist can see it, a video waiting in the upload queue and
 * how it is getting on, and the one way to change each. Sharing asks first, and says what happens: a smaller copy, 15 days, then
 * gone from the server, while the phone keeps its own.
 */
@Composable fun VideoShareControls(shared:SharedVideo?,sending:Boolean,progress:Float?,onShare:(()->Unit)?,onStop:(()->Unit)?,
    queued:QueuedVideo?=null,onCancel:(()->Unit)?=null,onRetry:(()->Unit)?=null) {
    var asking by remember {mutableStateOf(false)}
    var stopping by remember {mutableStateOf(false)}
    when {
        shared!=null -> {
            Text(stringResource(R.string.video_status_shared,sharedUntil(shared)),style=MaterialTheme.typography.bodyLarge,fontWeight=FontWeight.SemiBold,
                color=MaterialTheme.colorScheme.primary,modifier=Modifier.testTag("video_status"))
            if(onStop!=null) TextButton({stopping=true},Modifier.fillMaxWidth().heightIn(min=48.dp)) {Text(stringResource(R.string.video_stop_sharing))}
        }
        sending -> Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
            CircularProgressIndicator(Modifier.size(24.dp),strokeWidth=3.dp)
            Text(stringResource(R.string.video_preparing),style=MaterialTheme.typography.bodyMedium)
        }
        queued!=null -> UploadStatus(queued,onCancel,onRetry)
        onShare!=null -> OutlinedButton({asking=true},Modifier.fillMaxWidth().heightIn(min=48.dp),shape=MaterialTheme.shapes.medium) {Text(stringResource(R.string.video_share))}
    }
    if(asking && onShare!=null) AlertDialog({asking=false},title={Text(stringResource(R.string.video_share_title))},text={Text(stringResource(R.string.video_share_detail))},
        confirmButton={TextButton({asking=false; onShare()}) {Text(stringResource(R.string.video_share_confirm))}},
        dismissButton={TextButton({asking=false}) {Text(stringResource(R.string.cancel_action))}})
    if(stopping && onStop!=null) AlertDialog({stopping=false},title={Text(stringResource(R.string.video_stop_title))},text={Text(stringResource(R.string.video_stop_detail))},
        confirmButton={TextButton({stopping=false; onStop()}) {Text(stringResource(R.string.video_stop_sharing),color=MaterialTheme.colorScheme.error)}},
        dismissButton={TextButton({stopping=false}) {Text(stringResource(R.string.cancel_action))}})
}

/** Waiting to upload, Uploading with its progress, or Couldn't upload with the reason and Try again (#175). */
@Composable internal fun UploadStatus(video:QueuedVideo,onCancel:(()->Unit)?,onRetry:(()->Unit)?) {
    Column(Modifier.fillMaxWidth().testTag("video_status"),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        when(video.state) {
            VideoUploadState.UPLOADING -> {
                val percent=(video.progress*100).toInt()
                Text(stringResource(R.string.video_status_uploading,percent),style=MaterialTheme.typography.bodyLarge,fontWeight=FontWeight.SemiBold)
                LinearProgressIndicator({video.progress},Modifier.fillMaxWidth())
            }
            VideoUploadState.FAILED -> {
                Text(stringResource(R.string.video_status_failed,stringResource(queueRefusal(video.reason))),style=MaterialTheme.typography.bodyLarge,
                    fontWeight=FontWeight.SemiBold,color=MaterialTheme.colorScheme.error)
                Text(stringResource(R.string.video_status_failed_detail),style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
                onRetry?.let {Button(it,Modifier.fillMaxWidth().heightIn(min=48.dp),shape=MaterialTheme.shapes.medium) {Text(stringResource(R.string.video_try_again))}}
                onCancel?.let {TextButton(it,Modifier.fillMaxWidth().heightIn(min=48.dp)) {Text(stringResource(R.string.video_remove_upload))}}
            }
            VideoUploadState.WAITING -> {
                Text(stringResource(R.string.video_status_waiting),style=MaterialTheme.typography.bodyLarge,fontWeight=FontWeight.SemiBold)
                Text(stringResource(R.string.video_status_waiting_detail),style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
                onCancel?.let {OutlinedButton(it,Modifier.fillMaxWidth().heightIn(min=48.dp),shape=MaterialTheme.shapes.medium) {Text(stringResource(R.string.video_cancel_upload))}}
            }
        }
    }
}

/** Opens a shared video from a short-lived link and plays it in the app. The link is asked for only when the person taps. */
@Composable fun WatchSharedVideo(video:SharedVideo,link:suspend (SharedVideo)->String?,modifier:Modifier=Modifier) {
    val scope=rememberCoroutineScope()
    val toaster=LocalToaster.current
    var url by remember {mutableStateOf<String?>(null)}
    var opening by remember {mutableStateOf(false)}
    OutlinedButton({
        if(opening) return@OutlinedButton
        opening=true
        scope.launch {
            val found=link(video)
            opening=false
            if(found==null) toaster.show(R.string.video_link_failed,ToastTone.ERROR) else url=found
        }
    },modifier.fillMaxWidth().heightIn(min=48.dp),enabled=!opening,shape=MaterialTheme.shapes.medium) {Text(stringResource(R.string.video_watch_shared))}
    url?.let {RemoteVideoDialog(it) {url=null}}
}

/** A full-width player over a dark backdrop, with the system's play, pause and seek controls. */
@Composable internal fun RemoteVideoDialog(url:String,close:()->Unit) {
    Dialog(close,DialogProperties(usePlatformDefaultWidth=false)) {
        Box(Modifier.fillMaxSize().background(Motion.Night),contentAlignment=Alignment.Center) {
            AndroidView({context -> VideoView(context).apply {
                val controls=MediaController(context).also {it.setAnchorView(this)}
                setMediaController(controls)
                setVideoURI(url.toUri())
                setOnPreparedListener {start(); controls.show()}
            }},Modifier.fillMaxWidth(),onRelease={it.stopPlayback()})
            TextButton(close,Modifier.align(Alignment.TopEnd).padding(8.dp).heightIn(min=48.dp)) {Text(stringResource(R.string.video_close),color=Motion.SproutBright)}
        }
    }
}

/** For a therapist, on a patient who has never shared a video (#175): a short message through care chat asking them to record. */
@Composable fun AskToRecord(ask:()->Unit) {
    Column(verticalArrangement=Arrangement.spacedBy(4.dp)) {
        TextButton(ask,Modifier.fillMaxWidth().heightIn(min=48.dp).testTag("ask_to_record")) {Text(stringResource(R.string.video_ask_to_record))}
        Text(stringResource(R.string.video_ask_to_record_hint),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
