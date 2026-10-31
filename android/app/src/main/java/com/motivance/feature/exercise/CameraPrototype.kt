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
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
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
import com.motivance.assessment.PreviewMapping
import com.motivance.assessment.CameraDiagnostics
import com.motivance.domain.Landmark
import com.motivance.domain.*
import com.motivance.BuildConfig
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

private data class DisplayFrame(val bitmap: Bitmap, val points: List<Landmark>, val latency: Long)
private val connections=listOf(11 to 12,11 to 13,13 to 15,12 to 14,14 to 16,11 to 23,12 to 24,23 to 24,23 to 25,25 to 27,24 to 26,26 to 28,27 to 29,29 to 31,28 to 30,30 to 32)

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
    var active by remember { mutableStateOf(lifecycle.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) }
    var diagnostics by remember { mutableStateOf<CameraDiagnostics.Snapshot?>(null) }
    var thermalStatus by remember { mutableStateOf(-1) }
    DisposableEffect(lifecycle) {
        val observer=LifecycleEventObserver { _, event ->
            active=lifecycle.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
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
                        if(!disposed.get() && !runtimeFailed.get()) {
                            if(detector==null) detector=PoseLandmarker.createFromOptions(context,PoseLandmarker.PoseLandmarkerOptions.builder().setBaseOptions(BaseOptions.builder().setModelAssetPath("models/pose_landmarker_lite.task").build()).setRunningMode(RunningMode.VIDEO).setNumPoses(2).build())
                            val source=image.toBitmap()
                            val matrix=Matrix().apply { postRotate(image.imageInfo.rotationDegrees.toFloat()) }
                            val upright=Bitmap.createBitmap(source,0,0,source.width,source.height,matrix,true)
                            val start=SystemClock.uptimeMillis()
                            // MPImage.close() recycles its bitmap. Keep the displayed bitmap independent.
                            val mpImage=BitmapImageBuilder(upright.copy(Bitmap.Config.ARGB_8888,false)).build()
                            val result=try { detector!!.detectForVideo(mpImage,start) } finally { mpImage.close() }
                            val people=result.landmarks().map { body -> body.map { Landmark(it.x(),it.y(),minOf(it.visibility().orElse(0f),it.presence().orElse(0f))) } }
                            val points=people.firstOrNull().orEmpty()
                            val frame=DisplayFrame(upright,points,SystemClock.uptimeMillis()-start)
                            val snapshot=meter.record(start,frame.latency)
                            main.execute { if(!disposed.get()) {
                                display=frame; diagnostics=snapshot; error=null
                                session.frame(people,upright.width,upright.height,start)
                                thermalStatus=if(Build.VERSION.SDK_INT>=29) context.getSystemService(PowerManager::class.java).currentThermalStatus else -1
                            } }
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
        Text(stringResource(R.string.camera_title),style=MaterialTheme.typography.titleLarge)
        Text(stringResource(if(exercise.rules.demo) R.string.demo_assessment_notice else R.string.prescribed_assessment_notice),style=MaterialTheme.typography.bodySmall)
        Text(stringResource(R.string.camera_setup),style=MaterialTheme.typography.bodySmall)
        if(exercise.id==null) {
            Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                FilterChip(exercise.rules.kind==ExerciseKind.ELBOW_FLEXION,{session.select(ExerciseKind.ELBOW_FLEXION,exercise.rules.side)},label={Text(stringResource(R.string.elbow_flexion))})
                FilterChip(exercise.rules.kind==ExerciseKind.SHOULDER_ABDUCTION,{session.select(ExerciseKind.SHOULDER_ABDUCTION,exercise.rules.side)},label={Text(stringResource(R.string.shoulder_abduction))})
            }
            Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                BodySide.entries.forEach { side -> FilterChip(exercise.rules.side==side,{session.select(exercise.rules.kind,side)},label={Text(stringResource(if(side==BodySide.LEFT) R.string.left_side else R.string.right_side))}) }
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
        val shown=display
        Surface(color=Color(0xFFD6F7F0),shape=RoundedCornerShape(16.dp)) {
            Text(stringResource(exercise.metrics.quality.label()),Modifier.padding(12.dp),color=Color(0xFF006A61))
        }
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween) {
            Text(stringResource(R.string.measured_angle,exercise.metrics.angleDegrees?.let {"%.1f".format(it)} ?: "--"))
            Text(stringResource(R.string.completed_reps,exercise.metrics.completed,exercise.rules.targetRepetitions))
        }
        Text(stringResource(R.string.session_metrics,exercise.metrics.romDegrees?.let {"%.1f".format(it)} ?: "--",exercise.metrics.incomplete,exercise.metrics.durationMs/1000),style=MaterialTheme.typography.bodySmall)
        Text(stringResource(R.string.session_targets,exercise.rules.lowDegrees.toInt(),exercise.rules.highDegrees.toInt()),style=MaterialTheme.typography.bodySmall)
        if(exercise.metrics.feedback!=RepFeedback.NONE) Text(stringResource(exercise.metrics.feedback.label()),color=MaterialTheme.colorScheme.secondary)
        if(shown!=null) Text(stringResource(R.string.inference_summary,shown.latency,shown.bitmap.width,shown.bitmap.height))
        diagnostics?.let { Text(stringResource(R.string.diagnostics_summary,"%.1f".format(it.fps),it.p95LatencyMs,thermalStatus),style=MaterialTheme.typography.labelSmall) }
        Canvas(Modifier.fillMaxWidth().height(300.dp).clip(RoundedCornerShape(24.dp)).background(Color(0xFF002042)).border(2.dp,Color(0xFF43474F),RoundedCornerShape(24.dp))) {
            if(size.width<=0f || size.height<=0f) return@Canvas
            shown?.let { frame ->
                val transform=PreviewMapping(frame.bitmap.width,frame.bitmap.height,size.width,size.height,front)
                drawIntoCanvas { canvas ->
                    canvas.nativeCanvas.save()
                    if(front) { canvas.nativeCanvas.translate(size.width,0f); canvas.nativeCanvas.scale(-1f,1f) }
                    canvas.nativeCanvas.drawBitmap(frame.bitmap,null,android.graphics.RectF(transform.left,transform.top,transform.left+transform.width,transform.top+transform.height),null)
                    canvas.nativeCanvas.restore()
                }
                connections.forEach { (a,b) -> if(a<frame.points.size && b<frame.points.size && frame.points[a].visibility>=.5f && frame.points[b].visibility>=.5f) {
                    val p=transform.map(frame.points[a]); val q=transform.map(frame.points[b]); drawLine(Color.Green,Offset(p.first,p.second),Offset(q.first,q.second),5f)
                } }
                frame.points.filter { it.visibility>=.5f }.forEach { val p=transform.map(it); drawCircle(Color.Yellow,7f,Offset(p.first,p.second)) }
            }
        }
        Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            OutlinedButton({front=!front; display=null; error=null},modifier=Modifier.weight(1f)) { Text(stringResource(R.string.switch_camera)) }
            OutlinedButton({if(!paused) session.interrupt(); paused=!paused},modifier=Modifier.weight(1f),enabled=!exercise.saving) { Text(stringResource(if(paused) R.string.resume_camera else R.string.pause_camera)) }
        }
        if(exercise.id==null) Row(verticalAlignment=androidx.compose.ui.Alignment.CenterVertically) {
            Checkbox(consent,{consent=it}); Text(stringResource(R.string.local_metrics_consent),style=MaterialTheme.typography.bodySmall)
        }
        if(exercise.recoverable!=null && exercise.id==null) TextButton({session.restore()}) { Text(stringResource(R.string.recover_interrupted)) }
        if(exercise.saved) {
            Text(stringResource(R.string.session_saved_local))
            OutlinedButton({session.newSession(); consent=false}) {Text(stringResource(R.string.new_session))}
        } else if(!exercise.metrics.running) Button({session.start(consent || exercise.id!=null)},enabled=exercise.metrics.quality==TrackingQuality.READY && !paused && !exercise.saving && (consent || exercise.id!=null) && (if(exercise.rules.demo) BuildConfig.DEBUG else exercise.cached.any {it.versionId==exercise.rules.prescriptionVersionId && it.expiresAt>System.currentTimeMillis()}),modifier=Modifier.fillMaxWidth()) { Text(stringResource(if(exercise.id==null) R.string.start_measurement else R.string.resume_measurement)) }
        if(exercise.error) Text(stringResource(R.string.local_save_failed),color=MaterialTheme.colorScheme.error)
        Button({if(exercise.id!=null && !exercise.saved) {exitRequested=true; session.finish()} else onBack()},enabled=!exercise.saving,modifier=Modifier.fillMaxWidth().heightIn(min=56.dp),shape=RoundedCornerShape(12.dp)) { Text(stringResource(if(exercise.saving) R.string.saving_session else if(exercise.id!=null && !exercise.saved) R.string.finish_save_session else R.string.finish_camera)) }
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
