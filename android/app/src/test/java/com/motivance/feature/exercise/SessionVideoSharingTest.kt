package com.motivance.feature.exercise

import com.motivance.R
import com.motivance.data.local.ChatMediaStore
import com.motivance.data.local.MediaProblem
import com.motivance.data.remote.SessionVideoJson
import com.motivance.data.remote.SupabaseAuthRepository
import com.motivance.data.sync.QueuedVideo
import com.motivance.data.sync.VideoQueueService
import com.motivance.designsystem.Toaster
import com.motivance.domain.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import androidx.lifecycle.viewModelScope

/** Sharing a session video with the therapist (#129, #175): queueing the smaller copy, its refusals, and the calls it makes. */
@OptIn(ExperimentalCoroutinesApi::class)
class SessionVideoSharingTest {
    private val dispatcher=StandardTestDispatcher()
    @Before fun setup() {Dispatchers.setMain(dispatcher)}
    @After fun teardown() {Dispatchers.resetMain()}

    private val row="""{"id":"v1","session_id":"s1","patient_id":"p1","therapist_id":"t1","width":480,"height":270,"duration_ms":95000,
        "media_path":"p1/v1/media.mp4","preview_path":"p1/v1/preview.jpg","shared_at":"2026-11-18T01:00:00Z","expires_at":"2026-12-03T01:00:00Z"}"""

    private class FakeVideos(var refuse:String?=null):SessionVideoRepository {
        val steps=mutableListOf<String>()
        override suspend fun loadSharedVideos(patientId:String)=emptyList<SharedVideo>()
        override suspend fun startSessionVideo(id:String,sessionId:String,width:Int,height:Int,durationMs:Long):MediaPlaces {
            refuse?.let {throw RemoteFailure(400,it)}
            steps+="start $sessionId ${width}x$height $durationMs"; return MediaPlaces("p1/$id/media.mp4","p1/$id/preview.jpg")
        }
        override suspend fun uploadSessionVideo(path:String,bytes:ByteArray,mime:String) {steps+="upload ${path.substringAfterLast('/')} $mime ${bytes.size}"}
        override suspend fun shareSessionVideo(id:String):SharedVideo {steps+="share"; return SharedVideo(id,"s1","p1","t1",480,270,95000,"m","p","2026-11-18T01:00:00Z","2026-12-03T01:00:00Z")}
        override suspend fun stopSharingVideo(id:String) {steps+="stop $id"}
        override suspend fun sessionVideoLink(path:String,seconds:Int)="https://fixture.invalid/$path"
    }
    private class FakeMedia(val fail:Boolean=false):ChatMediaStore {
        override suspend fun prepare(owner:String,uri:String,onProgress:(Float)->Unit)=throw UnsupportedOperationException()
        override suspend fun prepareSessionVideo(owner:String,uri:String,onProgress:(Float)->Unit):MediaDraft {
            if(fail) throw MediaProblem("chat_media_unreadable")
            onProgress(.5f)
            return MediaDraft(MediaKind.VIDEO,"/nowhere/v.mp4","video/mp4","/nowhere/v-preview.jpg",480,270,95_000)
        }
        override suspend fun read(path:String)=if(path.endsWith("preview.jpg")) ByteArray(2) else ByteArray(5)
        override suspend fun keep(owner:String,id:String,draft:MediaDraft) {}
        override suspend fun discard(draft:MediaDraft) {}
        override suspend fun copy(owner:String,id:String,attachment:Attachment,preview:Boolean,link:suspend (String)->String):String?=null
    }
    private val video=SessionVideo("content://gallery/1",listOf("s1","s2"),0)

    /** The queue in memory, with its copies in a temporary folder. */
    private class FakeQueue:VideoQueueService {
        val items=mutableListOf<QueuedVideo>(); val scheduled=mutableListOf<String>()
        val root:java.io.File=kotlin.io.path.createTempDirectory("queue").toFile()
        override fun list(owner:String)=items.filter {it.owner==owner}
        override fun folder(owner:String)=java.io.File(root,owner).apply {mkdirs()}
        override fun enqueue(video:QueuedVideo) {items+=video}
        override fun cancel(owner:String,id:String) {items.removeAll {it.id==id}}
        override fun retry(owner:String,id:String) {}
        override fun schedule(owner:String) {scheduled+=owner}
    }
    /** Makes real temporary files, as the phone's preparation does, so they can be moved into the queue's folder. */
    private class TempMedia:ChatMediaStore {
        override suspend fun prepare(owner:String,uri:String,onProgress:(Float)->Unit)=throw UnsupportedOperationException()
        override suspend fun prepareSessionVideo(owner:String,uri:String,onProgress:(Float)->Unit):MediaDraft {
            onProgress(.5f)
            val file=java.io.File.createTempFile("video",".mp4").apply {writeBytes(ByteArray(5))}
            val preview=java.io.File.createTempFile("preview",".jpg").apply {writeBytes(ByteArray(2))}
            return MediaDraft(MediaKind.VIDEO,file.path,"video/mp4",preview.path,480,270,95_000)
        }
        override suspend fun read(path:String)=java.io.File(path).readBytes()
        override suspend fun keep(owner:String,id:String,draft:MediaDraft) {}
        override suspend fun discard(draft:MediaDraft) {}
        override suspend fun copy(owner:String,id:String,attachment:Attachment,preview:Boolean,link:suspend (String)->String):String?=null
    }

    @Test fun uploadMakesTheSmallerCopyFirstThenQueuesItForTheFirstSide()=runTest(dispatcher) {
        val queue=FakeQueue(); val toasts=Toaster()
        val vm=SessionVideoViewModel(FakeVideos(),TempMedia(),toasts,queue)
        vm.upload("p1",video)
        assertEquals("content://gallery/1",vm.state.value.sending)
        // The copies move on the IO thread, which the test clock does not run.
        repeat(100) {advanceUntilIdle(); if(queue.items.isNotEmpty() && vm.state.value.sending==null) return@repeat; Thread.sleep(20)}
        advanceUntilIdle()
        // A both-sides run has one recording: it goes with the first side's session, and nothing is sent from here.
        assertNull("toast: ${toasts.current.value?.message}",toasts.current.value)
        val queued=queue.items.single()
        assertEquals("s1",queued.sessionId); assertEquals(480,queued.width); assertEquals(95_000L,queued.durationMs)
        assertTrue(java.io.File(queued.file).exists() && queued.file.startsWith(queue.root.path))
        assertTrue(java.io.File(queued.preview).exists())
        assertTrue("p1" in queue.scheduled)
        assertNull(vm.state.value.sending)
        // The queue's events are shared by the whole app, so this screen stops listening before the next test.
        vm.viewModelScope.cancel()
    }

    @Test fun aVideoThatCannotBeMadeSmallerSaysSoAndIsNotQueued()=runTest(dispatcher) {
        val queue=FakeQueue(); val toasts=Toaster()
        val vm=SessionVideoViewModel(FakeVideos(),FakeMedia(fail=true),toasts,queue)
        vm.upload("p1",video); advanceUntilIdle()
        assertTrue(queue.items.isEmpty())
        assertEquals(R.string.video_share_error_prepare,toasts.current.value?.message)
    }

    @Test fun eachRefusalHasItsOwnWords() {
        assertEquals(R.string.video_share_error_no_therapist,videoRefusal(RemoteFailure(403,"video_unavailable")))
        assertEquals(R.string.video_share_error_already,videoRefusal(RemoteFailure(400,"video_already_shared")))
        assertEquals(R.string.video_share_error_too_large,videoRefusal(RemoteFailure(400,"video_too_large")))
        assertEquals(R.string.video_share_error_rate,videoRefusal(RemoteFailure(400,"video_rate_limited")))
        assertEquals(R.string.video_share_error_prepare,videoRefusal(MediaProblem("chat_media_unreadable")))
        assertEquals(R.string.connected_failed,videoRefusal(RemoteFailure(500)))
    }

    @Test fun stoppingRemovesItFromWhatIsShown()=runTest(dispatcher) {
        val remote=object:SessionVideoRepository by FakeVideos() {
            val stopped=mutableListOf<String>()
            override suspend fun loadSharedVideos(patientId:String)=listOf(SessionVideoJson.video(JSONObject(row)))
            override suspend fun stopSharingVideo(id:String) {stopped+=id}
        }
        val vm=SessionVideoViewModel(remote,FakeMedia(),Toaster(),FakeQueue())
        vm.load("p1"); advanceUntilIdle()
        vm.stop(vm.state.value.shared.getValue("s1")); advanceUntilIdle()
        assertTrue(vm.state.value.shared.isEmpty())
        assertEquals(listOf("v1"),remote.stopped)
    }

    @Test fun eachQueuedRefusalHasItsOwnWords() {
        assertEquals(R.string.video_share_error_rate,queueRefusal("video_rate_limited"))
        assertEquals(R.string.video_share_error_too_large,queueRefusal("video_too_large"))
        assertEquals(R.string.video_share_error_no_therapist,queueRefusal("video_unavailable"))
        assertEquals(R.string.connected_failed,queueRefusal(null))
    }

    @Test fun aLongSessionSharesItsFirstFiveMinutes() {
        val plan=sessionVideoPlan(1280,720,600_000)
        // The chat size: the long side within 854, the short side 480, kept even for the encoder.
        assertTrue(plan.width<=854 && plan.width%2==0); assertEquals(480,plan.height)
        assertEquals(300_000,plan.durationMs); assertTrue(plan.trimmed)
        assertFalse(sessionVideoPlan(1280,720,120_000).trimmed)
    }

    @Test fun readsASharedVideoAsTheServerWritesIt() {
        val read=SessionVideoJson.video(JSONObject(row))
        assertEquals("s1",read.sessionId); assertEquals(95_000L,read.durationMs); assertEquals("2026-12-03T01:00:00Z",read.expiresAt)
    }

    @Test fun theRepositoryUsesTheVideoBucketAndNamesRefusals()=runBlocking {
        val sent=mutableListOf<String>()
        val client=OkHttpClient.Builder().addInterceptor {chain ->
            val request=chain.request(); val path=request.url.encodedPath; sent+="${request.method} $path"
            val (code,body)=when {
                path.endsWith("user_roles") -> 200 to """[{"role":"patient"}]"""
                path.endsWith("start_session_video") -> 200 to """{"media_path":"10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000002/media.mp4","preview_path":"10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000002/preview.jpg"}"""
                path.endsWith("share_session_video") -> 200 to """{"refused":"video_too_large"}"""
                path.contains("/storage/v1/object/sign/") -> 200 to """{"signedURL":"/object/sign/session-videos/x?token=t"}"""
                path.contains("/storage/") -> 200 to "{}"
                else -> 200 to """{"access_token":"fixture-access","refresh_token":"fixture-refresh","user":{"id":"fixture-owner"}}"""
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code).message("fixture").body(body.toResponseBody("application/json".toMediaType())).build()
        }.build()
        val repo=SupabaseAuthRepository(client,"https://fixture.invalid","public-fixture")
        repo.signIn("fixture@example.test","fixture-password")
        val places=repo.startSessionVideo("v","s",480,270,1000)
        repo.uploadSessionVideo(places.mediaPath,ByteArray(3),"video/mp4")
        assertTrue(sent.any {it=="POST /storage/v1/object/session-videos/${places.mediaPath}"})
        assertTrue(repo.sessionVideoLink(places.mediaPath).startsWith("https://fixture.invalid/storage/v1/object/sign/session-videos/"))
        assertEquals("video_too_large",(runCatching {repo.shareSessionVideo("v")}.exceptionOrNull() as RemoteFailure).code)
        // A path the server did not issue is never sent.
        assertTrue(runCatching {repo.uploadSessionVideo("../avatars/x.webp",ByteArray(1),"video/mp4")}.isFailure)
    }
}
