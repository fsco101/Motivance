package com.motivance.feature.exercise

import android.Manifest
import android.content.pm.PackageManager
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.graphics.Bitmap
import android.graphics.Matrix
import android.os.SystemClock
import android.os.Build
import android.os.PowerManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import com.motivance.R
import com.motivance.designsystem.ActionButton
import com.motivance.designsystem.FeedbackNotice
import com.motivance.assessment.CameraDiagnostics
import com.motivance.assessment.PerformancePolicy
import androidx.compose.ui.semantics.*
import com.motivance.domain.Landmark
import com.motivance.domain.*
import com.motivance.BuildConfig
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

private data class DisplayFrame(val bitmap: Bitmap, val points: List<Landmark>, val latency: Long)

/** Deliberately renders the same upright bitmap used for inference: no independent preview crop. */
@Composable fun CameraPrototype(ownerId:String="local-demo",onBack: () -> Unit) {
    val context=LocalContext.current; val lifecycle=LocalLifecycleOwner.current
    val session:ExerciseSessionViewModel=viewModel()
    val exercise by session.state.collectAsStateWithLifecycle()
    var consent by remember { mutableStateOf(false) }
    var exitRequested by remember { mutableStateOf(false) }
    LaunchedEffect(ownerId) { session.configure(ownerId) }
    LaunchedEffect(exercise.saved) { if(exercise.saved && exitRequested) onBack() }
    var permission by remember { mutableStateOf(ContextCompat.checkSelfPermission(context,Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED) }
    val launcher=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { permission=it }
    var front by remember { mutableStateOf(false) }
    var paused by remember { mutableStateOf(false) }
    var display by remember { mutableStateOf<DisplayFrame?>(null) }
    var error by remember { mutableStateOf<Int?>(null) }
    var active by remember { mutableStateOf(lifecycle.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) }
    var diagnostics by remember { mutableStateOf<CameraDiagnostics.Snapshot?>(null) }
    var thermalStatus by remember { mutableStateOf(-1) }
    DisposableEffect(lifecycle) {
        val observer=LifecycleEventObserver { _, event ->
            active=lifecycle.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)
            if(event==Lifecycle.Event.ON_RESUME) permission=ContextCompat.checkSelfPermission(context,Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED
            if(!active) { display=null; session.interrupt() }
        }
        lifecycle.lifecycle.addObserver(observer)
        onDispose { lifecycle.lifecycle.removeObserver(observer) }
    }
    if(permission && active && !paused) DisposableEffect(front,lifecycle) {
        val executor=Executors.newSingleThreadExecutor()
        val disposed=AtomicBoolean(false)
        val runtimeFailed=AtomicBoolean(false)
        val awaitingUi=AtomicBoolean(false)
        val main=ContextCompat.getMainExecutor(context)
        val future=ProcessCameraProvider.getInstance(context)
        var provider: ProcessCameraProvider?=null
        var analysis: ImageAnalysis?=null
        var detector: PoseLandmarker?=null
        val meter=CameraDiagnostics()
        future.addListener({
            if(!disposed.get()) try {
                provider=future.get()
                val useCase=ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888).build()
                analysis=useCase
                useCase.setAnalyzer(executor) { image ->
                    try {
                        if(!disposed.get() && !runtimeFailed.get() && !awaitingUi.get()) {
                            if(detector==null) detector=PoseLandmarker.createFromOptions(context,PoseLandmarker.PoseLandmarkerOptions.builder().setBaseOptions(BaseOptions.builder().setModelAssetPath("models/pose_landmarker_lite.task").build()).setRunningMode(RunningMode.VIDEO).setNumPoses(2).build())
                            val source=image.toBitmap()
                            val matrix=Matrix().apply { postRotate(image.imageInfo.rotationDegrees.toFloat()) }
                            val upright=Bitmap.createBitmap(source,0,0,source.width,source.height,matrix,true)
                            if(source!==upright) source.recycle()
                            val start=SystemClock.uptimeMillis()
                            // MPImage.close() recycles its bitmap. Keep the displayed bitmap independent.
                            val mpImage=BitmapImageBuilder(upright.copy(Bitmap.Config.ARGB_8888,false)).build()
                            val result=try { detector!!.detectForVideo(mpImage,start) } finally { mpImage.close() }
                            val people=result.landmarks().map { body -> body.map { Landmark(it.x(),it.y(),minOf(it.visibility().orElse(0f),it.presence().orElse(0f))) } }
                            val points=people.firstOrNull().orEmpty()
                            val frame=DisplayFrame(upright,points,SystemClock.uptimeMillis()-start)
                            val snapshot=meter.record(start,frame.latency)
                            awaitingUi.set(true)
                            main.execute {
                                try {
                                    if(!disposed.get() && active && !paused) {
                                        thermalStatus=if(Build.VERSION.SDK_INT>=29) context.getSystemService(PowerManager::class.java).currentThermalStatus else -1
                                        if(PerformancePolicy.shouldPause(thermalStatus)) {
                                            session.interrupt(); paused=true; display=null; error=R.string.camera_thermal_pause
                                            upright.recycle()
                                        } else if(SystemClock.uptimeMillis()-start>1000) {session.interrupt();upright.recycle()}
                                        else {display=frame;diagnostics=snapshot;error=null;session.frame(people,upright.width,upright.height,start)}
                                    } else upright.recycle()
                                } finally {awaitingUi.set(false)}
                            }
                        }
                    } catch(e: LinkageError) {
                        runtimeFailed.set(true)
                        main.execute { if(!disposed.get()) { useCase.clearAnalyzer(); display=null; session.interrupt(); error=R.string.pose_runtime_unavailable } }
                    } catch(e: Exception) { main.execute { if(!disposed.get()) { display=null; session.interrupt(); error=R.string.camera_analysis_failed } } }
                    finally { image.close() }
                }
                provider!!.bindToLifecycle(lifecycle,if(front) CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA,useCase)
            } catch(e: Exception) { error=R.string.camera_unavailable }
        },main)
        onDispose {
            session.interrupt()
            disposed.set(true); analysis?.clearAnalyzer(); analysis?.let { provider?.unbind(it) }; display=null; diagnostics=null
            executor.execute { detector?.close() }; executor.shutdown()
        }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment=androidx.compose.ui.Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            androidx.compose.foundation.Image(androidx.compose.ui.res.painterResource(R.drawable.motivance_logo),null,Modifier.size(36.dp))
            Text(stringResource(R.string.camera_title),style=MaterialTheme.typography.titleLarge,modifier=Modifier.weight(1f))
        }
        Text(stringResource(if(exercise.rules.demo) R.string.demo_assessment_notice else R.string.prescribed_assessment_notice),style=MaterialTheme.typography.bodySmall)
        Text(stringResource(R.string.camera_setup),style=MaterialTheme.typography.bodySmall)
        if(exercise.id==null) {
            if(exercise.rules.demo) {
            Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                FilterChip(exercise.rules.kind==ExerciseKind.ELBOW_FLEXION,{session.select(ExerciseKind.ELBOW_FLEXION,exercise.rules.side)},label={Text(stringResource(R.string.elbow_flexion))})
                FilterChip(exercise.rules.kind==ExerciseKind.SHOULDER_ABDUCTION,{session.select(ExerciseKind.SHOULDER_ABDUCTION,exercise.rules.side)},label={Text(stringResource(R.string.shoulder_abduction))})
            }
            Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                BodySide.entries.forEach { side -> FilterChip(exercise.rules.side==side,{session.select(exercise.rules.kind,side)},label={Text(stringResource(if(side==BodySide.LEFT) R.string.left_side else R.string.right_side))}) }
            }
            }
            exercise.cached.filter {it.expiresAt>System.currentTimeMillis()}.forEach { cached ->
                OutlinedButton({session.usePrescription(cached)}) { Text(stringResource(R.string.use_cached_prescription)) }
            }
        }
        exercise.cached.firstOrNull { it.versionId==exercise.rules.prescriptionVersionId }?.let {
            Text(it.instructions,style=MaterialTheme.typography.bodyMedium)
        }
        if(!permission) {
            Button({launcher.launch(Manifest.permission.CAMERA)}) { Text(stringResource(R.string.allow_camera)) }
            TextButton({context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:${context.packageName}")))}) { Text(stringResource(R.string.open_app_settings)) }
        }
        error?.let { Text(stringResource(it)) }
        MeasurementControls(exercise,consent,paused,BuildConfig.DEBUG,{consent=it},
            {session.start(consent || exercise.id!=null)},{session.interrupt()},stringResource(exercise.metrics.quality.label()))
        val shown=display
        SkeletonPreview(shown?.bitmap,shown?.points.orEmpty(),front,exercise.rules,exercise.metrics,stringResource(exercise.metrics.quality.label()))
        Text(stringResource(R.string.session_metrics,exercise.metrics.romDegrees?.let {"%.1f".format(it)} ?: "--",exercise.metrics.incomplete,exercise.metrics.durationMs/1000),style=MaterialTheme.typography.bodySmall)
        Text(stringResource(R.string.session_targets,exercise.rules.lowDegrees.toInt(),exercise.rules.highDegrees.toInt()),style=MaterialTheme.typography.bodySmall)
        if(exercise.metrics.feedback!=RepFeedback.NONE) Text(stringResource(exercise.metrics.feedback.label()),color=MaterialTheme.colorScheme.secondary)
        if(BuildConfig.DEBUG) {
            if(shown!=null) Text(stringResource(R.string.inference_summary,shown.latency,shown.bitmap.width,shown.bitmap.height),style=MaterialTheme.typography.labelSmall)
            diagnostics?.let {Text(stringResource(R.string.diagnostics_summary,"%.1f".format(it.fps),it.p95LatencyMs,thermalStatus),style=MaterialTheme.typography.labelSmall)}
        }
        if(diagnostics?.let {PerformancePolicy.slow(it)}==true) Text(stringResource(R.string.camera_slow_warning))
        Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            OutlinedButton({front=!front; display=null; error=null},modifier=Modifier.weight(1f)) { Text(stringResource(R.string.switch_camera)) }
            OutlinedButton({if(!paused) session.interrupt(); paused=!paused},modifier=Modifier.weight(1f),enabled=!exercise.saving) { Text(stringResource(if(paused) R.string.resume_camera else R.string.pause_camera)) }
        }
        if(exercise.recoverable!=null && exercise.id==null) TextButton({session.restore()}) { Text(stringResource(R.string.recover_interrupted)) }
        if(exercise.saved) {
            Text(stringResource(R.string.session_saved_local))
            OutlinedButton({session.newSession(); consent=false}) {Text(stringResource(R.string.new_session))}
        }
        if(exercise.error) FeedbackNotice(R.string.local_save_failed,error=true)
        if(!exercise.rules.demo && exercise.cached.none {it.versionId==exercise.rules.prescriptionVersionId && it.expiresAt>System.currentTimeMillis()}) Text(stringResource(R.string.assignment_expired),color=MaterialTheme.colorScheme.error)
        if(exercise.id!=null && !exercise.metrics.running && !exercise.saved) TextButton({session.newSession();consent=false},enabled=!exercise.saving) {Text(stringResource(R.string.new_session))}
        ActionButton(if(exercise.id!=null && !exercise.saved) R.string.finish_save_session else R.string.finish_camera,
            {if(exercise.id!=null && !exercise.saved) {exitRequested=true; session.finish()} else onBack()},busy=exercise.saving,busyLabel=R.string.saving_session)
    }
}

private fun TrackingQuality.label()=when(this) {
    TrackingQuality.NO_PERSON -> R.string.quality_no_person
    TrackingQuality.MULTIPLE_PEOPLE -> R.string.quality_multiple
    TrackingQuality.LOW_CONFIDENCE -> R.string.quality_confidence
    TrackingQuality.OUT_OF_FRAME -> R.string.quality_frame
    TrackingQuality.DEGENERATE -> R.string.quality_geometry
    TrackingQuality.OUTLIER -> R.string.quality_outlier
    TrackingQuality.POSITIONING -> R.string.quality_positioning
    TrackingQuality.TRUNK_LEAN -> R.string.quality_lean
    TrackingQuality.READY -> R.string.quality_ready
    TrackingQuality.PAUSED -> R.string.camera_paused
}
private fun RepFeedback.label()=when(this) {
    RepFeedback.TARGET_REACHED -> R.string.feedback_target
    RepFeedback.COMPLETE -> R.string.feedback_complete
    RepFeedback.INCOMPLETE_RANGE -> R.string.feedback_incomplete
    RepFeedback.TOO_FAST -> R.string.feedback_fast
    RepFeedback.TIMED_OUT -> R.string.feedback_timeout
    RepFeedback.NONE -> R.string.quality_ready
}
