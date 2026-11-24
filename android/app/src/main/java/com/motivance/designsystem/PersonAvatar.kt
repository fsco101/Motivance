package com.motivance.designsystem

import android.graphics.BitmapFactory
import com.motivance.BuildConfig
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
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

private val PHOTO=Regex("[0-9a-f-]{36}/[0-9a-f]{32}\\.(webp|jpg)")

/**
 * The address of a stored profile photo. The database keeps only the file's path in the public `avatars` bucket, because the
 * same file is reached through different hosts (an emulator, a phone, the hosted project); this joins it to the backend the
 * app talks to. Returns null for anything that is not a Motivance photo path, so the app never fetches an arbitrary stored
 * value.
 */
fun avatarAddress(path:String?,base:String=BuildConfig.SUPABASE_URL):String? {
    if(path==null || base.isBlank() || !PHOTO.matches(path)) return null
    return base.trimEnd('/')+"/storage/v1/object/public/avatars/"+path
}

/** Up to two initials; for an email address only the part before "@" is used. */
fun initials(name:String):String {
    val words=name.trim().substringBefore('@').split(Regex("[\\s@._-]+")).filter {it.isNotEmpty() && it.first().isLetterOrDigit()}
    return when {words.isEmpty() -> "?";words.size==1 -> words[0].take(2);else -> "${words.first().first()}${words.last().first()}"}.uppercase()
}

/** What a decorative avatar shows, as its test tag. */
const val AVATAR_PHOTO="avatar_photo"
const val AVATAR_INITIALS="avatar_initials"

/** Small in-memory cache over the app's HTTP stack, sized for avatar lists. Each photo is one small file, whatever its drawn size. */
internal object AvatarImages {
    private val client by lazy {OkHttpClient()}
    private val cache=LruCache<String,ImageBitmap>(64)
    fun cached(url:String):ImageBitmap?=cache.get(url)
    /** Lets a test show a photo without a server. */
    @androidx.annotation.VisibleForTesting fun put(url:String,image:ImageBitmap) {cache.put(url,image)}
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
    description:String?=null,
    /** True beside text that already names the person: neither the photo nor the initials are read, and tests see which is shown. */
    decorative:Boolean=false) {
    val url=avatarAddress(photoUrl)
    val image by produceState(url?.let {AvatarImages.cached(it)},url) {value=url?.let {AvatarImages.load(it)}}
    val semantics=when {
        decorative -> Modifier.clearAndSetSemantics {testTag=if(image!=null) AVATAR_PHOTO else AVATAR_INITIALS}
        description!=null -> Modifier.semantics {contentDescription=description}
        else -> Modifier
    }
    Surface(modifier.size(size).then(semantics),shape=CircleShape,color=container,contentColor=content) {
        val bitmap=image
        if(bitmap!=null) Image(bitmap,null,Modifier.size(size).clip(CircleShape),contentScale=ContentScale.Crop)
        else Box(contentAlignment=Alignment.Center) {
            Text(initials(name),style=when {size>=80.dp -> MaterialTheme.typography.headlineSmall;size>=44.dp -> MaterialTheme.typography.titleMedium;else -> MaterialTheme.typography.labelLarge},fontWeight=FontWeight.Bold)
        }
    }
}
