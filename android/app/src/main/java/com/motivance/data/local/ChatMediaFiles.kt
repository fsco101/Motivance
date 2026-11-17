package com.motivance.data.local

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.media.MediaMetadataRetriever
import android.net.Uri
import androidx.core.net.toUri
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.Presentation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import com.motivance.domain.*
import com.motivance.feature.auth.exifTransform
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

/** Why a picked file cannot be sent. The code matches the server's and the web's, so all three say the same thing. */
class MediaProblem(val code:String):Exception(code)

/**
 * Photos and videos for chat, on this phone. It makes a picked file small enough to send, keeps what is waiting, and keeps
 * a copy of every file once it has been seen or sent, so the phone still shows it after the server has removed it. Everything
 * lives in the app's own storage, per account, and goes at sign-out.
 */
interface ChatMediaStore {
    suspend fun prepare(owner:String,uri:String,onProgress:(Float)->Unit):MediaDraft
    /** A session recording made smaller for sharing with the therapist (#129): 480p, its first five minutes, about 500 kbps. */
    suspend fun prepareSessionVideo(owner:String,uri:String,onProgress:(Float)->Unit):MediaDraft {throw UnsupportedOperationException()}
    suspend fun read(path:String):ByteArray
    /** Once sent, the files become the phone's copy of that message. */
    suspend fun keep(owner:String,id:String,draft:MediaDraft)
    suspend fun discard(draft:MediaDraft)
    /** The phone's copy of a file, fetched once through [link] if it is not here yet. Null when there is none and the server's has expired. */
    suspend fun copy(owner:String,id:String,attachment:Attachment,preview:Boolean,link:suspend (String)->String):String?
}

@Singleton class ChatMediaFiles @Inject constructor(@ApplicationContext private val context:Context):ChatMediaStore {
    private val http by lazy {OkHttpClient()}

    private fun folder(kind:String,owner:String):File {
        UUID.fromString(owner)
        return File(context.filesDir,"$kind/$owner").apply {mkdirs()}
    }
    private fun saved(owner:String,id:String,attachment:Attachment,preview:Boolean):File {
        UUID.fromString(id)
        val extension=if(preview) "preview.jpg" else when(attachment.mime) {"video/mp4" -> "mp4"; "video/webm" -> "webm"; "image/webp" -> "webp"; else -> "jpg"}
        return File(folder("chat-media",owner),"$id.$extension")
    }

    override suspend fun prepare(owner:String,uri:String,onProgress:(Float)->Unit):MediaDraft {
        val source=Uri.parse(uri)
        val type=context.contentResolver.getType(source).orEmpty()
        val out=folder("chat-outbox",owner)
        val name=UUID.randomUUID().toString()
        try {
            return when {
                type.startsWith("image/") -> withContext(Dispatchers.IO) {photo(source,File(out,"$name.jpg"),File(out,"$name-preview.jpg"))}
                type.startsWith("video/") -> video(source,File(out,"$name.mp4"),File(out,"$name-preview.jpg"),onProgress)
                else -> throw MediaProblem("chat_media_invalid")
            }
        } finally {
            // A photo or video taken in the app was only ever a step on the way: once made smaller, the original goes.
            if(source.authority=="${context.packageName}.files") withContext(Dispatchers.IO) {runCatching {context.contentResolver.delete(source,null,null)}}
        }
    }

    override suspend fun prepareSessionVideo(owner:String,uri:String,onProgress:(Float)->Unit):MediaDraft {
        val name=UUID.randomUUID().toString()
        val out=folder("session-share",owner)
        return video(uri.toUri(),File(out,"$name.mp4"),File(out,"$name-preview.jpg"),onProgress,SESSION_VIDEO)
    }

    override suspend fun read(path:String)=withContext(Dispatchers.IO) {File(path).readBytes()}

    override suspend fun keep(owner:String,id:String,draft:MediaDraft) = withContext(Dispatchers.IO) {
        val attachment=Attachment(draft.kind,draft.mime,draft.width,draft.height,draft.durationMs,0,"","","")
        File(draft.file).renameTo(saved(owner,id,attachment,false))
        File(draft.preview).renameTo(saved(owner,id,attachment,true))
        Unit
    }

    override suspend fun discard(draft:MediaDraft) = withContext(Dispatchers.IO) {File(draft.file).delete(); File(draft.preview).delete(); Unit}

    override suspend fun copy(owner:String,id:String,attachment:Attachment,preview:Boolean,link:suspend (String)->String):String? {
        val file=saved(owner,id,attachment,preview)
        if(file.exists() && file.length()>0) return file.path
        if(attachment.expired()) return null
        val address=link(if(preview) attachment.previewPath else attachment.mediaPath)
        return withContext(Dispatchers.IO) {
            val part=File(file.parentFile,"${file.name}.part")
            http.newCall(Request.Builder().url(address).build()).execute().use {response ->
                if(!response.isSuccessful) return@withContext null
                part.outputStream().use {sink -> response.body?.byteStream()?.copyTo(sink)}
            }
            if(part.renameTo(file)) file.path else null
        }
    }

    // ------------------------------------------------------------------------------------------------------------------
    // Photos: upright, at most 1600 px, re-encoded as JPEG, which also drops the location and camera details.

    private fun photo(uri:Uri,out:File,preview:File):MediaDraft {
        val resolver=context.contentResolver
        val bounds=BitmapFactory.Options().apply {inJustDecodeBounds=true}
        (resolver.openInputStream(uri) ?: throw MediaProblem("chat_media_unreadable")).use {BitmapFactory.decodeStream(it,null,bounds)}
        if(bounds.outWidth<=0 || bounds.outHeight<=0) throw MediaProblem("chat_media_unreadable")
        var sample=1
        while(maxOf(bounds.outWidth,bounds.outHeight)/(sample*2)>=MediaLimits.PHOTO_LONG_SIDE) sample*=2
        val decoded=resolver.openInputStream(uri)?.use {BitmapFactory.decodeStream(it,null,BitmapFactory.Options().apply {inSampleSize=sample})}
            ?: throw MediaProblem("chat_media_unreadable")
        val orientation=runCatching {resolver.openInputStream(uri)?.use {ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION,ExifInterface.ORIENTATION_NORMAL)}}
            .getOrNull() ?: ExifInterface.ORIENTATION_NORMAL
        val (rotation,mirror)=exifTransform(orientation)
        val upright=Bitmap.createBitmap(decoded,0,0,decoded.width,decoded.height,Matrix().apply {if(mirror) postScale(-1f,1f); postRotate(rotation)},true)
        if(upright!==decoded) decoded.recycle()
        try {
            val size=fitWithin(upright.width,upright.height,MediaLimits.PHOTO_LONG_SIDE)
            val written=encode(upright,size,(MediaLimits.IMAGE*0.95).toLong(),out)
            encode(upright,fitWithin(written.width,written.height,MediaLimits.PREVIEW_LONG_SIDE),MediaLimits.PREVIEW,preview)
            return MediaDraft(MediaKind.IMAGE,out.path,"image/jpeg",preview.path,written.width,written.height,null)
        } finally {upright.recycle()}
    }

    /** JPEG at [size], lowering quality and then size until it fits under [limit]. Returns the size written. */
    private fun encode(source:Bitmap,size:Size,limit:Long,out:File):Size {
        var target=size
        repeat(8) {
            val scaled=Bitmap.createScaledBitmap(source,target.width,target.height,true)
            try {
                for(quality in listOf(82,70,58)) {
                    val bytes=ByteArrayOutputStream().also {scaled.compress(Bitmap.CompressFormat.JPEG,quality,it)}.toByteArray()
                    if(bytes.size<=limit) {out.writeBytes(bytes); return target}
                }
            } finally {if(scaled!==source) scaled.recycle()}
            target=fitWithin(target.width,target.height,(maxOf(target.width,target.height)*0.8).toInt())
        }
        throw MediaProblem("chat_media_too_large")
    }

    // ------------------------------------------------------------------------------------------------------------------
    // Video: 480p H.264 with AAC sound, then a still from its first frame. For chat, about 1 Mbps and the first 30 seconds; a
    // shared session video (#129) is about 500 kbps and keeps its first five minutes.

    private class VideoLimits(val longestMs:Long,val bits:Int,val bytes:Long)
    private companion object {
        val CHAT_VIDEO=VideoLimits(MediaLimits.VIDEO_MS,MediaLimits.VIDEO_BITS,MediaLimits.VIDEO)
        val SESSION_VIDEO=VideoLimits(SessionVideoLimits.VIDEO_MS,SessionVideoLimits.VIDEO_BITS,SessionVideoLimits.VIDEO)
    }

    @OptIn(UnstableApi::class)
    private suspend fun video(uri:Uri,out:File,preview:File,onProgress:(Float)->Unit,limits:VideoLimits=CHAT_VIDEO):MediaDraft {
        val (width,height,length)=withContext(Dispatchers.IO) {
            MediaMetadataRetriever().run {
                try {
                    setDataSource(context,uri)
                    val w=extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
                    val h=extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
                    val turn=extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
                    val ms=extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0
                    // A phone held upright records sideways and says so; the size that matters is the one seen.
                    if(turn==90 || turn==270) Triple(h,w,ms) else Triple(w,h,ms)
                } catch(_:Exception) {throw MediaProblem("chat_media_unreadable")} finally {release()}
            }
        }
        val plan=runCatching {videoPlan(width,height,length,limits.longestMs)}.getOrElse {throw MediaProblem("chat_media_unreadable")}
        val result=withContext(Dispatchers.Main) {
            coroutineScope {
                var transformer:Transformer?=null
                val watch=launch {
                    val holder=ProgressHolder()
                    while(true) {
                        if(transformer?.getProgress(holder)==Transformer.PROGRESS_STATE_AVAILABLE) onProgress(holder.progress/100f)
                        delay(250)
                    }
                }
                try {
                    suspendCancellableCoroutine<ExportResult> {done ->
                        val encoder=DefaultEncoderFactory.Builder(context)
                            .setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(limits.bits).build()).build()
                        val made=Transformer.Builder(context).setVideoMimeType(MimeTypes.VIDEO_H264).setAudioMimeType(MimeTypes.AUDIO_AAC).setEncoderFactory(encoder)
                            .addListener(object:Transformer.Listener {
                                override fun onCompleted(composition:Composition,exportResult:ExportResult) {done.resume(exportResult)}
                                override fun onError(composition:Composition,exportResult:ExportResult,exportException:ExportException) {
                                    done.resumeWithException(MediaProblem("chat_media_unreadable"))
                                }
                            }).build()
                        transformer=made
                        val item=MediaItem.Builder().setUri(uri)
                            .setClippingConfiguration(MediaItem.ClippingConfiguration.Builder().setEndPositionMs(plan.durationMs).build()).build()
                        val edited=EditedMediaItem.Builder(item)
                            .setEffects(Effects(emptyList(),listOf(Presentation.createForWidthAndHeight(plan.width,plan.height,Presentation.LAYOUT_SCALE_TO_FIT)))).build()
                        made.start(edited,out.path)
                        done.invokeOnCancellation {made.cancel(); out.delete()}
                    }
                } finally {watch.cancel()}
            }
        }
        if(out.length()>limits.bytes) {out.delete(); throw MediaProblem("chat_media_too_large")}
        withContext(Dispatchers.IO) {
            val frame=MediaMetadataRetriever().run {try {setDataSource(out.path); getFrameAtTime(0)} finally {release()}} ?: throw MediaProblem("chat_media_unreadable")
            try {encode(frame,fitWithin(frame.width,frame.height,MediaLimits.PREVIEW_LONG_SIDE),MediaLimits.PREVIEW,preview)} finally {frame.recycle()}
        }
        onProgress(1f)
        return MediaDraft(MediaKind.VIDEO,out.path,"video/mp4",preview.path,plan.width,plan.height,
            result.durationMs.takeIf {it>0}?.coerceAtMost(limits.longestMs) ?: plan.durationMs)
    }
}
