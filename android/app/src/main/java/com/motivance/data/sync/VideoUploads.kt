package com.motivance.data.sync

import android.content.Context
import androidx.work.*
import com.motivance.data.local.SessionStore
import com.motivance.domain.RemoteFailure
import com.motivance.domain.SessionVideoRepository
import com.motivance.domain.SharedVideo
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject

/**
 * Session videos waiting to go to the therapist (#175). The smaller copy is made before queueing and kept in the app's own files,
 * so the gallery video can change without affecting it. A queued video goes up once there is a connection and once that
 * session's own result has uploaded, retries with backoff, and survives the app closing or the phone restarting. A refusal
 * from the server stops it and says why. The same rules as web/src/features/exercise/video/uploadQueue.ts.
 */
enum class VideoUploadState { WAITING, UPLOADING, FAILED }

data class QueuedVideo(
    val id:String,val owner:String,val sessionId:String,val file:String,val preview:String,val width:Int,val height:Int,val durationMs:Long,
    val state:VideoUploadState=VideoUploadState.WAITING,val progress:Float=0f,val reason:String?=null,val createdAt:Long=System.currentTimeMillis(),
)

interface VideoQueueStore {
    fun all(owner:String):List<QueuedVideo>
    fun put(video:QueuedVideo)
    fun remove(owner:String,id:String)
}

/** What the screens watch: a change to anyone's queue, and each video once it is shared. */
object VideoQueueEvents {
    private val version=MutableStateFlow(0L)
    val changed=version.asStateFlow()
    private val sharedVideos=MutableSharedFlow<SharedVideo>(extraBufferCapacity=8)
    val shared=sharedVideos.asSharedFlow()
    fun touch() {version.value=version.value+1}
    fun announce(video:SharedVideo) {sharedVideos.tryEmit(video)}
}

/** One JSON file per account in the app's private files, beside the queued copies themselves. */
class FileVideoQueueStore(private val folder:File):VideoQueueStore {
    private fun file(owner:String)=File(folder,"queue-${owner.filter {it.isLetterOrDigit() || it=='-'}}.json")
    @Synchronized override fun all(owner:String):List<QueuedVideo> = runCatching {
        val rows=JSONArray(file(owner).takeIf {it.exists()}?.readText() ?: return emptyList())
        (0 until rows.length()).map {i -> rows.getJSONObject(i).let {j ->
            QueuedVideo(j.getString("id"),j.getString("owner"),j.getString("sessionId"),j.getString("file"),j.getString("preview"),j.getInt("width"),j.getInt("height"),
                j.getLong("durationMs"),runCatching {VideoUploadState.valueOf(j.getString("state"))}.getOrDefault(VideoUploadState.WAITING),
                j.optDouble("progress",0.0).toFloat(),if(j.isNull("reason")) null else j.getString("reason"),j.optLong("createdAt"))
        }}
    }.getOrDefault(emptyList())
    @Synchronized override fun put(video:QueuedVideo) {write(video.owner,all(video.owner).filter {it.id!=video.id}+video)}
    @Synchronized override fun remove(owner:String,id:String) {write(owner,all(owner).filter {it.id!=id})}
    private fun write(owner:String,videos:List<QueuedVideo>) {
        folder.mkdirs()
        val rows=JSONArray()
        videos.forEach {rows.put(JSONObject().put("id",it.id).put("owner",it.owner).put("sessionId",it.sessionId).put("file",it.file).put("preview",it.preview)
            .put("width",it.width).put("height",it.height).put("durationMs",it.durationMs).put("state",it.state.name).put("progress",it.progress.toDouble())
            .put("reason",it.reason ?: JSONObject.NULL).put("createdAt",it.createdAt))}
        // Written whole and then moved, so a phone that dies mid-write keeps the last good queue.
        val next=File(folder,file(owner).name+".tmp")
        next.writeText(rows.toString())
        if(!next.renameTo(file(owner))) {file(owner).delete(); next.renameTo(file(owner))}
    }
}

/** Where the session's own result stands, which a video must wait for (`video_session_missing`). */
enum class SessionUpload { UPLOADED, WAITING, NEVER }

class VideoUploads(
    private val store:VideoQueueStore,private val remote:SessionVideoRepository,
    private val session:suspend (owner:String,sessionId:String)->SessionUpload,
    private val read:suspend (path:String)->ByteArray,
) {
    companion object {
        /** These answers will not change by trying again, so the video stops and the patient is told why. */
        val REFUSALS=setOf("video_too_large","video_unavailable","video_rate_limited","video_already_shared","video_invalid","video_duration","video_not_owner")
    }

    fun list(owner:String)=store.all(owner).sortedBy {it.createdAt}

    fun enqueue(video:QueuedVideo) {store.put(video.copy(state=VideoUploadState.WAITING,progress=0f,reason=null)); VideoQueueEvents.touch()}

    /** A waiting upload is cancelled: it leaves the queue and its copy is deleted. The gallery video stays. */
    fun cancel(owner:String,id:String) {
        store.all(owner).firstOrNull {it.id==id}?.let {deleteFiles(it)}
        store.remove(owner,id); VideoQueueEvents.touch()
    }

    fun retry(owner:String,id:String) {
        store.all(owner).firstOrNull {it.id==id}?.let {store.put(it.copy(state=VideoUploadState.WAITING,reason=null,progress=0f))}
        VideoQueueEvents.touch()
    }

    /** Everything this account has waiting is removed, as on sign-out. */
    fun clear(owner:String) {store.all(owner).forEach {cancel(owner,it.id)}}

    private fun deleteFiles(video:QueuedVideo) {runCatching {File(video.file).delete()}; runCatching {File(video.preview).delete()}}

    /** Returns true when something still waits, so the job runs again later with backoff. */
    suspend fun drain(owner:String):Boolean {
        var later=false
        for(item in list(owner)) {
            if(item.state==VideoUploadState.FAILED) continue
            when(session(owner,item.sessionId)) {
                SessionUpload.WAITING -> {later=true; continue}
                SessionUpload.NEVER -> {store.put(item.copy(state=VideoUploadState.FAILED,reason="video_session_missing")); VideoQueueEvents.touch(); continue}
                SessionUpload.UPLOADED -> Unit
            }
            fun save(change:QueuedVideo) {if(store.all(owner).any {it.id==item.id}) {store.put(change); VideoQueueEvents.touch()}}
            fun gone()=store.all(owner).none {it.id==item.id}
            try {
                save(item.copy(state=VideoUploadState.UPLOADING,progress=.05f))
                // The same ID again is safe, so a retry after a dropped connection carries on where it stopped.
                val places=remote.startSessionVideoAs(owner,item.id,item.sessionId,item.width,item.height,item.durationMs)
                save(item.copy(state=VideoUploadState.UPLOADING,progress=.15f))
                remote.uploadSessionVideo(places.mediaPath,read(item.file),"video/mp4")
                save(item.copy(state=VideoUploadState.UPLOADING,progress=.9f))
                remote.uploadSessionVideo(places.previewPath,read(item.preview),"image/jpeg")
                if(gone()) continue
                val shared=remote.shareSessionVideo(item.id)
                store.remove(owner,item.id)
                deleteFiles(item)
                VideoQueueEvents.announce(shared)
                VideoQueueEvents.touch()
            } catch(e:CancellationException) {throw e}
            catch(e:Exception) {
                val code=(e as? RemoteFailure)?.code
                when {
                    code in REFUSALS -> save(item.copy(state=VideoUploadState.FAILED,progress=0f,reason=code))
                    e is RemoteFailure && !e.retryable && !e.authenticationRequired && code!="video_session_missing" ->
                        save(item.copy(state=VideoUploadState.FAILED,progress=0f,reason=code ?: "http_${e.status}"))
                    else -> {later=true; save(item.copy(state=VideoUploadState.WAITING,progress=0f))}
                }
            }
        }
        return later
    }
}

@EntryPoint @InstallIn(SingletonComponent::class)
interface VideoUploadServices {fun sessionStore():SessionStore; fun sessionVideoRepository():SessionVideoRepository}

/** The session result's place in this phone's own outbox. A session not in it was not made here, so the server decides. */
suspend fun sessionUploadOf(store:SessionStore,owner:String,sessionId:String):SessionUpload {
    val entry=store.dao.outbox(owner).firstOrNull {it.sessionId==sessionId} ?: return SessionUpload.UPLOADED
    return when(entry.state) {
        "SYNCED" -> SessionUpload.UPLOADED
        "REJECTED","FAILED" -> SessionUpload.NEVER
        else -> SessionUpload.WAITING
    }
}

fun videoQueueFolder(context:Context)=File(context.filesDir,"session-video-queue")

fun videoUploads(context:Context):VideoUploads {
    val services=EntryPointAccessors.fromApplication(context.applicationContext,VideoUploadServices::class.java)
    val store=services.sessionStore()
    return VideoUploads(FileVideoQueueStore(videoQueueFolder(context)),services.sessionVideoRepository(),
        {owner,id -> sessionUploadOf(store,owner,id)},{path -> File(path).readBytes()})
}

class VideoUploadWorker(context:Context,parameters:WorkerParameters):CoroutineWorker(context,parameters) {
    override suspend fun doWork():Result {
        val owner=inputData.getString("owner") ?: return Result.failure()
        return try {
            if(videoUploads(applicationContext).drain(owner)) Result.retry() else Result.success()
        } catch(e:CancellationException) {throw e}
        catch(_:IOException) {Result.retry()}
        catch(_:Exception) {if(runAttemptCount<20) Result.retry() else Result.failure()}
    }
}

object VideoUploadScheduler {
    fun schedule(context:Context,owner:String) {
        if(runCatching {UUID.fromString(owner)}.isFailure) return
        val request=OneTimeWorkRequestBuilder<VideoUploadWorker>().setInputData(workDataOf("owner" to owner))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.SECONDS).build()
        // A new video joins after the one running, rather than replacing it.
        WorkManager.getInstance(context).enqueueUniqueWork("video-upload-$owner",ExistingWorkPolicy.APPEND_OR_REPLACE,request)
    }
}

/** What the screens need of the queue. The app's own uses the phone's files and WorkManager; tests use their own. */
interface VideoQueueService {
    fun list(owner:String):List<QueuedVideo>
    /** Where a queued copy is kept: the app's private files, never the gallery. */
    fun folder(owner:String):File
    fun enqueue(video:QueuedVideo)
    fun cancel(owner:String,id:String)
    fun retry(owner:String,id:String)
    fun schedule(owner:String)
}

class AppVideoQueue @javax.inject.Inject constructor(@dagger.hilt.android.qualifiers.ApplicationContext private val context:Context):VideoQueueService {
    private val uploads by lazy {videoUploads(context)}
    override fun list(owner:String)=uploads.list(owner)
    override fun folder(owner:String)=File(videoQueueFolder(context),owner).apply {mkdirs()}
    override fun enqueue(video:QueuedVideo)=uploads.enqueue(video)
    override fun cancel(owner:String,id:String)=uploads.cancel(owner,id)
    override fun retry(owner:String,id:String)=uploads.retry(owner,id)
    override fun schedule(owner:String)=VideoUploadScheduler.schedule(context,owner)
}
