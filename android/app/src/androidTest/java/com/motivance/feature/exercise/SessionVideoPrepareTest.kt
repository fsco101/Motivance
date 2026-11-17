package com.motivance.feature.exercise

import android.graphics.Bitmap
import android.graphics.Color
import android.media.MediaMetadataRetriever
import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.motivance.data.local.ChatMediaFiles
import com.motivance.domain.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** A recorded session made ready to share with the therapist (#129): smaller, within the limits, with a still. Needs a device. */
@RunWith(AndroidJUnit4::class)
class SessionVideoPrepareTest {
    private val context=InstrumentationRegistry.getInstrumentation().targetContext

    private fun recorded():File {
        val file=File(context.cacheDir,"session-video/share-test.mp4").apply {delete()}
        val recorder=SessionRecorder(file)
        val points=List(33) {Landmark(.5f,.5f,1f)}
        var taken=0
        val began=System.currentTimeMillis()
        while(taken<45 && System.currentTimeMillis()-began<20_000) {
            val bitmap=Bitmap.createBitmap(720,960,Bitmap.Config.ARGB_8888).apply {eraseColor(Color.DKGRAY)}
            if(recorder.offer(VideoFrame(bitmap,points,false,ExerciseRules(),TrackingQuality.READY,90.0,"Elbow flexion"))) taken++
            Thread.sleep(33)
        }
        val latch=CountDownLatch(1)
        var result:File?=null
        recorder.finish {result=it; latch.countDown()}
        assertTrue(latch.await(10,TimeUnit.SECONDS))
        return result!!
    }

    @Test fun aRecordingIsMadeSmallerWithAStillWithinTheServersLimits()=runBlocking<Unit> {
        val source=recorded()
        val draft=ChatMediaFiles(context).prepareSessionVideo("10000000-0000-0000-0000-000000000001",Uri.fromFile(source).toString()) {}
        try {
            assertEquals(MediaKind.VIDEO,draft.kind)
            assertEquals("video/mp4",draft.mime)
            assertTrue("${draft.width}x${draft.height}",minOf(draft.width,draft.height)<=480 && maxOf(draft.width,draft.height)<=854)
            assertTrue((draft.durationMs ?: 0)>0 && (draft.durationMs ?: 0)<=SessionVideoLimits.VIDEO_MS)
            val video=File(draft.file); val still=File(draft.preview)
            assertTrue(video.length() in 1..SessionVideoLimits.VIDEO)
            assertTrue(still.length() in 1..SessionVideoLimits.PREVIEW)
            MediaMetadataRetriever().apply {setDataSource(video.path); assertEquals("yes",extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_VIDEO)); release()}
        } finally {
            File(draft.file).delete(); File(draft.preview).delete(); source.delete()
        }
    }
}
