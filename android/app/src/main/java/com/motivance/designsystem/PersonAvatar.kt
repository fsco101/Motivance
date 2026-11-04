package com.motivance.designsystem

import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

private val PHOTO=Regex("^(https://res\\.cloudinary\\.com/[A-Za-z0-9_-]+/image/upload/)(v[0-9]+/motivance/avatars/[0-9a-f-]{36}/[0-9a-f]{32})$")

/**
 * Cloudinary delivery URL for a square, face-centred JPEG thumbnail of [pixels] size. Returns null for anything
 * that is not a Motivance profile photo, so the app never fetches an arbitrary stored URL.
 */
fun avatarThumbnail(url:String?,pixels:Int):String? {
    val match=PHOTO.matchEntire(url ?: return null) ?: return null
    return match.groupValues[1]+"c_fill,g_face,w_$pixels,h_$pixels,q_auto,f_jpg/"+match.groupValues[2]
}

/** Thumbnail sizes are rounded up to a few buckets so one download serves several avatar sizes. */
internal fun thumbnailBucket(pixels:Int)=listOf(96,192,384).firstOrNull {it>=pixels} ?: 384

/** Up to two initials; for an email address only the part before "@" is used. */
fun initials(name:String):String {
    val words=name.trim().substringBefore('@').split(Regex("[\\s@._-]+")).filter {it.isNotEmpty() && it.first().isLetterOrDigit()}
    return when {words.isEmpty() -> "?";words.size==1 -> words[0].take(2);else -> "${words.first().first()}${words.last().first()}"}.uppercase()
}

/** Small in-memory cache over the app's HTTP stack, sized for avatar lists. */
private object AvatarImages {
    private val client by lazy {OkHttpClient()}
    private val cache=LruCache<String,ImageBitmap>(64)
    fun cached(url:String):ImageBitmap?=cache.get(url)
    suspend fun load(url:String):ImageBitmap?=cache.get(url) ?: withContext(Dispatchers.IO) {
        runCatching {
            client.newCall(Request.Builder().url(url).build()).execute().use {response ->
                if(!response.isSuccessful) null else response.body?.byteStream()?.use {BitmapFactory.decodeStream(it)}?.asImageBitmap()
            }
        }.getOrNull()
    }?.also {cache.put(url,it)}
}

/**
 * A circular person avatar: the profile photo when one exists and loads, otherwise initials on [container].
 * [description] names the image for screen readers; omit it when adjacent text already names the person.
 */
@Composable fun PersonAvatar(photoUrl:String?,name:String,size:Dp=48.dp,modifier:Modifier=Modifier,
    container:Color=MaterialTheme.colorScheme.primaryContainer,content:Color=MaterialTheme.colorScheme.onPrimaryContainer,
    description:String?=null) {
    val pixels=with(LocalDensity.current) {size.roundToPx()}
    val url=avatarThumbnail(photoUrl,thumbnailBucket(pixels))
    val image by produceState(url?.let {AvatarImages.cached(it)},url) {value=url?.let {AvatarImages.load(it)}}
    val semantics=if(description!=null) Modifier.semantics {contentDescription=description} else Modifier
    Surface(modifier.size(size).then(semantics),shape=CircleShape,color=container,contentColor=content) {
        val bitmap=image
        if(bitmap!=null) Image(bitmap,null,Modifier.size(size).clip(CircleShape),contentScale=ContentScale.Crop)
        else Box(contentAlignment=Alignment.Center) {
            Text(initials(name),style=when {size>=80.dp -> MaterialTheme.typography.headlineSmall;size>=44.dp -> MaterialTheme.typography.titleMedium;else -> MaterialTheme.typography.labelLarge},fontWeight=FontWeight.Bold)
        }
    }
}
