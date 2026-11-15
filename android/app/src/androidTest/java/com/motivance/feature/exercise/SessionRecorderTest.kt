package com.motivance.feature.exercise

import android.graphics.Bitmap
import android.graphics.Color
import android.media.MediaMetadataRetriever
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.motivance.domain.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Records frames the way a session does and checks the file plays, with the overlay drawn into it. Needs a device. */
@RunWith(AndroidJUnit4::class)
class SessionRecorderTest {
    private val context=InstrumentationRegistry.getInstrumentation().targetContext

    private fun frame(caption:String):VideoFrame {
        val bitmap=Bitmap.createBitmap(480,640,Bitmap.Config.ARGB_8888).apply {eraseColor(Color.DKGRAY)}
        // A body standing in the middle, everything visible.
        val points=List(33) {Landmark(.5f,.5f,1f)}.toMutableList()
        mapOf(11 to (.4f to .3f),12 to (.6f to .3f),13 to (.35f to .45f),14 to (.65f to .45f),15 to (.3f to .6f),16 to (.7f to .6f),
            23 to (.45f to .6f),24 to (.55f to .6f)).forEach {(i,p) -> points[i]=Landmark(p.first,p.second,1f)}
        return VideoFrame(bitmap,points,false,ExerciseRules(),TrackingQuality.READY,92.0,caption)
    }

    @Test fun framesBecomeOnePlayableVideoWithTheSkeletonDrawnOnIt() {
        val file=File(context.cacheDir,"session-video/test.mp4").apply {delete()}
        val recorder=SessionRecorder(file)
        // Frames come at the camera's pace; a busy encoder skips them, as it does in a session.
        var taken=0; var offered=0
        val began=System.currentTimeMillis()
        var slowest=0L
        while(taken<30 && System.currentTimeMillis()-began<15_000) {
            val shown=frame("Elbow flexion · 92° · 3 / 10")
            val handed=System.nanoTime()
            offered++; if(recorder.offer(shown)) taken++
            slowest=maxOf(slowest,System.nanoTime()-handed)
            Thread.sleep(33)
        }
        // Handing a frame over never waits for the encoder, so the camera thread keeps its pace.
        assertTrue("slowest hand-over ${slowest/1000} µs",slowest<5_000_000)
        android.util.Log.i("SessionRecorderTest","took $taken of $offered frames in ${System.currentTimeMillis()-began} ms")
        val latch=CountDownLatch(1)
        var result:File?=null
        recorder.finish {result=it; latch.countDown()}
        assertTrue(latch.await(10,TimeUnit.SECONDS))
        assertFalse(recorder.failed)
        assertTrue(taken>=30)
        val saved=result!!
        MediaMetadataRetriever().apply {
            setDataSource(saved.path)
            assertEquals("yes",extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_VIDEO))
            assertTrue(extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)!!.toLong()>500)
            val picture=getFrameAtTime(400_000)!!
            // The grey picture is there, and so is the overlay: some pixels are far from grey.
            val colours=(0 until picture.height step 8).flatMap {y -> (0 until picture.width step 8).map {x -> picture.getPixel(x,y)}}
            assertTrue(colours.any {Color.green(it)-Color.red(it)>60})
            release()
        }
        saved.delete()
    }

    @Test fun aVideoGoesToTheMotivanceAlbumAndDeletingRemovesIt() {
        val file=File(context.cacheDir,"session-video/gallery.mp4").apply {delete()}
        val recorder=SessionRecorder(file)
        var taken=0
        val began=System.currentTimeMillis()
        while(taken<10 && System.currentTimeMillis()-began<10_000) {if(recorder.offer(frame("Gallery"))) taken++; Thread.sleep(33)}
        val latch=CountDownLatch(1)
        var result:File?=null
        recorder.finish {result=it; latch.countDown()}
        assertTrue(latch.await(10,TimeUnit.SECONDS))
        val uri=GalleryVideos.save(context,result!!,videoName(System.currentTimeMillis()))
        try {
            assertTrue(GalleryVideos.exists(context,uri))
            if(android.os.Build.VERSION.SDK_INT>=29) context.contentResolver.query(uri,arrayOf(android.provider.MediaStore.Video.Media.RELATIVE_PATH),null,null,null)!!.use {
                assertTrue(it.moveToFirst()); assertEquals("Movies/Motivance/",it.getString(0))
            }
        } finally {
            assertTrue(GalleryVideos.delete(context,uri))
        }
        assertFalse(GalleryVideos.exists(context,uri))
        result!!.delete()
    }

    @Test fun theStoreRemembersConsentAndVideosPerPerson() {
        val store=SessionVideoStore(context)
        store.consent("a",false); store.consent("b",false)
        assertFalse(store.consented("a"))
        store.consent("a",true)
        assertTrue(store.consented("a")); assertFalse(store.consented("b"))
        store.add("a",SessionVideo("content://x/1",listOf("s1","s2"),1))
        assertEquals("content://x/1",store.forSession("a","s2")?.uri)
        assertNull(store.forSession("b","s2"))
        store.remove("a","content://x/1")
        assertNull(store.forSession("a","s1"))
        store.consent("a",false)
    }

    @Test fun aRecordingWithNoFramesWritesNothing() {
        val file=File(context.cacheDir,"session-video/empty.mp4").apply {delete()}
        val latch=CountDownLatch(1)
        var result:File?=File("x")
        SessionRecorder(file).finish {result=it; latch.countDown()}
        assertTrue(latch.await(5,TimeUnit.SECONDS))
        assertNull(result)
        assertFalse(file.exists())
    }
}
