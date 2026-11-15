package com.motivance.feature.exercise

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.HandlerThread
import android.provider.MediaStore
import android.util.Log
import android.view.Surface
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import com.motivance.assessment.*
import com.motivance.designsystem.Motion
import com.motivance.domain.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/** One frame of a recording: exactly what the session screen drew from, and the words along its bottom. */
internal data class VideoFrame(val bitmap:Bitmap,val points:List<Landmark>,val mirrored:Boolean,val rules:ExerciseRules,
    val quality:TrackingQuality,val angle:Double?,val caption:String)

/** A recording kept in the phone's gallery, and the sessions it shows: one per side of a set. */
data class SessionVideo(val uri:String,val sessions:List<String>,val at:Long)

/** The size a recording is encoded at: the frame's own, no longer than 1280 on its long side, in even pixels as encoders need. */
internal fun videoSize(width:Int,height:Int):Pair<Int,Int> {
    val scale=minOf(1.0,1280.0/maxOf(width,height))
    fun even(value:Double)=maxOf(2,(value.toInt()/2)*2)
    return even(width*scale) to even(height*scale)
}

/** About 0.1 bits a pixel at 30 frames a second, kept between 1 and 4 Mbit/s. */
internal fun videoBitrate(width:Int,height:Int)=(width*height*3L).coerceIn(1_000_000,4_000_000).toInt()

/** The gallery's file name for a recording made at [at]. */
internal fun videoName(at:Long)="Motivance-session-${java.text.SimpleDateFormat("yyyyMMdd-HHmmss",java.util.Locale.ROOT).format(java.util.Date(at))}.mp4"

/** Draws a recorded frame the way [SkeletonPreview] draws it on screen: the camera picture, the body, and the protractor at the measured joint. */
internal object VideoOverlay {
    private val night=Motion.Night.toArgb()
    private val mint=Motion.SproutBright.toArgb()
    private val amber=Motion.NightCaution.toArgb()
    private val ink=Motion.NightInk.toArgb()
    private val shade=Color(0xCC021418).toArgb()
    private val white=android.graphics.Color.WHITE
    private fun alpha(color:Int,share:Float)=(color and 0x00FFFFFF) or ((share*255).toInt().coerceIn(0,255) shl 24)

    fun draw(canvas:Canvas,frame:VideoFrame,width:Int,height:Int) {
        canvas.drawColor(night)
        val bitmap=frame.bitmap
        val mapping=PreviewMapping(bitmap.width,bitmap.height,width.toFloat(),height.toFloat(),frame.mirrored)
        val filter=Paint(Paint.FILTER_BITMAP_FLAG)
        canvas.save()
        if(frame.mirrored) {canvas.translate(width.toFloat(),0f); canvas.scale(-1f,1f)}
        canvas.drawBitmap(bitmap,null,RectF(mapping.left,mapping.top,mapping.left+mapping.width,mapping.top+mapping.height),filter)
        canvas.restore()
        // One unit is a dp on a phone about 360 dp wide, so the overlay keeps its on-screen proportions.
        val unit=width/360f
        val rules=frame.rules
        val points=frame.points
        val ready=frame.quality==TrackingQuality.READY
        val focus=if(frame.quality==TrackingQuality.TRUNK_LEAN) amber else mint
        val showBody=frame.quality !in setOf(TrackingQuality.MULTIPLE_PEOPLE,TrackingQuality.NO_PERSON,TrackingQuality.PAUSED)
        val stroke=Paint(Paint.ANTI_ALIAS_FLAG).apply {style=Paint.Style.STROKE; strokeCap=Paint.Cap.ROUND}
        val fill=Paint(Paint.ANTI_ALIAS_FLAG).apply {style=Paint.Style.FILL}
        fun line(color:Int,a:Pair<Float,Float>,b:Pair<Float,Float>,widthDp:Float) {
            stroke.color=color; stroke.strokeWidth=widthDp*unit; stroke.pathEffect=null
            canvas.drawLine(a.first,a.second,b.first,b.second,stroke)
        }
        if(showBody) {
            fun visible(index:Int)=points.getOrNull(index)?.let {it.x.isFinite() && it.y.isFinite() && it.visibility.isFinite() &&
                it.visibility>=rules.confidence && it.x in 0f..1f && it.y in 0f..1f}==true
            fun at(index:Int)=mapping.map(points[index])
            val chain=rules.focusJoint.chain(rules.side)
            val selectedJoint=rules.focusJoint.landmark(rules.side)
            val protractor=if(ready) MeasurementOverlay.protractor(points,rules,bitmap.width,bitmap.height,48.0*unit/(mapping.width/bitmap.width)) else null
            val measured=rules.measurementChain().let {listOf(it.proximal to it.vertex,it.vertex to it.distal)}
            SkeletonBones.forEach {(a,b) -> if(visible(a) && visible(b)) {
                val selected=a in chain && b in chain
                val measuring=protractor!=null && !selected && measured.any {(x,y) -> (x==a && y==b) || (x==b && y==a)}
                val color=when {selected -> focus; measuring -> alpha(white,.9f); else -> alpha(ink,.65f)}
                val w=if(selected) 4f else if(measuring) 3f else 2f
                line(shade,at(a),at(b),w+3f); line(color,at(a),at(b),w)
            }}
            (listOf(0)+(11..32)).forEach {index -> if(visible(index)) {
                val selected=index in chain
                val radius=(if(selected) 5f else 2.5f)*unit
                val (x,y)=at(index)
                fill.color=alpha(night,.85f); canvas.drawCircle(x,y,radius+2*unit,fill)
                fill.color=if(selected) focus else ink; canvas.drawCircle(x,y,radius,fill)
                if(selected) {stroke.color=white; stroke.strokeWidth=1.5f*unit; canvas.drawCircle(x,y,radius,stroke)}
            }}
            if(visible(selectedJoint)) {
                val (x,y)=at(selectedJoint)
                fill.color=alpha(focus,.12f); canvas.drawCircle(x,y,16*unit,fill)
                stroke.color=focus; stroke.strokeWidth=1.5f*unit; canvas.drawCircle(x,y,12*unit,stroke)
            }
            protractor?.let {drawProtractor(canvas,it,mapping,rules,frame.angle,unit,width,height)}
        }
        // The caption: what was measured, the angle and the count, as the screen showed them.
        val text=Paint(Paint.ANTI_ALIAS_FLAG).apply {color=white; textSize=14*unit; isFakeBoldText=true}
        val band=28*unit
        fill.color=shade; canvas.drawRect(0f,height-band,width.toFloat(),height.toFloat(),fill)
        canvas.drawText(frame.caption,12*unit,height-band/2-(text.ascent()+text.descent())/2,text)
    }

    private fun drawProtractor(canvas:Canvas,p:Protractor,mapping:PreviewMapping,rules:ExerciseRules,angle:Double?,unit:Float,width:Int,height:Int) {
        fun o(point:FramePoint)=mapping.map(point.landmark())
        fun polyline(list:List<FramePoint>)=Path().apply {list.firstOrNull()?.let {val s=o(it); moveTo(s.first,s.second)}; list.drop(1).forEach {val q=o(it); lineTo(q.first,q.second)}}
        val paint=Paint(Paint.ANTI_ALIAS_FLAG).apply {style=Paint.Style.STROKE}
        fun stroke(color:Int,w:Float,cap:Paint.Cap=Paint.Cap.ROUND,dash:Boolean=false) = paint.apply {
            this.color=color; strokeWidth=w*unit; strokeCap=cap; pathEffect=if(dash) DashPathEffect(floatArrayOf(6*unit,5*unit),0f) else null
        }
        val vertex=o(p.vertex); val reference=o(p.referenceEnd)
        canvas.drawLine(vertex.first,vertex.second,reference.first,reference.second,stroke(shade,3.5f))
        canvas.drawLine(vertex.first,vertex.second,reference.first,reference.second,stroke(alpha(white,.8f),1.5f,dash=true))
        canvas.drawPath(polyline(p.startZone),stroke(alpha(ink,.45f),7f,Paint.Cap.BUTT))
        canvas.drawPath(polyline(p.targetZone),stroke(alpha(mint,.5f),7f,Paint.Cap.BUTT))
        val measured=angle ?: p.rawAngleDegrees
        val arc=when {measured>=rules.highDegrees -> mint; measured<=rules.lowDegrees -> ink; else -> white}
        canvas.drawPath(polyline(p.measuredArc),stroke(shade,5f))
        canvas.drawPath(polyline(p.measuredArc),stroke(arc,2.5f))
        listOf(p.lowTick,p.highTick).forEach {(a,b) ->
            val (ax,ay)=o(a); val (bx,by)=o(b)
            canvas.drawLine(ax,ay,bx,by,stroke(shade,4f)); canvas.drawLine(ax,ay,bx,by,stroke(white,2f))
        }
        fun chip(words:String,at:Pair<Float,Float>,background:Int,foreground:Int,bold:Boolean=false) {
            val text=Paint(Paint.ANTI_ALIAS_FLAG).apply {color=foreground; textSize=11*unit; isFakeBoldText=bold}
            val pad=4*unit
            val w=text.measureText(words)+pad*2; val h=text.descent()-text.ascent()+pad
            val left=(at.first-w/2).coerceIn(0f,(width-w).coerceAtLeast(0f)); val top=(at.second-h/2).coerceIn(0f,(height-h).coerceAtLeast(0f))
            canvas.drawRoundRect(RectF(left,top,left+w,top+h),h/2,h/2,Paint(Paint.ANTI_ALIAS_FLAG).apply {color=background})
            canvas.drawText(words,left+pad,top+pad/2-text.ascent(),text)
        }
        chip("${rules.lowDegrees.toInt()}°",o(p.lowLabel),alpha(night,.85f),ink)
        chip("${rules.highDegrees.toInt()}°",o(p.highLabel),alpha(night,.85f),mint)
        chip("%.0f°".format(measured),o(p.angleLabel),arc,night,bold=true)
    }
}

/**
 * Encodes the frames a session showed into an MP4, on its own thread. A frame offered while the last is still being encoded is
 * skipped rather than queued, so recording never holds up tracking or counting. Nothing is written until the first frame.
 */
internal class SessionRecorder(private val file:File) {
    private val thread=HandlerThread("motivance-session-video").apply {start()}
    private val handler=Handler(thread.looper)
    private val busy=AtomicBoolean(false)
    private val closed=AtomicBoolean(false)
    private val info=MediaCodec.BufferInfo()
    private var codec:MediaCodec?=null
    private var surface:Surface?=null
    private var muxer:MediaMuxer?=null
    private var track=-1
    private var samples=0
    private var width=0
    private var height=0
    @Volatile var failed=false; private set

    /** Hands over a frame if the encoder is free. Returns whether it was taken. */
    fun offer(frame:VideoFrame):Boolean {
        if(closed.get() || failed || !busy.compareAndSet(false,true)) return false
        handler.post {
            try {if(!closed.get()) draw(frame)}
            catch(e:Exception) {failed=true; Log.w(TAG,"Recording stopped",e)}
            finally {busy.set(false)}
        }
        return true
    }

    private fun open(frameWidth:Int,frameHeight:Int) {
        val (w,h)=videoSize(frameWidth,frameHeight); width=w; height=h
        file.parentFile?.mkdirs()
        val format=MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC,w,h).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT,MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE,videoBitrate(w,h))
            setInteger(MediaFormat.KEY_FRAME_RATE,30)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL,2)
        }
        val encoder=MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        codec=encoder
        encoder.configure(format,null,null,MediaCodec.CONFIGURE_FLAG_ENCODE)
        surface=encoder.createInputSurface()
        encoder.start()
        muxer=MediaMuxer(file.path,MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    }

    private fun draw(frame:VideoFrame) {
        if(frame.bitmap.isRecycled) return
        if(codec==null) open(frame.bitmap.width,frame.bitmap.height)
        val target=surface!!
        val canvas=target.lockHardwareCanvas()
        try {VideoOverlay.draw(canvas,frame,width,height)} finally {target.unlockCanvasAndPost(canvas)}
        drain(false)
    }

    private fun drain(end:Boolean) {
        val encoder=codec ?: return
        var waits=0
        while(true) {
            val index=encoder.dequeueOutputBuffer(info,if(end) 10_000 else 0)
            when {
                index==MediaCodec.INFO_TRY_AGAIN_LATER -> if(!end || ++waits>300) return
                index==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {track=muxer!!.addTrack(encoder.outputFormat); muxer!!.start()}
                index>=0 -> {
                    val buffer=encoder.getOutputBuffer(index)
                    if(info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG!=0) info.size=0
                    if(buffer!=null && info.size>0 && track>=0) {
                        buffer.position(info.offset); buffer.limit(info.offset+info.size)
                        muxer!!.writeSampleData(track,buffer,info); samples++
                    }
                    encoder.releaseOutputBuffer(index,false)
                    if(info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM!=0) return
                }
            }
        }
    }

    /** Ends the recording once and hands back its file, or null when nothing playable was recorded. [done] runs on the recorder's thread. */
    fun finish(done:(File?)->Unit) {
        if(!closed.compareAndSet(false,true)) return
        handler.post {
            var kept=false
            try {
                codec?.let {it.signalEndOfInputStream(); drain(true)}
                try {codec?.stop()} catch(_:Exception) {}
                if(samples>0) {muxer?.stop(); kept=true}
            } catch(e:Exception) {Log.w(TAG,"Recording could not be finished",e)}
            finally {
                codec?.release(); surface?.release()
                try {muxer?.release()} catch(_:Exception) {}
                codec=null; surface=null; muxer=null
            }
            if(!kept) file.delete()
            thread.quitSafely()
            done(if(kept) file else null)
        }
    }

    private companion object {const val TAG="SessionRecorder"}
}

/** The phone's gallery, under a Motivance album in Movies. The videos are the patient's own files: Motivance never uploads them on its own. */
internal object GalleryVideos {
    const val ALBUM="Motivance"
    /** Before Android 10 the gallery is written as a shared folder, which needs the storage permission. */
    val needsStoragePermission get()=Build.VERSION.SDK_INT<Build.VERSION_CODES.Q

    fun save(context:Context,file:File,name:String):Uri {
        val resolver=context.contentResolver
        if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.Q) {
            val values=ContentValues().apply {
                put(MediaStore.Video.Media.DISPLAY_NAME,name); put(MediaStore.Video.Media.MIME_TYPE,"video/mp4")
                put(MediaStore.Video.Media.RELATIVE_PATH,"${Environment.DIRECTORY_MOVIES}/$ALBUM"); put(MediaStore.Video.Media.IS_PENDING,1)
            }
            val uri=resolver.insert(MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),values) ?: error("The gallery refused the video")
            try {
                resolver.openOutputStream(uri)!!.use {out -> file.inputStream().use {it.copyTo(out)}}
                resolver.update(uri,ContentValues().apply {put(MediaStore.Video.Media.IS_PENDING,0)},null,null)
            } catch(e:Exception) {resolver.delete(uri,null,null); throw e}
            return uri
        }
        @Suppress("DEPRECATION")
        val folder=File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES),ALBUM).apply {mkdirs()}
        val target=File(folder,name)
        file.copyTo(target,overwrite=true)
        val values=ContentValues().apply {
            @Suppress("DEPRECATION") put(MediaStore.Video.Media.DATA,target.absolutePath)
            put(MediaStore.Video.Media.DISPLAY_NAME,name); put(MediaStore.Video.Media.MIME_TYPE,"video/mp4")
        }
        return resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI,values) ?: Uri.fromFile(target)
    }

    fun exists(context:Context,uri:Uri)=runCatching {
        context.contentResolver.query(uri,arrayOf(MediaStore.MediaColumns._ID),null,null,null)?.use {it.moveToFirst()}==true
    }.getOrDefault(false)

    /** Removes the video. Throws [SecurityException] when the phone must ask the patient first, as it does for a file from before a reinstall. */
    fun delete(context:Context,uri:Uri):Boolean=context.contentResolver.delete(uri,null,null)>0
}

/** What [SessionVideoStore] keeps, as JSON. Separate so it can be tested without a phone. */
internal object SessionVideoJson {
    fun write(videos:List<SessionVideo>)=JSONArray().apply {
        videos.forEach {put(JSONObject().put("uri",it.uri).put("sessions",JSONArray(it.sessions)).put("at",it.at))}
    }.toString()
    fun read(raw:String?):List<SessionVideo> = runCatching {
        val rows=JSONArray(raw ?: return emptyList())
        (0 until rows.length()).map {i -> rows.getJSONObject(i).let {row ->
            val sessions=row.getJSONArray("sessions")
            SessionVideo(row.getString("uri"),(0 until sessions.length()).map(sessions::getString),row.getLong("at"))
        }}
    }.getOrDefault(emptyList())
}

/**
 * The patient's own agreement to record sessions, and which gallery video belongs to which session. Both stay on this phone and
 * are separate from the movement-summary consent. Signing out leaves them, as it leaves the videos themselves.
 */
class SessionVideoStore(context:Context) {
    private val prefs=context.applicationContext.getSharedPreferences("session_videos",Context.MODE_PRIVATE)
    fun consented(owner:String)=prefs.getString("consent:$owner",null)?.startsWith("$CONSENT_VERSION|")==true
    fun consent(owner:String,granted:Boolean) {
        prefs.edit().apply {if(granted) putString("consent:$owner","$CONSENT_VERSION|${System.currentTimeMillis()}") else remove("consent:$owner")}.apply()
    }
    fun all(owner:String)=SessionVideoJson.read(prefs.getString("videos:$owner",null))
    fun add(owner:String,video:SessionVideo) {prefs.edit().putString("videos:$owner",SessionVideoJson.write(all(owner).filter {it.uri!=video.uri}+video)).apply()}
    fun forSession(owner:String,session:String)=all(owner).lastOrNull {session in it.sessions}
    fun remove(owner:String,uri:String) {prefs.edit().putString("videos:$owner",SessionVideoJson.write(all(owner).filter {it.uri!=uri})).apply()}
    companion object {const val CONSENT_VERSION="session-video-v1"}
}
