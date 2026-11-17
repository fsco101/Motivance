package com.motivance.feature.rehabilitation

import androidx.compose.foundation.layout.*
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
import java.time.LocalDate

/** What a patient reads on a day with nothing left to do (#127). */
class PatientTodayScreenTest {
    @get:Rule val compose=createComposeRule()
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private val tomorrow=LocalDate.parse("2026-11-19")

    private fun show(plan:DailyPlan<String>) = compose.setContent {MotivanceTheme {Surface {Column(Modifier.padding(16.dp)) {TodayProgress(plan); TodayNotice(plan)}}}}

    @Test fun allDoneNamesTheNextExerciseDay() {
        show(DailyPlan(emptyList(),2,2,TodayState.DONE,tomorrow,null))
        compose.onNodeWithText(context.getString(R.string.patient_all_done_title)).assertIsDisplayed()
        compose.onNodeWithText(context.getString(R.string.patient_all_done_next,displayDate(tomorrow.toString()))).assertIsDisplayed()
        compose.onNodeWithText(context.getString(R.string.patient_today_done,2,2)).assertIsDisplayed()
    }

    @Test fun aRestDaySaysSo() {
        show(DailyPlan(emptyList(),0,0,TodayState.REST,tomorrow,null))
        compose.onNodeWithText(context.getString(R.string.patient_rest_title)).assertIsDisplayed()
        compose.onNodeWithText(context.getString(R.string.patient_rest_next,displayDate(tomorrow.toString()))).assertIsDisplayed()
    }

    @Test fun aScheduleNotStartedSaysWhenItStarts() {
        show(DailyPlan(emptyList(),0,0,TodayState.UPCOMING,LocalDate.parse("2026-11-25"),LocalDate.parse("2026-11-25")))
        compose.onNodeWithText(context.getString(R.string.patient_upcoming_detail,displayDate("2026-11-25"))).assertIsDisplayed()
    }

    @Test fun theLastDayDoneSaysThereIsNoNextOne() {
        show(DailyPlan(emptyList(),1,1,TodayState.DONE,null,null))
        compose.onNodeWithText(context.getString(R.string.patient_all_done_last)).assertIsDisplayed()
    }
}
