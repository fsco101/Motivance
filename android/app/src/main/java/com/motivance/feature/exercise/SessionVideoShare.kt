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
import kotlinx.coroutines.launch
import java.time.OffsetDateTime

/** The calendar day a shared video leaves the server. */
internal fun sharedUntil(video:SharedVideo)=runCatching {displayDate(OffsetDateTime.parse(video.expiresAt).toLocalDate().toString())}.getOrDefault(video.expiresAt.take(10))

/**
 * Under a session's video, for the patient (#129): whether the therapist can see it, and the one way to change that. Sharing asks
 * first, and says what happens: a smaller copy, 15 days, then gone from the server, while the phone keeps its own.
 */
@Composable fun VideoShareControls(shared:SharedVideo?,sending:Boolean,progress:Float?,onShare:(()->Unit)?,onStop:(()->Unit)?) {
    var asking by remember {mutableStateOf(false)}
    var stopping by remember {mutableStateOf(false)}
    when {
        shared!=null -> {
            Text(stringResource(R.string.video_shared_until,sharedUntil(shared)),style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.primary)
            if(onStop!=null) TextButton({stopping=true},Modifier.fillMaxWidth().heightIn(min=48.dp)) {Text(stringResource(R.string.video_stop_sharing))}
        }
        sending -> Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
            CircularProgressIndicator(Modifier.size(24.dp),strokeWidth=3.dp)
            Text(stringResource(R.string.video_sharing_progress,((progress ?: 0f)*100).toInt()),style=MaterialTheme.typography.bodyMedium)
        }
        onShare!=null -> OutlinedButton({asking=true},Modifier.fillMaxWidth().heightIn(min=48.dp),shape=MaterialTheme.shapes.medium) {Text(stringResource(R.string.video_share))}
    }
    if(asking && onShare!=null) AlertDialog({asking=false},title={Text(stringResource(R.string.video_share_title))},text={Text(stringResource(R.string.video_share_detail))},
        confirmButton={TextButton({asking=false; onShare()}) {Text(stringResource(R.string.video_share_confirm))}},
        dismissButton={TextButton({asking=false}) {Text(stringResource(R.string.cancel_action))}})
    if(stopping && onStop!=null) AlertDialog({stopping=false},title={Text(stringResource(R.string.video_stop_title))},text={Text(stringResource(R.string.video_stop_detail))},
        confirmButton={TextButton({stopping=false; onStop()}) {Text(stringResource(R.string.video_stop_sharing),color=MaterialTheme.colorScheme.error)}},
        dismissButton={TextButton({stopping=false}) {Text(stringResource(R.string.cancel_action))}})
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
