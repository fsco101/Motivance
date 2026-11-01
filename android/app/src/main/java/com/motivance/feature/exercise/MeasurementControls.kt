package com.motivance.feature.exercise

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
            Text(stringResource(status),style=MaterialTheme.typography.titleMedium,
                modifier=Modifier.semantics {liveRegion=LiveRegionMode.Polite})
            when {
                unavailableDemo -> Text(stringResource(R.string.measurement_demo_unavailable))
                state.saved -> Text(stringResource(R.string.session_saved_local))
                !assignmentValid -> Text(stringResource(R.string.assignment_expired))
                paused -> Text(stringResource(R.string.camera_paused))
                !metrics.running && state.id!=null -> Text(stringResource(R.string.measurement_resume_help))
                !metrics.running -> Text(stringResource(R.string.measurement_start_help))
                metrics.quality!=TrackingQuality.READY -> Text(stringResource(R.string.measurement_tracking_wait))
                metrics.phase==MovementPhase.SEEKING_START || metrics.phase==MovementPhase.AT_TARGET ->
                    Text(stringResource(R.string.measurement_return,state.rules.lowDegrees.toInt()))
                else -> Text(stringResource(R.string.measurement_reach,state.rules.highDegrees.toInt(),state.rules.peakHoldMs))
            }
            if(!state.saved && !paused && metrics.quality!=TrackingQuality.READY && qualityLabel!=null) {
                Text(qualityLabel,color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.bodyMedium)
            }
            if(state.id==null && !state.saved) {
                val label=stringResource(if(state.rules.demo) R.string.local_metrics_consent else R.string.sync_metrics_consent)
                Row(verticalAlignment=Alignment.CenterVertically) {
                    Checkbox(consent,onConsent,enabled=!state.saving && !unavailableDemo,modifier=Modifier.semantics {contentDescription=label})
                    Text(label,style=MaterialTheme.typography.bodySmall)
                }
            }
            if(!state.saved) {
                if(metrics.running) OutlinedButton(onPause,enabled=!state.saving,modifier=Modifier.fillMaxWidth().heightIn(min=52.dp)) {
                    Text(stringResource(R.string.pause_measurement))
                } else Button(onStart,enabled=metrics.quality==TrackingQuality.READY && !paused && !state.saving &&
                    (consent || state.id!=null) && !unavailableDemo && assignmentValid,modifier=Modifier.fillMaxWidth().heightIn(min=52.dp)) {
                    Text(stringResource(if(state.id==null) R.string.start_measurement else R.string.resume_measurement))
                }
            }
        }
    }
}
