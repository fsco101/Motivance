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
import com.motivance.domain.*
import org.junit.*
import org.junit.Assert.*

/** A therapist prescribes both sides of one exercise, with an optional time per side. */
class BothSidesEditorTest {
    @get:Rule val compose=createComposeRule()
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private val state=RehabilitationState(owner="therapist",workspace=RehabWorkspace(patients=listOf(LinkedPatient("patient","Fixture patient")),
        catalogue=listOf(CatalogueExercise("exercise","Fixture elbow","elbow-flexion-v1","Bend and straighten the elbow."))))

    @Test fun choosingBothAndATimePublishesThem() {
        var submitted:PrescriptionDraft?=null
        compose.setContent {MotivanceTheme {Surface {Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
            PrescriptionEditor(state,"patient",onPublish={submitted=it})
        }}}}
        compose.onNodeWithText("Fixture elbow").performScrollTo().performClick()
        compose.onNodeWithText(context.getString(R.string.both_sides)).performScrollTo().performClick()
        compose.onNodeWithText(context.getString(R.string.ui_set_time)).performScrollTo().performClick()
        compose.onNodeWithText(context.getString(R.string.ui_time_per_side)).performScrollTo().assertIsDisplayed()
        repeat(4) {compose.onNodeWithContentDescription(context.getString(R.string.ui_more_time)).performScrollTo().performClick()}
        compose.onNodeWithText("2:00").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(context.getString(R.string.ui_time_per_side_value,"2:00")).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(context.getString(R.string.publish_prescription)).performScrollTo().performClick()
        assertTrue(submitted!!.bilateral)
        assertEquals(BodySide.LEFT,submitted!!.side)
        assertEquals(120,submitted!!.sideSeconds)
    }

    @Test fun withoutATimeNoneIsPublished() {
        var submitted:PrescriptionDraft?=null
        compose.setContent {MotivanceTheme {Surface {Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
            PrescriptionEditor(state,"patient",onPublish={submitted=it})
        }}}}
        compose.onNodeWithText("Fixture elbow").performScrollTo().performClick()
        compose.onNodeWithText(context.getString(R.string.ui_no_time_limit)).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(context.getString(R.string.publish_prescription)).performScrollTo().performClick()
        assertFalse(submitted!!.bilateral)
        assertNull(submitted!!.sideSeconds)
    }

    @Test fun anExistingBothPlanOpensWithBothAndItsTime() {
        val existing=PrescriptionSummary("assignment","version","patient","exercise",1,"bilateral",20.0,90.0,5,"{\"side_seconds\":90}")
        compose.setContent {MotivanceTheme {Surface {Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
            PrescriptionEditor(state.copy(workspace=state.workspace.copy(prescriptions=listOf(existing))),"patient",existing,onPublish={})
        }}}}
        compose.onNode(hasText(context.getString(R.string.both_sides)) and isSelected()).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("1:30").performScrollTo().assertIsDisplayed()
    }
}
