package com.motivance.feature.exercise

import android.content.Context
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import com.motivance.R
import com.motivance.assessment.RepOutcome
import com.motivance.designsystem.MotivanceTheme
import com.motivance.domain.*
import org.junit.*
import org.junit.Assert.*

/** Issue #95: the step and the last result sit next to the camera image, so the patient always knows what counts. */
class RepCoachTest {
    @get:Rule val compose=createComposeRule()
    private val context:Context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private fun text(id:Int,vararg args:Any)=context.getString(id,*args)
    private val recording=ExerciseSessionState(id="synthetic-session",metrics=AssessmentSnapshot(quality=TrackingQuality.READY,running=true,angleDegrees=10.0,phase=MovementPhase.REST))
    private val state=mutableStateOf(recording)
    private fun show(paused:Boolean=false) {compose.setContent {MotivanceTheme {Surface {RepCoach(state.value,paused)}}}}
    private fun at(phase:MovementPhase,angle:Double)=recording.copy(metrics=recording.metrics.copy(phase=phase,angleDegrees=angle))

    @Test fun beforeStartItSaysNothingIsCountedYet() {
        state.value=ExerciseSessionState(metrics=AssessmentSnapshot(quality=TrackingQuality.READY,angleDegrees=10.0))
        show()
        compose.onNodeWithText(text(R.string.coach_not_recording)).assertIsDisplayed()
    }
    @Test fun aPausedSessionSaysCountingHasStopped() {
        val camera=mutableStateOf(false)
        state.value=recording.copy(metrics=recording.metrics.copy(running=false))
        compose.setContent {MotivanceTheme {Surface {RepCoach(state.value,camera.value)}}}
        compose.onNodeWithText(text(R.string.coach_paused)).assertIsDisplayed()
        state.value=recording
        compose.onNodeWithText(text(R.string.coach_paused)).assertDoesNotExist()
        // Pausing the camera itself also stops counting.
        camera.value=true
        compose.onNodeWithText(text(R.string.coach_paused)).assertIsDisplayed()
    }
    @Test fun eachStepOfTheRepetitionIsNamedInOrder() {
        show()
        state.value=at(MovementPhase.SEEKING_START,40.0)
        compose.onNodeWithText(text(R.string.coach_step,1)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.coach_start,20)).assertIsDisplayed()
        state.value=at(MovementPhase.REST,10.0)
        compose.onNodeWithText(text(R.string.coach_step,2)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.coach_reach,90)).assertIsDisplayed()
        state.value=at(MovementPhase.MOVING,95.0)
        compose.onNodeWithText(text(R.string.coach_step,3)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.coach_hold,text(R.string.duration_seconds,"0.1"))).assertIsDisplayed()
        state.value=at(MovementPhase.AT_TARGET,95.0)
        compose.onNodeWithText(text(R.string.coach_step,4)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.coach_return,20)).assertIsDisplayed()
    }
    @Test fun lostTrackingAsksThePatientToStayInView() {
        state.value=recording.copy(metrics=recording.metrics.copy(quality=TrackingQuality.OUT_OF_FRAME,angleDegrees=null))
        show()
        compose.onNodeWithText(text(R.string.coach_tracking)).assertIsDisplayed()
    }
    @Test fun aCountedRepetitionShowsForAMomentThenTheNextStepReturns() {
        compose.mainClock.autoAdvance=false
        show()
        state.value=recording.copy(result=RepResult(RepOutcome.Counted(3),1))
        compose.mainClock.advanceTimeBy(100)
        compose.onNodeWithText(text(R.string.coach_counted,3,5)).assertIsDisplayed()
        compose.mainClock.advanceTimeBy(3000)
        compose.onNodeWithText(text(R.string.coach_counted,3,5)).assertDoesNotExist()
        compose.onNodeWithText(text(R.string.coach_reach,90)).assertIsDisplayed()
    }
    @Test fun aSecondResultWithTheSameWordsStillGetsItsOwnMoment() {
        compose.mainClock.autoAdvance=false
        show()
        state.value=recording.copy(result=RepResult(RepOutcome.Missed(RepFeedback.TOO_FAST),1))
        compose.mainClock.advanceTimeBy(2000)
        state.value=recording.copy(result=RepResult(RepOutcome.Missed(RepFeedback.TOO_FAST),2))
        compose.mainClock.advanceTimeBy(2000)
        compose.onNodeWithText(text(R.string.coach_missed_fast)).assertIsDisplayed()
    }
    @Test fun aMissedAttemptSaysWhatToChange() {
        show()
        state.value=recording.copy(result=RepResult(RepOutcome.Missed(RepFeedback.INCOMPLETE_RANGE),1))
        compose.onNodeWithText(text(R.string.coach_missed_range)).assertExists()
        state.value=recording.copy(result=RepResult(RepOutcome.Missed(RepFeedback.TOO_FAST),2))
        compose.onNodeWithText(text(R.string.coach_missed_fast)).assertExists()
        state.value=recording.copy(result=RepResult(RepOutcome.Missed(RepFeedback.TIMED_OUT),3))
        compose.onNodeWithText(text(R.string.coach_missed_slow)).assertExists()
    }
    @Test fun theMeasurementPanelGivesTheHoldInSeconds() {
        // Issue #97: "hold for at least 100 ms" becomes "hold it for 0.1 seconds".
        compose.setContent {MotivanceTheme {Surface {MeasurementControls(recording,true,false,true,{},{},{})}}}
        compose.onNodeWithText(text(R.string.measurement_reach,90,text(R.string.duration_seconds,"0.1"))).assertIsDisplayed()
    }
    @Test fun aRuleWithoutAHoldDoesNotAskForOne() {
        compose.setContent {MotivanceTheme {Surface {MeasurementControls(recording.copy(rules=ExerciseRules(peakHoldMs=0)),true,false,true,{},{},{})}}}
        compose.onNodeWithText(text(R.string.measurement_reach_no_hold,90)).assertIsDisplayed()
    }
}

/** Issue #96: the patient's choice to silence the voice survives leaving the screen and restarting the app. */
class RepSoundSettingTest {
    @get:Rule val compose=createComposeRule()
    private val context:Context get()=InstrumentationRegistry.getInstrumentation().targetContext
    @Before fun forget() {RepSoundSetting.clear(context)}
    @After fun restore() {RepSoundSetting.clear(context)}

    @Test fun theVoiceIsOnUntilThePatientTurnsItOff() {
        assertTrue(RepSoundSetting(context).enabled)
        RepSoundSetting(context).enabled=false
        assertFalse(RepSoundSetting(context).enabled)
        RepSoundSetting(context).enabled=true
        assertTrue(RepSoundSetting(context).enabled)
    }
    @Test fun theToggleSwitchesTheVoiceAndRemembersIt() {
        compose.setContent {MotivanceTheme {Surface {
            var on by remember {mutableStateOf(RepSoundSetting(context).enabled)}
            RepSoundToggle(on) {on=it; RepSoundSetting(context).enabled=it}
        }}}
        compose.onNodeWithText(context.getString(R.string.rep_sound_on)).assertIsDisplayed().performClick()
        compose.onNodeWithText(context.getString(R.string.rep_sound_off)).assertIsDisplayed()
        assertFalse(RepSoundSetting(context).enabled)
        compose.onNodeWithText(context.getString(R.string.rep_sound_off)).performClick()
        assertTrue(RepSoundSetting(context).enabled)
    }
}
