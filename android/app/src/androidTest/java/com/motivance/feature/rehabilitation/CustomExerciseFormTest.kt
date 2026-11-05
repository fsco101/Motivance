package com.motivance.feature.rehabilitation

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
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

class CustomExerciseFormTest {
    @get:Rule val compose=createComposeRule()
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private fun text(id:Int)=context.getString(id)
    private val elbow=CatalogueExercise("elbow","Fixture elbow","elbow-flexion-v1","Bend the elbow.")
    private val custom=CatalogueExercise("custom-version","Seated knee extension","joint-angle-v1","Sit tall.","custom-exercise",true,true,BodyJoint.KNEE)
    private fun workspace(vararg items:CatalogueExercise)=RehabilitationState(owner="therapist",workspace=RehabWorkspace(patients=listOf(LinkedPatient("patient","Fixture patient")),catalogue=items.toList()))

    @Test fun aTherapistWritesAnExerciseAndCanAssignItStraightAway() {
        var state by mutableStateOf(workspace(elbow))
        var drafted:CustomExerciseDraft?=null
        var published:PrescriptionDraft?=null
        compose.setContent {MotivanceTheme {Surface {Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
            PrescriptionEditor(state,"patient",onCreateExercise={draft,created ->
                drafted=draft; state=workspace(elbow,custom); created("custom-version")
            },onPublish={published=it})
        }}}}
        compose.onNodeWithText(text(R.string.custom_exercise_add)).performScrollTo().performClick()
        val save=compose.onNodeWithText(text(R.string.custom_exercise_save))
        save.performScrollTo().assertIsNotEnabled()

        compose.onNodeWithText(text(R.string.custom_exercise_name)).performScrollTo().performTextInput(" Seated knee extension ")
        compose.onAllNodesWithText(text(R.string.skeleton_knee)).onFirst().performScrollTo().performClick()
        compose.onNodeWithText(text(R.string.custom_zero_straight)).assertExists()
        save.performScrollTo().assertIsNotEnabled() // Instructions are still missing.
        compose.onNodeWithText(text(R.string.custom_exercise_instructions)).performScrollTo().performTextInput("Sit tall.")
        save.performScrollTo().assertIsEnabled().performClick()

        assertEquals(BodyJoint.KNEE,drafted!!.joint)
        assertEquals(" Seated knee extension ",drafted!!.name)
        compose.onNodeWithText(text(R.string.custom_exercise_save)).assertDoesNotExist()
        // Listed and already selected, so the review card names it too.
        compose.onAllNodesWithText("Seated knee extension").assertCountEquals(2)
        compose.onNodeWithText(text(R.string.publish_prescription)).performScrollTo().performClick()
        assertEquals("custom-version",published!!.exerciseId)
    }

    @Test fun removingAnExerciseAsksFirstAndClearsTheSelection() {
        var removed:String?=null
        var published:PrescriptionDraft?=null
        compose.setContent {MotivanceTheme {Surface {Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
            PrescriptionEditor(workspace(elbow,custom),"patient",onArchiveExercise={removed=it},onPublish={published=it})
        }}}}
        compose.onNodeWithText("Seated knee extension").performScrollTo().performClick()
        compose.onNodeWithText(text(R.string.custom_exercise_remove)).performScrollTo().performClick()
        compose.onNodeWithText(text(R.string.custom_exercise_keep)).performClick()
        assertNull(removed)

        compose.onNodeWithText(text(R.string.custom_exercise_remove)).performScrollTo().performClick()
        compose.onNode(hasText(text(R.string.custom_exercise_remove)) and hasAnyAncestor(isDialog())).performClick()
        assertEquals("custom-exercise",removed)
        compose.onNodeWithText(text(R.string.publish_prescription)).performScrollTo().assertIsNotEnabled()
        assertNull(published)
    }

    @Test fun exercisesThatCannotBeChosenAreNotOffered() {
        val retired=custom.copy(selectable=false)
        compose.setContent {MotivanceTheme {Surface {Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
            PrescriptionEditor(workspace(elbow,retired),"patient",onPublish={})
        }}}}
        compose.onNodeWithText("Fixture elbow").assertExists()
        compose.onNodeWithText("Seated knee extension").assertDoesNotExist()
    }
}
