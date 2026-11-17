package com.motivance.feature.rehabilitation

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import com.motivance.R
import com.motivance.designsystem.MotivanceTheme
import com.motivance.designsystem.displayDate
import com.motivance.domain.*
import org.junit.*
import org.junit.Assert.*
import java.time.LocalDate

/** A therapist plans exercise by the calendar on the phone (#126): the record's schedules and the schedule form. */
class ExerciseScheduleTest {
    @get:Rule val compose=createComposeRule()
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private val today=LocalDate.parse("2026-11-18")
    private val schedule=ExerciseSchedule("s1","patient","therapist","Dana Reyes",LocalDate.parse("2026-11-16"),LocalDate.parse("2026-11-29"),setOf(7),
        listOf(LocalDate.parse("2026-11-20")),11,3,1,ScheduleState.EXERCISE,9,LocalDate.parse("2026-11-19"))
    private val theirs=schedule.copy(id="s2",therapistId="colleague",therapistName="Leo Cruz",startsOn=LocalDate.parse("2026-12-10"),endsOn=LocalDate.parse("2026-12-20"),
        restWeekdays=emptySet(),restDates=emptyList(),state=ScheduleState.UPCOMING)
    private val elbow=PrescriptionSummary("a1","v1","patient","exercise",1,"left",20.0,90.0,5,scheduleId="s1",therapistId="therapist")
    private val everyDay=PrescriptionSummary("a2","v2","patient","exercise",1,"right",10.0,80.0,8,therapistId="therapist")
    private val state=RehabilitationState(owner="therapist",workspace=RehabWorkspace(patients=listOf(LinkedPatient("patient","Rosa Lim")),
        catalogue=listOf(CatalogueExercise("exercise","Fixture elbow","elbow-flexion-v1","Bend and straighten the elbow.")),prescriptions=listOf(elbow,everyDay)),
        days=mapOf("patient" to ExerciseDay(today,listOf(DayExercise("a1","s1","therapist",due=true,done=true),DayExercise("a2",null,"therapist",due=true,done=false)),listOf(schedule,theirs))))

    private fun text(id:Int,vararg args:Any)=context.getString(id,*args)
    private fun record(state:RehabilitationState=this.state,ended:(String)->Unit={},stopped:(String)->Unit={},added:(ExerciseSchedule)->Unit={}) {
        compose.setContent {MotivanceTheme {Surface {Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            PatientSchedules(state,"patient","Rosa Lim",ended,stopped,newSchedule={},editSchedule={},addExercise=added,assignEveryDay={},editPlan={},share=null)
        }}}}
    }

    @Test fun theRecordShowsEachScheduleWithItsDaysAndTodaysState() {
        var added:ExerciseSchedule?=null
        record(added={added=it})
        compose.onNodeWithText(text(R.string.exercise_schedule_range,displayDate("2026-11-16"),displayDate("2026-11-29"))).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.exercise_schedule_state_exercise)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.exercise_schedule_today_done)).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(text(R.string.exercise_schedule_today_todo)).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(text(R.string.exercise_schedule_every_day)).performScrollTo().assertIsDisplayed()
        compose.onAllNodesWithText(text(R.string.exercise_schedule_add_exercise))[0].performScrollTo().performClick()
        assertEquals("s1",added?.id)
    }

    @Test fun anotherTherapistsScheduleShowsWhoSetItAndCannotBeChangedHere() {
        record()
        compose.onNodeWithText(text(R.string.exercise_schedule_set_by,"Leo Cruz")).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(text(R.string.exercise_schedule_state_upcoming,displayDate("2026-12-10"))).performScrollTo().assertIsDisplayed()
        // Only the therapist's own schedule offers changes.
        compose.onAllNodesWithText(text(R.string.exercise_schedule_end)).assertCountEquals(1)
    }

    @Test fun endingAndRemovingAskFirstAndNameThePatient() {
        var ended:String?=null; var stopped:String?=null
        record(ended={ended=it},stopped={stopped=it})
        compose.onNodeWithText(text(R.string.exercise_schedule_end)).performScrollTo().performClick()
        compose.onNodeWithText(text(R.string.exercise_schedule_end_started,"Rosa Lim")).assertIsDisplayed()
        compose.onAllNodesWithText(text(R.string.exercise_schedule_end)).filterToOne(hasAnyAncestor(isDialog())).performClick()
        assertEquals("s1",ended)
        compose.onAllNodesWithText(text(R.string.exercise_schedule_remove))[0].performScrollTo().performClick()
        compose.onNodeWithText(text(R.string.exercise_schedule_remove_message,"Fixture elbow","Rosa Lim")).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.exercise_schedule_remove_confirm)).performClick()
        assertEquals("a1",stopped)
    }

    @Test fun anEmptyRecordOffersASchedule() {
        record(state.copy(workspace=state.workspace.copy(prescriptions=emptyList()),days=mapOf("patient" to ExerciseDay(today))))
        compose.onNodeWithText(text(R.string.exercise_schedule_none_title)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.exercise_schedule_every_day_assign)).assertIsDisplayed()
    }

    @Test fun theFormCountsDaysAndSavesRestWeekdays() {
        var saved:ScheduleDraft?=null
        compose.setContent {MotivanceTheme {Surface {Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
            ScheduleForm(state,"patient",null,today,cancel={}) {saved=it}
        }}}}
        // Two weeks from Wednesday 18 November: a Sunday rest day falls twice.
        compose.onNodeWithText(text(R.string.exercise_schedule_summary,context.resources.getQuantityString(R.plurals.exercise_schedule_exercise_days,14,14),
            context.resources.getQuantityString(R.plurals.exercise_schedule_rest_days,0,0))).performScrollTo().assertIsDisplayed()
        compose.onNodeWithContentDescription(weekdayName(7)).performScrollTo().performClick()
        compose.onNodeWithText(text(R.string.exercise_schedule_summary,context.resources.getQuantityString(R.plurals.exercise_schedule_exercise_days,12,12),
            context.resources.getQuantityString(R.plurals.exercise_schedule_rest_days,2,2))).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(text(R.string.exercise_schedule_save)).performScrollTo().performClick()
        assertEquals(setOf(7),saved!!.restWeekdays)
        assertEquals(today,saved!!.startsOn)
        assertEquals(today.plusDays(13),saved!!.endsOn)
    }

    @Test fun theFormRefusesAWeekWithNoExerciseDay() {
        var saved:ScheduleDraft?=null
        compose.setContent {MotivanceTheme {Surface {Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
            ScheduleForm(state,"patient",null,today,cancel={}) {saved=it}
        }}}}
        (1..7).forEach {compose.onNodeWithContentDescription(weekdayName(it)).performScrollTo().performClick()}
        compose.onNodeWithText(text(R.string.exercise_schedule_problem_all_rest)).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(text(R.string.exercise_schedule_save)).performScrollTo().assertIsNotEnabled()
        assertNull(saved)
    }

    @Test fun aStartedScheduleKeepsItsStartDate() {
        compose.setContent {MotivanceTheme {Surface {Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
            ScheduleForm(state,"patient",schedule,today,cancel={}) {}
        }}}}
        compose.onNodeWithText(text(R.string.exercise_schedule_started_hint)).assertIsDisplayed()
        compose.onNodeWithText(displayDate("2026-11-20")).performScrollTo().assertIsDisplayed()
    }
}
