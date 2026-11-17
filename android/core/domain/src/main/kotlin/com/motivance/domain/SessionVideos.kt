package com.motivance.domain

/**
 * Session videos shared with the therapist (#129). A recording stays on the phone (#114) until the patient chooses, for that one
 * session, to let their therapist see it. It is then made smaller and uploaded, and the server keeps it for 15 days or until the
 * patient stops sharing it. Mirrors web/src/data/sessionVideos.ts and the server's session_video_* limits.
 */
object SessionVideoLimits {
    const val VIDEO=20_971_520L
    const val PREVIEW=204_800L
    /** The first five minutes are shared; a longer session's video is cut there. */
    const val VIDEO_MS=300_000L
    /** About 500 kbps at 480p keeps five minutes well inside the 20 MB limit. */
    const val VIDEO_BITS=500_000
    const val DAYS=15
    const val LINK_SECONDS=300
}

/** A video the patient shared for one session, while the server keeps it. */
data class SharedVideo(
    val id:String,val sessionId:String,val patientId:String,val therapistId:String,val width:Int,val height:Int,val durationMs:Long,
    val mediaPath:String,val previewPath:String,val sharedAt:String,val expiresAt:String,
)

/** What a video becomes for sharing: the chat size, and its first five minutes. */
fun sessionVideoPlan(width:Int,height:Int,durationMs:Long):VideoPlan=videoPlan(width,height,durationMs,SessionVideoLimits.VIDEO_MS)

interface SessionVideoRepository {
    /** The videos shared for one patient. The server shows them only to the patient and the exercise's therapist. */
    suspend fun loadSharedVideos(patientId:String):List<SharedVideo>
    /** Step one: the server agrees to the file and names where it and its preview go. The same ID again is safe. */
    suspend fun startSessionVideo(id:String,sessionId:String,width:Int,height:Int,durationMs:Long):MediaPlaces
    /** A file already there from an earlier try counts as stored. */
    suspend fun uploadSessionVideo(path:String,bytes:ByteArray,mime:String)
    /** Step two, once both files are stored: shared for 15 days. A file over its limit is refused and removed. */
    suspend fun shareSessionVideo(id:String):SharedVideo
    suspend fun stopSharingVideo(id:String)
    /** A short-lived link to watch, issued only while the video is shared. */
    suspend fun sessionVideoLink(path:String,seconds:Int=SessionVideoLimits.LINK_SECONDS):String
}
