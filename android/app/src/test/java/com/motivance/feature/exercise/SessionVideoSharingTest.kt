package com.motivance.feature.exercise

import com.motivance.R
import com.motivance.data.local.ChatMediaStore
import com.motivance.data.local.MediaProblem
import com.motivance.data.remote.SessionVideoJson
import com.motivance.data.remote.SupabaseAuthRepository
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

/** Sharing a session video with the therapist (#129): the phone's steps, its refusals, and the calls it makes. */
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

    @Test fun sharingMakesItSmallerSendsBothFilesThenShares()=runTest(dispatcher) {
        val remote=FakeVideos(); val toasts=Toaster()
        val vm=SessionVideoViewModel(remote,FakeMedia(),toasts)
        vm.share("p1",video)
        assertEquals("content://gallery/1",vm.state.value.sending)
        advanceUntilIdle()
        // A both-sides run has one recording: it goes with the first side's session.
        assertEquals(listOf("start s1 480x270 95000","upload media.mp4 video/mp4 5","upload preview.jpg image/jpeg 2","share"),remote.steps)
        assertNotNull(vm.state.value.shared["s1"])
        assertNull(vm.state.value.sending)
        assertEquals(R.string.video_shared,toasts.current.value?.message)
    }

    @Test fun aSessionStillUploadingSaysSoAndNothingIsShared()=runTest(dispatcher) {
        val remote=FakeVideos("video_session_missing"); val toasts=Toaster()
        val vm=SessionVideoViewModel(remote,FakeMedia(),toasts)
        vm.share("p1",video); advanceUntilIdle()
        assertTrue(vm.state.value.shared.isEmpty())
        assertEquals(R.string.video_share_error_uploading,toasts.current.value?.message)
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
        val remote=FakeVideos()
        val vm=SessionVideoViewModel(remote,FakeMedia(),Toaster())
        vm.share("p1",video); advanceUntilIdle()
        vm.stop(vm.state.value.shared.getValue("s1")); advanceUntilIdle()
        assertTrue(vm.state.value.shared.isEmpty())
        assertTrue(remote.steps.last().startsWith("stop "))
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
