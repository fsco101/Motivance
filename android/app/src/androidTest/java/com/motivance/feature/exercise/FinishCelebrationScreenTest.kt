package com.motivance.feature.exercise

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import com.motivance.R
import com.motivance.designsystem.MotivanceTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/** The moment between finishing and the results (#130). */
class FinishCelebrationScreenTest {
    @get:Rule val compose=createComposeRule()
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext

    @Test fun reachingTheTargetShowsWhatWasDoneAndTheLastOfTheDay() {
        compose.setContent {MotivanceTheme {FinishCelebration(10,10,98.4,lastOfDay=true,still=true) {}}}
        compose.onNodeWithText(context.getString(R.string.finish_title_target)).assertIsDisplayed()
        compose.onNodeWithText(context.getString(R.string.finish_reps,10,10)).assertIsDisplayed()
        compose.onNodeWithText(context.getString(R.string.finish_range,"98")).assertIsDisplayed()
        compose.onNodeWithText(context.getString(R.string.finish_day_done)).assertIsDisplayed()
    }

    @Test fun fallingShortIsStillAFinishSaidKindly() {
        compose.setContent {MotivanceTheme {FinishCelebration(8,10,null,lastOfDay=false,still=true) {}}}
        compose.onNodeWithText(context.getString(R.string.finish_title_short)).assertIsDisplayed()
        compose.onNodeWithText(context.getString(R.string.finish_reps,8,10)).assertIsDisplayed()
        compose.onNodeWithText(context.getString(R.string.finish_day_done)).assertDoesNotExist()
    }

    @Test fun aTapGoesStraightToTheResults() {
        var done=0
        compose.setContent {MotivanceTheme {FinishCelebration(10,10,null,lastOfDay=false,still=false) {done+=1}}}
        compose.onNodeWithText(context.getString(R.string.finish_tap)).performClick()
        assertEquals(1,done)
        // TalkBack says what a tap does.
        val label=context.getString(R.string.finish_tap)
        compose.onNode(SemanticsMatcher("tap label") {it.config.getOrNull(SemanticsActions.OnClick)?.label==label}).assertExists()
    }
}
