package com.motivance.feature.rehabilitation

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import com.motivance.R
import com.motivance.designsystem.MotivanceTheme
import com.motivance.domain.*
import org.junit.*
import org.junit.Assert.*

class PrescribedFocusTest {
    @get:Rule val compose=createComposeRule()
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    @Test fun therapistSelectsAssignedFocusAndSideInPrescriptionEditor() {
        var submitted:PrescriptionDraft?=null
        val state=RehabilitationState(owner="therapist",workspace=RehabWorkspace(patients=listOf(LinkedPatient("patient","Fixture patient")),catalogue=listOf(CatalogueExercise("exercise","Fixture elbow","elbow-flexion-v1","Fixture"))))
        compose.setContent {MotivanceTheme {Surface {Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
            PrescriptionEditor(state,"patient",onPublish={submitted=it})
        }}}}
        compose.onNodeWithText(context.getString(R.string.select_exercise)).performScrollTo().performClick()
        compose.onNodeWithText("Fixture elbow").performClick()
        compose.onNodeWithText(context.getString(R.string.right_side)).performScrollTo().performClick()
        compose.onNodeWithText(context.getString(R.string.focus_automatic)).performScrollTo().performClick()
        compose.onNodeWithText(context.getString(R.string.skeleton_knee)).performClick()
        compose.onNodeWithText(context.getString(R.string.publish_prescription)).performScrollTo().performClick()
        assertEquals(BodyJoint.KNEE,submitted!!.focusJoint)
        assertEquals(BodySide.RIGHT,submitted!!.side)
        assertEquals("exercise",submitted!!.exerciseId)
    }

    @Test fun invalidRangeBlocksPublishingAndExplainsWhy() {
        var submitted:PrescriptionDraft?=null
        val state=RehabilitationState(owner="therapist",workspace=RehabWorkspace(patients=listOf(LinkedPatient("patient","Fixture patient")),catalogue=listOf(CatalogueExercise("exercise","Fixture elbow","elbow-flexion-v1","Bend and straighten the elbow."))))
        compose.setContent {MotivanceTheme {Surface {Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
            PrescriptionEditor(state,"patient",onPublish={submitted=it})
        }}}}
        compose.onNodeWithText("Fixture elbow").performScrollTo().performClick()
        capture("assignment-editor-top.png")
        compose.onNodeWithText(context.getString(R.string.ui_reach_angle)).performScrollTo().performTextReplacement("25")
        compose.onNodeWithText(context.getString(R.string.ui_range_error)).assertExists()
        compose.onNodeWithText(context.getString(R.string.publish_prescription)).performScrollTo().assertIsNotEnabled()
        compose.onNodeWithText(context.getString(R.string.ui_reach_angle)).performScrollTo().performTextReplacement("120")
        compose.onNodeWithText(context.getString(R.string.ui_increase)).assertDoesNotExist()
        compose.onNodeWithContentDescription(context.getString(R.string.ui_increase)).performScrollTo().performClick()
        compose.onNodeWithText(context.getString(R.string.ui_range_help)).performScrollTo()
        capture("assignment-editor-targets.png")
        compose.onNodeWithText(context.getString(R.string.publish_prescription)).performScrollTo().assertIsEnabled()
        capture("assignment-editor-review.png")
        compose.onNodeWithText(context.getString(R.string.publish_prescription)).performClick()
        assertEquals(120.0,submitted!!.high,0.0)
        assertEquals(6,submitted!!.repetitions)
    }

    private fun capture(name:String) {
        java.io.File(context.getExternalFilesDir(null),name).outputStream().use {
            compose.onRoot().captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)
        }
    }
}
