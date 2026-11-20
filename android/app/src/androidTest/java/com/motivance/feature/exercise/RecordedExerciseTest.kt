package com.motivance.feature.exercise

import android.graphics.BitmapFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import com.motivance.assessment.MovementAssessment
import com.motivance.domain.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import kotlin.math.roundToLong

/**
 * Android's half of the web camera regression (#141). The web test draws a recorded exercise (web/tests/support/exerciseVideo.ts)
 * and measures it in the browser; this runs the very same JPEG frames through the phone's own path: MediaPipe 0.10.21 in video
 * mode with the app's model and settings (CameraPrototype), the lower of visibility and presence, then the Kotlin engine with
 * the same rules and timestamps. The numbers go to android.json beside the frames, for docs/validation/WEB-CAMERA-REGRESSION.md.
 *
 * scripts/compare_recorded_exercise.py copies the frames into the app's own files and runs this with `-e recorded true`. In an
 * ordinary connected run there are no frames, and it is skipped.
 */
@RunWith(AndroidJUnit4::class)
class RecordedExerciseTest {
    private val context=InstrumentationRegistry.getInstrumentation().targetContext

    @Test fun recordedFramesAreMeasuredLikeTheWeb() {
        val folder=File(context.filesDir,"recorded-exercise")
        val frames=folder.listFiles {file -> file.name.startsWith("frame-") && file.name.endsWith(".jpg")}?.sortedBy {it.name}.orEmpty()
        val asked=InstrumentationRegistry.getArguments().getString("recorded")=="true"
        if(asked) assertTrue("No recorded frames in ${folder.path}",frames.isNotEmpty()) else assumeTrue("No recorded frames",frames.isNotEmpty())
        val detector=PoseLandmarker.createFromOptions(context,PoseLandmarker.PoseLandmarkerOptions.builder()
            .setBaseOptions(BaseOptions.builder().setModelAssetPath("models/pose_landmarker_lite.task").build())
            .setRunningMode(RunningMode.VIDEO).setNumPoses(2).build())
        val rules={side:BodySide -> ExerciseRules(kind=ExerciseKind.ELBOW_FLEXION,side=side,lowDegrees=20.0,highDegrees=90.0,targetRepetitions=3,
            minimumCycleMs=600,maximumCycleMs=30_000,peakHoldMs=100,maxTrunkLeanDegrees=20.0,confidence=.7f)}
        class Run(val side:BodySide) {val engine=MovementAssessment(rules(side)); val readings=JSONArray(); var started=-1}
        val runs=listOf(Run(BodySide.LEFT),Run(BodySide.RIGHT))
        val people=JSONArray()
        detector.use {
            frames.forEachIndexed {i,file ->
                val bitmap=BitmapFactory.decodeFile(file.path)
                // The same times as the web run: after one second, then 30 frames a second.
                val time=1000+(i*1000.0/30).roundToLong()
                val image=BitmapImageBuilder(bitmap).build()
                val result=try {it.detectForVideo(image,time)} finally {image.close()}
                val found=result.landmarks().map {body -> body.map {Landmark(it.x(),it.y(),minOf(it.visibility().orElse(0f),it.presence().orElse(0f)))}}
                people.put(found.size)
                for(run in runs) {
                    val snapshot=run.engine.process(found,bitmap.width,bitmap.height,time)
                    if(run.started<0) {
                        if(run.engine.start(time)) run.started=i
                        run.readings.put(JSONObject.NULL)
                    } else run.readings.put(if(snapshot.quality==TrackingQuality.READY) snapshot.angleDegrees ?: JSONObject.NULL else JSONObject.NULL)
                }
                bitmap.recycle()
            }
        }
        val out=JSONObject().put("delegate","CPU").put("people",people).put("sides",JSONArray(runs.map {run ->
            val s=run.engine.snapshot
            JSONObject().put("side",run.side.name).put("completed",s.completed).put("incomplete",s.incomplete)
                .put("romDegrees",s.romDegrees ?: JSONObject.NULL).put("readings",run.readings).put("started",run.started)
        }))
        File(folder,"android.json").writeText(out.toString())
        // Each arm does three repetitions while it faces the camera, as the web run finds.
        runs.forEach {assertEquals("${it.side} repetitions",3,it.engine.snapshot.completed)}
    }
}
