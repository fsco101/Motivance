package com.motivance.feature.exercise

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.motivance.R
import com.motivance.designsystem.Motion
import com.motivance.domain.*

/** Where the move to the next side of a set has got to. */
enum class SwitchStage { ANNOUNCING, COUNTING, PAUSED, WAITING_FOR_TRACKING }

/** Between two sides of a set: the finished side is saved, and [next] starts when the countdown ends. */
data class SideSwitch(val next:BodySide,val stage:SwitchStage,val secondsLeft:Int=SideSet.COUNTDOWN_SECONDS)

/** One finished side of this run, for the completion screen. */
data class SideResult(val side:BodySide,val target:Int,val metrics:AssessmentSnapshot)

/** What the voice says about the set, apart from each repetition's own result. */
sealed interface SetCue {
    data object TargetReached:SetCue
    data class SideDone(val done:BodySide,val next:BodySide):SetCue
    data class Count(val n:Int):SetCue
    data object Go:SetCue
    data object Complete:SetCue
}

/** The words for each [SetCue], in one language. [sideDone] takes the finished side, the next side and the exercise name. */
class SetCueLines(private val targetReached:String,private val sideDone:String,private val go:String,private val complete:String,
    private val sideNames:Map<BodySide,String>) {
    fun lineFor(cue:SetCue,exerciseName:String):String=when(cue) {
        SetCue.TargetReached -> targetReached
        is SetCue.SideDone -> sideDone.format(sideNames.getValue(cue.done),sideNames.getValue(cue.next),exerciseName)
        is SetCue.Count -> cue.n.toString()
        SetCue.Go -> go
        SetCue.Complete -> complete
    }
}

/** Replaces the measuring controls between sides: what comes next, the countdown, and one way to hold it. */
@Composable internal fun SideSwitchCard(switch:SideSwitch,onPause:()->Unit,onStart:()->Unit,modifier:Modifier=Modifier) {
    val side=stringResource(if(switch.next==BodySide.RIGHT) R.string.right_side else R.string.left_side)
    Surface(modifier.fillMaxWidth(),shape=MaterialTheme.shapes.large,color=Motion.NightPanel) {
        Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp),horizontalAlignment=Alignment.CenterHorizontally) {
            Text(stringResource(R.string.set_next_side,side),color=Color.White,style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.SemiBold,
                textAlign=TextAlign.Center,modifier=Modifier.semantics {heading(); liveRegion=LiveRegionMode.Polite})
            when(switch.stage) {
                SwitchStage.ANNOUNCING,SwitchStage.COUNTING -> {
                    Text(switch.secondsLeft.toString(),color=Motion.SproutBright,style=MaterialTheme.typography.displayLarge,
                        modifier=Modifier.clearAndSetSemantics {contentDescription=""})
                    Text(stringResource(R.string.set_starting_in,switch.secondsLeft),color=Motion.NightInk,style=MaterialTheme.typography.bodyLarge,
                        modifier=Modifier.semantics {liveRegion=LiveRegionMode.Polite})
                    OutlinedButton(onPause,Modifier.fillMaxWidth().heightIn(min=52.dp),shape=MaterialTheme.shapes.medium) {Text(stringResource(R.string.set_pause))}
                }
                SwitchStage.PAUSED -> Button(onStart,Modifier.fillMaxWidth().heightIn(min=56.dp),shape=MaterialTheme.shapes.medium) {
                    Icon(Icons.Default.PlayArrow,null,Modifier.size(20.dp)); Spacer(Modifier.width(8.dp)); Text(stringResource(R.string.set_start))
                }
                SwitchStage.WAITING_FOR_TRACKING -> Text(stringResource(R.string.set_get_in_view,side),color=Motion.NightInk,style=MaterialTheme.typography.bodyLarge,
                    textAlign=TextAlign.Center,modifier=Modifier.semantics {liveRegion=LiveRegionMode.Polite})
            }
        }
    }
}
