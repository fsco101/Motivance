package com.motivance.feature.chat

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.widget.MediaController
import android.widget.VideoView
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.motivance.R
import com.motivance.designsystem.LocalToaster
import com.motivance.designsystem.ToastTone
import com.motivance.domain.*
import java.io.File
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** A picture decoded no larger than it will be shown, so a 1600 px photo does not cost a full-size bitmap in a list. */
private fun decode(path:String,longSide:Int):ImageBitmap? {
    val bounds=BitmapFactory.Options().apply {inJustDecodeBounds=true}
    BitmapFactory.decodeFile(path,bounds)
    if(bounds.outWidth<=0) return null
    var sample=1
    while(maxOf(bounds.outWidth,bounds.outHeight)/(sample*2)>=longSide) sample*=2
    return BitmapFactory.decodeFile(path,BitmapFactory.Options().apply {inSampleSize=sample})?.asImageBitmap()
}

private sealed interface Copy {
    data object Loading:Copy
    data object Missing:Copy
    data class Here(val path:String):Copy
}

private fun seconds(ms:Long?)=if(ms==null) "" else "0:%02d".format((ms+500)/1000)

/**
 * A photo or video in the thread: its preview, which opens the full file. A file still on its way shows the copy on this phone.
 * The phone keeps what it has shown, so after the server removes a file on day 15 the phone still has it; a file this phone
 * never fetched says it has expired.
 */
@Composable fun MediaBubble(message:ChatMessage,mine:Boolean,waiting:MediaDraft?,copy:suspend (ChatMessage,Boolean)->String?) {
    val attachment=message.attachment
    val kind=attachment?.kind ?: waiting?.kind ?: MediaKind.IMAGE
    val width=attachment?.width ?: waiting?.width ?: 4
    val height=attachment?.height ?: waiting?.height ?: 3
    val preview by produceState<Copy>(Copy.Loading,message.id,waiting?.preview) {
        value=waiting?.preview?.let {Copy.Here(it)} ?: copy(message,true)?.let {Copy.Here(it)} ?: Copy.Missing
    }
    val picture by produceState<ImageBitmap?>(null,preview) {value=(preview as? Copy.Here)?.let {withContext(Dispatchers.IO) {decode(it.path,600)}}}
    var open by remember {mutableStateOf(false)}
    val name=stringResource(if(kind==MediaKind.VIDEO) R.string.chat_media_video else R.string.chat_media_photo)
    if(preview==Copy.Missing) {
        Surface(shape=RoundedCornerShape(18.dp),border=BorderStroke(1.dp,MaterialTheme.colorScheme.outline),color=MaterialTheme.colorScheme.surface) {
            Text(stringResource(when {
                attachment?.expired()==true && kind==MediaKind.VIDEO -> R.string.chat_media_video_expired
                attachment?.expired()==true -> R.string.chat_media_photo_expired
                else -> R.string.chat_media_unavailable
            }),style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant,modifier=Modifier.padding(horizontal=14.dp,vertical=9.dp))
        }
        return
    }
    val label=stringResource(R.string.chat_media_open,name)+if(kind==MediaKind.VIDEO) " "+seconds(attachment?.durationMs ?: waiting?.durationMs) else ""
    Column(horizontalAlignment=if(mine) Alignment.End else Alignment.Start) {
        Box(Modifier.width(240.dp).aspectRatio(width.toFloat()/height).clip(RoundedCornerShape(18.dp))
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .then(if(attachment!=null) Modifier.clickable(onClickLabel=label,role=Role.Button) {open=true} else Modifier)
            .semantics {contentDescription=label},contentAlignment=Alignment.Center) {
            picture?.let {Image(it,null,Modifier.fillMaxSize(),contentScale=ContentScale.Crop)} ?: CircularProgressIndicator(Modifier.size(24.dp),strokeWidth=2.dp)
            if(kind==MediaKind.VIDEO) {
                Surface(shape=CircleShape,color=Color.Black.copy(alpha=.6f),contentColor=Color.White) {Icon(Icons.Default.PlayArrow,null,Modifier.padding(10.dp).size(28.dp))}
                Text(seconds(attachment?.durationMs ?: waiting?.durationMs),color=Color.White,style=MaterialTheme.typography.labelSmall,
                    modifier=Modifier.align(Alignment.BottomEnd).padding(6.dp).background(Color.Black.copy(alpha=.6f),RoundedCornerShape(4.dp)).padding(horizontal=6.dp))
            }
        }
        if(attachment?.expired()==true) Text(stringResource(R.string.chat_media_kept),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    }
    if(open && attachment!=null) {
        // Fetched once and kept, which is also what lets the phone show it after day 15.
        val full by produceState<Copy>(Copy.Loading,message.id) {value=copy(message,false)?.let {Copy.Here(it)} ?: Copy.Missing}
        FullView(full,attachment.kind,name) {open=false}
    }
}

@Composable private fun FullView(full:Copy,kind:MediaKind,name:String,close:()->Unit) {
    Dialog(close,DialogProperties(usePlatformDefaultWidth=false)) {
        Box(Modifier.fillMaxSize().background(Color.Black),contentAlignment=Alignment.Center) {
            when(full) {
                Copy.Loading -> CircularProgressIndicator(color=Color.White)
                Copy.Missing -> Text(stringResource(R.string.chat_media_unavailable),color=Color.White,modifier=Modifier.padding(24.dp))
                is Copy.Here -> if(kind==MediaKind.VIDEO) AndroidView({context ->
                    VideoView(context).apply {
                        setVideoPath(full.path)
                        setMediaController(MediaController(context).also {it.setAnchorView(this)})
                        setOnPreparedListener {start()}
                    }
                },Modifier.fillMaxWidth().semantics {contentDescription=name})
                else {
                    val picture by produceState<ImageBitmap?>(null,full.path) {value=withContext(Dispatchers.IO) {decode(full.path,2048)}}
                    picture?.let {Image(it,stringResource(R.string.chat_media_photo_alt),Modifier.fillMaxSize(),contentScale=ContentScale.Fit)}
                }
            }
            IconButton(close,Modifier.align(Alignment.TopEnd).padding(8.dp).size(48.dp)) {Icon(Icons.Default.Close,stringResource(R.string.chat_media_close),tint=Color.White)}
        }
    }
}

/**
 * Choose a photo or video, or take one. The photo picker needs no permission; the camera is asked for only the first time
 * someone takes a photo or video here. A capture goes to the app's own cache and is deleted once it has been made smaller.
 */
@Composable fun AttachButton(allowed:Boolean,busy:Boolean,pick:(String,String)->Unit) {
    val context=LocalContext.current
    val toaster=LocalToaster.current
    var menu by remember {mutableStateOf(false)}
    var capture by rememberSaveable {mutableStateOf<String?>(null)}
    var video by rememberSaveable {mutableStateOf(false)}
    val gallery=rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) {uri ->
        uri?.let {pick(it.toString(),context.contentResolver.getType(it).orEmpty())}
    }
    val photo=rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) {ok -> capture?.let {if(ok) pick(it,"image/jpeg")}}
    val clip=rememberLauncherForActivityResult(ActivityResultContracts.CaptureVideo()) {ok -> capture?.let {if(ok) pick(it,"video/mp4")}}
    fun shoot() {
        val file=File(context.cacheDir,"chat-capture/${UUID.randomUUID()}.${if(video) "mp4" else "jpg"}").apply {parentFile?.mkdirs()}
        val uri=FileProvider.getUriForFile(context,"${context.packageName}.files",file)
        capture=uri.toString()
        if(video) clip.launch(uri) else photo.launch(uri)
    }
    val camera=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {granted ->
        if(granted) shoot() else toaster.show(R.string.chat_media_camera_denied,ToastTone.ERROR)
    }
    fun withCamera(asVideo:Boolean) {
        video=asVideo; menu=false
        if(ContextCompat.checkSelfPermission(context,Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED) shoot() else camera.launch(Manifest.permission.CAMERA)
    }
    Box {
        IconButton({menu=true},enabled=allowed && !busy,modifier=Modifier.padding(bottom=4.dp).size(52.dp)) {
            Icon(Icons.Default.Add,stringResource(R.string.chat_media_attach))
        }
        DropdownMenu(menu,{menu=false}) {
            DropdownMenuItem({Text(stringResource(R.string.chat_media_gallery))},{menu=false; gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo))})
            DropdownMenuItem({Text(stringResource(R.string.chat_media_take_photo))},{withCamera(false)})
            DropdownMenuItem({Text(stringResource(R.string.chat_media_record_video))},{withCamera(true)})
        }
    }
}
