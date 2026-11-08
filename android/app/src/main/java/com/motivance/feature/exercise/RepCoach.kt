package com.motivance.feature.exercise

import android.content.Context
import androidx.compose.animation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.motivance.R
import com.motivance.assessment.*
import com.motivance.designsystem.Motion
import com.motivance.designsystem.durationText
import com.motivance.domain.*
import kotlinx.coroutines.delay

/** How long a counted or missed result stays above the next step. */
private const val RESULT_SHOWN_MS=2500L

/**
 * The step the engine is waiting for and the last result, in plain words beside the camera image (issue #95).
 * Everything comes from [RepetitionGuide] and [RepResult], so it can only describe what the counter actually does.
 */
@Composable internal fun RepCoach(state:ExerciseSessionState,paused:Boolean,modifier:Modifier=Modifier) {
    val metrics=state.metrics
    val rules=state.rules
    val guide=RepetitionGuide.of(rules,metrics)
    // A result already on screen before a rotation is not shown again.
    var announced by rememberSaveable {mutableIntStateOf(state.result?.sequence ?: 0)}
    var showing by remember {mutableStateOf<RepResult?>(null)}
    val latest=state.result
    LaunchedEffect(latest?.sequence) {
        if(latest!=null && latest.sequence!=announced) {
            announced=latest.sequence
            showing=latest
            delay(RESULT_SHOWN_MS)
            showing=null
        }
    }
    val step=guide.step.takeIf {metrics.running && !paused && !state.saved && metrics.quality==TrackingQuality.READY}
    val prompt=when {
        state.saved -> stringResource(R.string.measurement_saved)
        paused || (!metrics.running && state.id!=null) -> stringResource(R.string.coach_paused)
        !metrics.running -> stringResource(R.string.coach_not_recording)
        step==null -> stringResource(R.string.coach_tracking)
        step==RepStep.START -> stringResource(R.string.coach_start,rules.lowDegrees.toInt())
        step==RepStep.REACH -> stringResource(R.string.coach_reach,rules.highDegrees.toInt())
        step==RepStep.HOLD -> stringResource(R.string.coach_hold,durationText(rules.peakHoldMs))
        else -> stringResource(R.string.coach_return,rules.lowDegrees.toInt())
    }
    Surface(modifier.fillMaxWidth(),shape=RoundedCornerShape(16.dp),color=Motion.NightPanel) {
        Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(6.dp)) {
            AnimatedVisibility(showing!=null,enter=fadeIn()+expandVertically(),exit=fadeOut()+shrinkVertically()) {
                showing?.let {ResultLine(it.outcome,rules.targetRepetitions)}
            }
            step?.let {Text(stringResource(R.string.coach_step,it.ordinal+1),color=Motion.NightInk,style=MaterialTheme.typography.labelMedium)}
            Text(prompt,color=Color.White,style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.SemiBold,
                modifier=Modifier.semantics {liveRegion=LiveRegionMode.Polite})
            if(step==RepStep.HOLD && rules.peakHoldMs>0) LinearProgressIndicator(progress={guide.holdProgress.toFloat()},
                modifier=Modifier.fillMaxWidth().height(6.dp),color=Motion.SproutBright,trackColor=Motion.NightInk.copy(alpha=.25f))
        }
    }
}

@Composable private fun ResultLine(outcome:RepOutcome,target:Int) {
    val counted=outcome is RepOutcome.Counted
    val words=when(outcome) {
        is RepOutcome.Counted -> stringResource(R.string.coach_counted,outcome.count,target)
        is RepOutcome.Missed -> stringResource(when(outcome.reason) {
            RepFeedback.TOO_FAST -> R.string.coach_missed_fast
            RepFeedback.TIMED_OUT -> R.string.coach_missed_slow
            else -> R.string.coach_missed_range
        })
    }
    Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)) {
        Icon(if(counted) Icons.Default.CheckCircle else Icons.Default.Info,null,tint=if(counted) Motion.SproutBright else Motion.NightCaution)
        Text(words,color=if(counted) Motion.SproutBright else Motion.NightCaution,style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.Bold,
            modifier=Modifier.semantics {liveRegion=LiveRegionMode.Assertive})
    }
}

/** The patient's choice to hear spoken feedback (issue #96). On until they turn it off, and kept on this phone. */
class RepSoundSetting(context:Context) {
    private val preferences=context.getSharedPreferences(FILE,Context.MODE_PRIVATE)
    var enabled:Boolean
        get()=preferences.getBoolean(KEY,true)
        set(value) {preferences.edit().putBoolean(KEY,value).apply()}
    companion object {
        private const val FILE="session_feedback"
        private const val KEY="voice"
        fun clear(context:Context) {context.getSharedPreferences(FILE,Context.MODE_PRIVATE).edit().remove(KEY).apply()}
    }
}

/** A labelled switch rather than an icon: the core icon set has no speaker, and words read better at a distance. */
@Composable internal fun RepSoundToggle(on:Boolean,modifier:Modifier=Modifier,onChange:(Boolean)->Unit) {
    Row(modifier.fillMaxWidth().heightIn(min=52.dp).toggleable(on,role=Role.Switch,onValueChange=onChange),
        verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
        Column(Modifier.weight(1f)) {
            Text(stringResource(if(on) R.string.rep_sound_on else R.string.rep_sound_off),color=Color.White,style=MaterialTheme.typography.titleSmall)
            Text(stringResource(R.string.rep_sound_description),color=Motion.NightInk,style=MaterialTheme.typography.bodySmall)
        }
        Switch(on,null)
    }
}
