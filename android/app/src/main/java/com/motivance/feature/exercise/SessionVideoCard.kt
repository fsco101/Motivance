package com.motivance.feature.exercise

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.motivance.R
import com.motivance.designsystem.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The session's recording on its result: watch it in the phone's player, send it in chat, or delete it from the gallery.
 * Shown only when the patient turned recording on.
 */
/** [extra] goes under the actions: for a signed-in patient, sharing with the therapist (#129). */
@Composable fun SessionVideoCard(video:SessionVideo?,saving:Boolean,send:((SessionVideo)->Unit)?,gone:(String)->Unit,extra:@Composable ColumnScope.()->Unit={}) {
    if(video==null && !saving) return
    val context=LocalContext.current
    val toaster=LocalToaster.current
    val scope=rememberCoroutineScope()
    var confirming by remember {mutableStateOf(false)}
    // A video from before a reinstall belongs to the gallery, not to this app, so the phone asks the patient first.
    val permission=rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) {
        if(it.resultCode==Activity.RESULT_OK) video?.let {v -> gone(v.uri)}
    }
    ClinicalCard {
        Text(stringResource(R.string.video_title),style=MaterialTheme.typography.titleLarge,modifier=Modifier.semantics {heading()})
        if(video==null) {LoadingNotice(R.string.video_saving); return@ClinicalCard}
        Text(stringResource(R.string.video_in_gallery),style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
        ActionButton(R.string.video_watch,{
            try {context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(video.uri),"video/mp4").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))}
            catch(_:ActivityNotFoundException) {toaster.show(R.string.video_open_failed,ToastTone.ERROR)}
        })
        send?.let {ActionButton(R.string.video_send,{it(video)},outlined=true)}
        extra()
        TextButton({confirming=true},Modifier.fillMaxWidth().heightIn(min=48.dp)) {Text(stringResource(R.string.video_delete),color=MaterialTheme.colorScheme.error)}
    }
    if(confirming && video!=null) AlertDialog({confirming=false},title={Text(stringResource(R.string.video_delete_title))},
        text={Text(stringResource(R.string.video_delete_detail))},
        confirmButton={TextButton({
            confirming=false
            scope.launch {
                val uri=Uri.parse(video.uri)
                try {
                    withContext(Dispatchers.IO) {GalleryVideos.delete(context,uri)}
                    gone(video.uri)
                } catch(_:SecurityException) {
                    if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.R)
                        permission.launch(IntentSenderRequest.Builder(MediaStore.createDeleteRequest(context.contentResolver,listOf(uri)).intentSender).build())
                    else toaster.show(R.string.video_save_failed,ToastTone.ERROR)
                }
            }
        }) {Text(stringResource(R.string.video_delete),color=MaterialTheme.colorScheme.error)}},
        dismissButton={TextButton({confirming=false}) {Text(stringResource(R.string.video_keep))}})
}
