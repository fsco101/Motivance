package com.motivance.feature.auth

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.media.ExifInterface
import android.net.Uri
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class ProfilePhotoPreparationTest {
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext

    /** A 1200x800 grey JPEG with a red marker at the top centre, tagged with EXIF rotation and GPS location. */
    private fun source(orientation:Int):File {
        val bitmap=Bitmap.createBitmap(1200,800,Bitmap.Config.ARGB_8888)
        Canvas(bitmap).apply {drawColor(Color.GRAY);drawRect(500f,0f,700f,100f,Paint().apply {color=Color.RED})}
        val file=File(context.cacheDir,"photo-source-$orientation.jpg")
        file.outputStream().use {bitmap.compress(Bitmap.CompressFormat.JPEG,95,it)}
        ExifInterface(file.absolutePath).apply {
            setAttribute(ExifInterface.TAG_ORIENTATION,orientation.toString())
            setAttribute(ExifInterface.TAG_GPS_LATITUDE,"14/1,35/1,0/1");setAttribute(ExifInterface.TAG_GPS_LATITUDE_REF,"N")
            saveAttributes()
        }
        return file
    }
    private fun red(pixel:Int)=Color.red(pixel)>180 && Color.green(pixel)<90 && Color.blue(pixel)<90

    @Test fun preparedPhotoIsAnUprightSquareJpegWithoutLocation() {
        val jpeg=preparePhoto(context.contentResolver,Uri.fromFile(source(ExifInterface.ORIENTATION_ROTATE_90)))
        val image=BitmapFactory.decodeByteArray(jpeg,0,jpeg.size)
        assertEquals(PHOTO_EDGE,image.width);assertEquals(PHOTO_EDGE,image.height)
        // Rotating 90 degrees clockwise moves the top-centre marker to the right edge, vertically centred.
        assertTrue("marker should be on the right after rotation",red(image.getPixel(495,256)))
        assertFalse(red(image.getPixel(256,15)));assertFalse(red(image.getPixel(15,256)))
        val output=File(context.cacheDir,"photo-output.jpg").apply {writeBytes(jpeg)}
        val exif=ExifInterface(output.absolutePath)
        assertNull("GPS must be stripped",exif.getAttribute(ExifInterface.TAG_GPS_LATITUDE))
        assertTrue(exif.getAttributeInt(ExifInterface.TAG_ORIENTATION,ExifInterface.ORIENTATION_NORMAL) in setOf(ExifInterface.ORIENTATION_NORMAL,ExifInterface.ORIENTATION_UNDEFINED))
        assertTrue(jpeg.size in 1..com.motivance.domain.MAX_PHOTO_BYTES)
    }
    @Test fun unrotatedPhotoKeepsTheMarkerAtTheTop() {
        val jpeg=preparePhoto(context.contentResolver,Uri.fromFile(source(ExifInterface.ORIENTATION_NORMAL)))
        val image=BitmapFactory.decodeByteArray(jpeg,0,jpeg.size)
        assertTrue(red(image.getPixel(256,15)));assertFalse(red(image.getPixel(495,256)))
    }
    @Test fun nonImageInputIsRejected() {
        val file=File(context.cacheDir,"not-an-image.jpg").apply {writeText("plain text")}
        assertThrows(UnreadablePhoto::class.java) {preparePhoto(context.contentResolver,Uri.fromFile(file))}
    }
}
