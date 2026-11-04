package com.motivance.feature.exercise

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import com.motivance.R
import com.motivance.domain.*

/** Camera preview and explicit consent/start are separate; visible landmarks alone never record. */
@Composable internal fun MeasurementControls(
    state:ExerciseSessionState,consent:Boolean,paused:Boolean,demoAllowed:Boolean,
    onConsent:(Boolean)->Unit,onStart:()->Unit,onPause:()->Unit,qualityLabel:String?=null,
) {
    val metrics=state.metrics
    val unavailableDemo=state.rules.demo && !demoAllowed
    val assignmentValid=state.rules.demo || state.cached.any {it.versionId==state.rules.prescriptionVersionId && it.expiresAt>System.currentTimeMillis()}
    val status=when {
        state.saved -> R.string.measurement_saved
        metrics.running -> R.string.measurement_recording
        state.id!=null -> R.string.measurement_paused
        else -> R.string.measurement_preview
    }
    // Recording is signalled by a slow pulse, the convention people already read as "on air".
    val pulse by rememberInfiniteTransition(label="recording").animateFloat(1f,.35f,
        infiniteRepeatable(tween(900,easing=FastOutSlowInEasing),RepeatMode.Reverse),label="pulse")
    val dot=when {state.saved -> MaterialTheme.colorScheme.secondary; metrics.running -> Color(0xFFFF6B5E); else -> MaterialTheme.colorScheme.outline}
    Surface(Modifier.fillMaxWidth(),shape=MaterialTheme.shapes.large,color=MaterialTheme.colorScheme.surfaceContainer) {
        Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)) {
                Canvas(Modifier.size(10.dp).alpha(if(metrics.running) pulse else 1f)) {drawCircle(dot)}
                Text(stringResource(status),style=MaterialTheme.typography.titleMedium,
                    modifier=Modifier.semantics {liveRegion=LiveRegionMode.Polite})
            }
            val guidance=when {
                unavailableDemo -> stringResource(R.string.measurement_demo_unavailable)
                state.saved -> stringResource(R.string.session_saved_local)
                !assignmentValid -> stringResource(R.string.assignment_expired)
                paused -> stringResource(R.string.camera_paused)
                !metrics.running && state.id!=null -> stringResource(R.string.measurement_resume_help)
                !metrics.running -> stringResource(R.string.measurement_start_help)
                metrics.quality!=TrackingQuality.READY -> stringResource(R.string.measurement_tracking_wait)
                metrics.phase==MovementPhase.SEEKING_START || metrics.phase==MovementPhase.AT_TARGET ->
                    stringResource(R.string.measurement_return,state.rules.lowDegrees.toInt())
                else -> stringResource(R.string.measurement_reach,state.rules.highDegrees.toInt(),state.rules.peakHoldMs)
            }
            Text(guidance,style=MaterialTheme.typography.bodyLarge,color=MaterialTheme.colorScheme.onSurface)
            if(!state.saved && !paused && metrics.quality!=TrackingQuality.READY && qualityLabel!=null) {
                Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Default.Warning,null,Modifier.size(18.dp),tint=MaterialTheme.colorScheme.tertiary)
                    Text(qualityLabel,color=MaterialTheme.colorScheme.tertiary,
                        style=MaterialTheme.typography.bodyMedium)
                }
            }
            if(state.id==null && !state.saved) {
                val label=stringResource(if(state.rules.demo) R.string.local_metrics_consent else R.string.sync_metrics_consent)
                Row(verticalAlignment=Alignment.CenterVertically) {
                    Checkbox(consent,onConsent,enabled=!state.saving && !unavailableDemo,modifier=Modifier.semantics {contentDescription=label})
                    Text(label,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if(!state.saved) {
                if(metrics.running) OutlinedButton(onPause,enabled=!state.saving,modifier=Modifier.fillMaxWidth().heightIn(min=56.dp),shape=MaterialTheme.shapes.medium) {
                    Text(stringResource(R.string.pause_measurement))
                } else Button(onStart,enabled=metrics.quality==TrackingQuality.READY && !paused && !state.saving &&
                    (consent || state.id!=null) && !unavailableDemo && assignmentValid,modifier=Modifier.fillMaxWidth().heightIn(min=56.dp),
                    shape=MaterialTheme.shapes.medium,colors=ButtonDefaults.buttonColors(containerColor=MaterialTheme.colorScheme.secondary,contentColor=MaterialTheme.colorScheme.onSecondary)) {
                    Icon(Icons.Default.PlayArrow,null); Spacer(Modifier.width(8.dp))
                    Text(stringResource(if(state.id==null) R.string.start_measurement else R.string.resume_measurement))
                }
            }
        }
    }
}
