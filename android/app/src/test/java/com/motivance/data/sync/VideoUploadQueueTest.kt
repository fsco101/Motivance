package com.motivance.data.sync

import com.motivance.domain.MediaPlaces
import com.motivance.domain.RemoteFailure
import com.motivance.domain.SessionVideoRepository
import com.motivance.domain.SharedVideo
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.io.IOException
import kotlin.io.path.createTempDirectory

/** #175: the upload queue's rules, the same cases as the web's uploadQueue.test.ts. */
class VideoUploadQueueTest {
    private val folder=createTempDirectory("video-queue").toFile()
    private fun copy(name:String,size:Int)=File(folder,name).apply {writeBytes(ByteArray(size))}.path

    private class Server:SessionVideoRepository {
        val calls=mutableListOf<String>()
        var fail:(String)->Exception?={null}
        private fun step(name:String) {calls+=name; fail(name)?.let {throw it}}
        override suspend fun loadSharedVideos(patientId:String)=emptyList<SharedVideo>()
        override suspend fun startSessionVideo(id:String,sessionId:String,width:Int,height:Int,durationMs:Long):MediaPlaces {step("start"); return MediaPlaces("p/$id.mp4","p/$id.jpg")}
        override suspend fun uploadSessionVideo(path:String,bytes:ByteArray,mime:String) {step(if(mime=="video/mp4") "media" else "preview")}
        override suspend fun shareSessionVideo(id:String):SharedVideo {step("share"); return SharedVideo(id,"s1","p1","t1",480,270,30_000,"m","p","2026-11-25T00:00:00Z","2026-12-10T00:00:00Z")}
        override suspend fun stopSharingVideo(id:String) {}
        override suspend fun sessionVideoLink(path:String,seconds:Int)=""
    }

    private fun queued(id:String="v1",session:String="s1",owner:String="p1")=QueuedVideo(id,owner,session,copy("$id.mp4",64),copy("$id.jpg",8),480,270,30_000)
    private fun uploads(store:VideoQueueStore,server:Server,result:SessionUpload=SessionUpload.UPLOADED)=
        VideoUploads(store,server,{_,_ -> result},{path -> File(path).readBytes()})

    @Test fun offlineItWaitsThenGoesUpOnceOnline()=runBlocking {
        val store=FileVideoQueueStore(folder); val server=Server()
        server.fail={IOException("offline")}
        val queue=uploads(store,server)
        queue.enqueue(queued())
        assertTrue(queue.drain("p1"))
        assertEquals(VideoUploadState.WAITING,queue.list("p1").single().state)
        server.fail={null}; server.calls.clear()
        assertFalse(queue.drain("p1"))
        assertEquals(listOf("start","media","preview","share"),server.calls)
        assertTrue(queue.list("p1").isEmpty())
        // The queued copies are deleted once uploaded.
        assertFalse(File(folder,"v1.mp4").exists())
    }

    @Test fun itWaitsForTheSessionsOwnResultFirst()=runBlocking {
        val server=Server()
        var session=SessionUpload.WAITING
        val queue=VideoUploads(FileVideoQueueStore(folder),server,{_,_ -> session},{path -> File(path).readBytes()})
        queue.enqueue(queued())
        assertTrue(queue.drain("p1"))
        // Nothing is asked of the server, so video_session_missing never reaches the patient.
        assertTrue(server.calls.isEmpty())
        session=SessionUpload.UPLOADED
        assertFalse(queue.drain("p1"))
        assertEquals("share",server.calls.last())
    }

    @Test fun aSessionThatWillNeverUploadStopsTheVideo()=runBlocking {
        val queue=uploads(FileVideoQueueStore(folder),Server(),SessionUpload.NEVER)
        queue.enqueue(queued())
        assertFalse(queue.drain("p1"))
        assertEquals(VideoUploadState.FAILED,queue.list("p1").single().state)
    }

    @Test fun aDroppedConnectionIsRetriedWithTheSameVideoId()=runBlocking {
        val server=Server()
        server.fail={if(it=="media") IOException("dropped") else null}
        val queue=uploads(FileVideoQueueStore(folder),server)
        queue.enqueue(queued())
        assertTrue(queue.drain("p1"))
        server.fail={null}
        assertFalse(queue.drain("p1"))
        assertEquals(listOf("start","media","start","media","preview","share"),server.calls)
    }

    @Test fun aRefusalStopsTheQueueForThatVideoAndSaysWhy()=runBlocking {
        val server=Server()
        server.fail={if(it=="share") RemoteFailure(400,"video_too_large") else null}
        val queue=uploads(FileVideoQueueStore(folder),server)
        queue.enqueue(queued())
        assertFalse(queue.drain("p1"))
        val failed=queue.list("p1").single()
        assertEquals(VideoUploadState.FAILED,failed.state); assertEquals("video_too_large",failed.reason)
        server.calls.clear()
        assertFalse(queue.drain("p1"))
        assertTrue(server.calls.isEmpty())
        // Try again puts it back.
        server.fail={null}
        queue.retry("p1","v1")
        assertFalse(queue.drain("p1"))
        assertTrue(queue.list("p1").isEmpty())
    }

    @Test fun aRateLimitAndAMissingTherapistAreRefusalsButAServerErrorIsRetried()=runBlocking {
        val server=Server()
        val queue=uploads(FileVideoQueueStore(folder),server)
        server.fail={RemoteFailure(503)}
        queue.enqueue(queued())
        assertTrue(queue.drain("p1"))
        server.fail={RemoteFailure(400,"video_rate_limited")}
        assertFalse(queue.drain("p1"))
        assertEquals("video_rate_limited",queue.list("p1").single().reason)
        assertTrue("video_unavailable" in VideoUploads.REFUSALS)
    }

    @Test fun cancellingAWaitingUploadRemovesItAndItsCopy()=runBlocking {
        val server=Server()
        val queue=uploads(FileVideoQueueStore(folder),server)
        val video=queued()
        queue.enqueue(video)
        queue.cancel("p1","v1")
        assertFalse(queue.drain("p1"))
        assertTrue(server.calls.isEmpty())
        assertFalse(File(video.file).exists()); assertFalse(File(video.preview).exists())
    }

    @Test fun theQueueSurvivesARestart()=runBlocking {
        uploads(FileVideoQueueStore(folder),Server()).enqueue(queued())
        // A new store over the same files is what the job finds after the app closes or the phone restarts.
        val server=Server()
        val restarted=uploads(FileVideoQueueStore(folder),server)
        assertEquals("s1",restarted.list("p1").single().sessionId)
        assertFalse(restarted.drain("p1"))
        assertEquals("share",server.calls.last())
    }

    @Test fun eachAccountsVideosStayApart()=runBlocking {
        val store=FileVideoQueueStore(folder)
        val queue=uploads(store,Server())
        queue.enqueue(queued("v1",owner="p1")); queue.enqueue(queued("v2",owner="p2"))
        queue.clear("p1")
        assertTrue(queue.list("p1").isEmpty())
        assertEquals(1,queue.list("p2").size)
    }
}
