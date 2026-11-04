package com.motivance.feature.auth

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import com.motivance.domain.MAX_PHOTO_BYTES
import java.io.ByteArrayOutputStream

/** Edge length of the uploaded square photo. Display thumbnails are derived from it by Cloudinary. */
internal const val PHOTO_EDGE=512

/** Largest power-of-two decode sample that still leaves the shorter side at least [target] pixels. */
internal fun decodeSample(width:Int,height:Int,target:Int=PHOTO_EDGE):Int {
    var sample=1
    while(minOf(width,height)/(sample*2)>=target) sample*=2
    return sample
}

/** Centred square crop as (left, top, side). */
internal fun squareCrop(width:Int,height:Int):Triple<Int,Int,Int> {
    val side=minOf(width,height)
    return Triple((width-side)/2,(height-side)/2,side)
}

/** Clockwise rotation and mirroring needed to display an image with the given EXIF orientation upright. */
internal fun exifTransform(orientation:Int):Pair<Float,Boolean> = when(orientation) {
    ExifInterface.ORIENTATION_ROTATE_90 -> 90f to false
    ExifInterface.ORIENTATION_ROTATE_180 -> 180f to false
    ExifInterface.ORIENTATION_ROTATE_270 -> 270f to false
    ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> 0f to true
    ExifInterface.ORIENTATION_FLIP_VERTICAL -> 180f to true
    ExifInterface.ORIENTATION_TRANSPOSE -> 90f to true
    ExifInterface.ORIENTATION_TRANSVERSE -> 270f to true
    else -> 0f to false
}

class UnreadablePhoto:Exception()

/**
 * Turns a picked image into an upright, centre-cropped [PHOTO_EDGE] square JPEG. Re-encoding also discards the
 * original metadata, such as GPS location, before the photo leaves the device. Runs on a background thread.
 */
fun preparePhoto(resolver:ContentResolver,uri:Uri):ByteArray {
    val bounds=BitmapFactory.Options().apply {inJustDecodeBounds=true}
    // A bounds-only decode always returns null; the dimensions arrive in [bounds].
    (resolver.openInputStream(uri) ?: throw UnreadablePhoto()).use {BitmapFactory.decodeStream(it,null,bounds)}
    if(bounds.outWidth<=0 || bounds.outHeight<=0) throw UnreadablePhoto()
    val decoded=resolver.openInputStream(uri)?.use {
        BitmapFactory.decodeStream(it,null,BitmapFactory.Options().apply {inSampleSize=decodeSample(bounds.outWidth,bounds.outHeight)})
    } ?: throw UnreadablePhoto()
    val orientation=runCatching {
        resolver.openInputStream(uri)?.use {ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION,ExifInterface.ORIENTATION_NORMAL)}
    }.getOrNull() ?: ExifInterface.ORIENTATION_NORMAL
    val (rotation,mirror)=exifTransform(orientation)
    val (left,top,side)=squareCrop(decoded.width,decoded.height)
    val scale=PHOTO_EDGE.toFloat()/side
    val matrix=Matrix().apply {
        if(mirror) postScale(-1f,1f)
        postRotate(rotation)
        postScale(scale,scale)
    }
    val square=Bitmap.createBitmap(decoded,left,top,side,side,matrix,true)
    if(square!==decoded) decoded.recycle()
    return ByteArrayOutputStream().use {out ->
        square.compress(Bitmap.CompressFormat.JPEG,85,out)
        square.recycle()
        out.toByteArray().also {if(it.size>MAX_PHOTO_BYTES) throw UnreadablePhoto()}
    }
}
