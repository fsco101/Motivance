package com.motivance.feature.auth

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Rect
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import com.motivance.domain.MAX_PHOTO_BYTES
import java.io.ByteArrayOutputStream
import kotlin.math.floor
import kotlin.math.roundToInt

/**
 * Edge length of the stored square photo, as on the web. It covers the largest avatar the apps draw on a dense screen,
 * and keeps a photo to a few tens of kilobytes.
 */
internal const val PHOTO_EDGE=384
/** How far in the person can zoom: at most a quarter of the picture's shorter side. */
internal const val MAX_ZOOM=4f
/** The size a photo aims for. Quality is lowered until it fits, and the server refuses anything over [MAX_PHOTO_BYTES]. */
internal const val PHOTO_TARGET_BYTES=60_000

/** Which square of the picture is kept: how far in, and where its centre is, in the picture's own pixels. */
data class PhotoCrop(val zoom:Float,val cx:Float,val cy:Float)
/** The kept square, in the picture's own pixels. */
data class CropSquare(val x:Float,val y:Float,val side:Float)

/** The whole of the shorter side, centred. */
internal fun initialCrop(width:Int,height:Int)=PhotoCrop(1f,width/2f,height/2f)

/** The kept square, always inside the picture. The same rules as cropSquare in the web app's photo.ts. */
internal fun cropSquare(width:Int,height:Int,crop:PhotoCrop):CropSquare {
    val side=minOf(width,height)/crop.zoom.coerceIn(1f,MAX_ZOOM)
    val cx=crop.cx.coerceIn(side/2,width-side/2)
    val cy=crop.cy.coerceIn(side/2,height-side/2)
    return CropSquare(cx-side/2,cy-side/2,side)
}

private fun settle(width:Int,height:Int,zoom:Float,cx:Float,cy:Float):PhotoCrop {
    val z=zoom.coerceIn(1f,MAX_ZOOM)
    val s=cropSquare(width,height,PhotoCrop(z,cx,cy))
    return PhotoCrop(z,s.x+s.side/2,s.y+s.side/2)
}

/** Dragging the picture by (dx, dy) on a viewport [viewport] pixels wide moves it under the frame, like a finger would. */
internal fun panCrop(width:Int,height:Int,crop:PhotoCrop,dx:Float,dy:Float,viewport:Float):PhotoCrop {
    val scale=cropSquare(width,height,crop).side/maxOf(1f,viewport)
    return settle(width,height,crop.zoom,crop.cx-dx*scale,crop.cy-dy*scale)
}

/** Zooming keeps the same centre, moved only as far as needed to stay inside the picture. */
internal fun zoomCrop(width:Int,height:Int,crop:PhotoCrop,zoom:Float)=settle(width,height,zoom,crop.cx,crop.cy)

/** The kept square in whole pixels, for drawing. */
data class PixelSquare(val left:Int,val top:Int,val side:Int) {
    val rect:Rect get()=Rect(left,top,left+side,top+side)
}

/** Whole-pixel source square for drawing the kept square, never reaching outside the picture. */
internal fun cropPixels(width:Int,height:Int,crop:PhotoCrop):PixelSquare {
    val s=cropSquare(width,height,crop)
    val side=floor(s.side).toInt().coerceIn(1,minOf(width,height))
    return PixelSquare(s.x.roundToInt().coerceIn(0,width-side),s.y.roundToInt().coerceIn(0,height-side),side)
}

/**
 * Largest power-of-two decode sample that still leaves the shorter side at least [target] pixels: enough detail for
 * the photo at full zoom, without holding a whole camera picture in memory.
 */
internal fun decodeSample(width:Int,height:Int,target:Int=PHOTO_EDGE*2):Int {
    var sample=1
    while(minOf(width,height)/(sample*2)>=target) sample*=2
    return sample
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

/** Opens a picked image upright and reduced for cropping. Runs on a background thread. */
fun loadPhoto(resolver:ContentResolver,uri:Uri):Bitmap {
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
    if(rotation==0f && !mirror) return decoded
    val matrix=Matrix().apply {if(mirror) postScale(-1f,1f);postRotate(rotation)}
    return Bitmap.createBitmap(decoded,0,0,decoded.width,decoded.height,matrix,true).also {if(it!==decoded) decoded.recycle()}
}

/**
 * Draws the kept square at [PHOTO_EDGE] and encodes it as WebP, lowering quality until it fits [PHOTO_TARGET_BYTES].
 * Re-encoding also discards the original metadata, such as GPS location, before the photo leaves the device. Runs on a
 * background thread.
 */
fun encodePhoto(photo:Bitmap,crop:PhotoCrop):ByteArray {
    val paint=Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
    var source=photo
    var from=cropPixels(photo.width,photo.height,crop).rect
    // A large square is halved first, so the final step does not skip pixels and look grainy.
    if(from.width()>PHOTO_EDGE*2) {
        source=Bitmap.createBitmap(PHOTO_EDGE*2,PHOTO_EDGE*2,Bitmap.Config.ARGB_8888)
        Canvas(source).drawBitmap(photo,from,Rect(0,0,PHOTO_EDGE*2,PHOTO_EDGE*2),paint)
        from=Rect(0,0,PHOTO_EDGE*2,PHOTO_EDGE*2)
    }
    val square=Bitmap.createBitmap(PHOTO_EDGE,PHOTO_EDGE,Bitmap.Config.ARGB_8888)
    Canvas(square).apply {
        // A transparent picture gets a white background instead of black.
        drawColor(Color.WHITE)
        drawBitmap(source,from,Rect(0,0,PHOTO_EDGE,PHOTO_EDGE),paint)
    }
    if(source!==photo) source.recycle()
    @Suppress("DEPRECATION")
    val format=if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.R) Bitmap.CompressFormat.WEBP_LOSSY else Bitmap.CompressFormat.WEBP
    var smallest:ByteArray?=null
    try {
        for(quality in listOf(80,68,55)) {
            val bytes=ByteArrayOutputStream().use {out -> square.compress(format,quality,out);out.toByteArray()}
            if(bytes.isNotEmpty() && bytes.size<=PHOTO_TARGET_BYTES) return bytes
            if(bytes.isNotEmpty() && (smallest==null || bytes.size<smallest.size)) smallest=bytes
        }
    } finally {square.recycle()}
    return smallest?.takeIf {it.size<=MAX_PHOTO_BYTES} ?: throw UnreadablePhoto()
}
