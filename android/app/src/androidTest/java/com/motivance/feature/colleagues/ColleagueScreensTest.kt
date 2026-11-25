package com.motivance.feature.colleagues

import android.content.res.Configuration
import android.graphics.Bitmap
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.*
import androidx.test.platform.app.InstrumentationRegistry
import com.motivance.R
import com.motivance.designsystem.MotivanceTheme
import com.motivance.domain.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.util.Locale

/** #173: inviting, accepting, a colleague's patient shown read-only, and ending the link, in English and in Filipino at twice the font size. */
class ColleagueScreensTest {
    @get:Rule val compose = createComposeRule()
    private val base get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun show(language: String, content: @Composable ColumnScope.() -> Unit): android.content.Context {
        val config = Configuration(base.resources.configuration).apply { setLocale(Locale.forLanguageTag(language)); if (language == "fil") fontScale = 2f }
        val localized = base.createConfigurationContext(config)
        compose.setContent {
            CompositionLocalProvider(LocalContext provides localized, LocalConfiguration provides config, LocalDensity provides Density(base.resources.displayMetrics.density, config.fontScale)) {
                MotivanceTheme { Surface { Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp), content = content) } }
            }
        }
        return localized
    }
    private fun capture(name: String) =
        File(base.getExternalFilesDir(null), name).outputStream().use { compose.onAllNodes(isRoot()).let { roots -> roots[roots.fetchSemanticsNodes().size - 1] }.captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it) }

    private fun linkFlow(language: String) {
        val calls = mutableListOf<String>()
        var colleagues by mutableStateOf(listOf(Colleague("l1", ColleagueState.REQUESTED, true, "t2", "Omar Cruz")))
        val text = show(language) {
            ColleaguesCard(colleagues, false, { calls += "invite:$it" }, { c, accept -> calls += "respond:$accept"; colleagues = listOf(c.copy(state = ColleagueState.ACTIVE)) }, { calls += "end:${it.id}"; colleagues = emptyList() })
        }
        // An incoming invitation is accepted.
        compose.onNodeWithText(text.getString(R.string.colleagues_invited_you)).assertExists()
        compose.onNode(hasText(text.getString(R.string.colleagues_accept)) and hasClickAction()).performScrollTo().performClick()
        compose.onNodeWithText(text.getString(R.string.colleagues_linked)).assertExists()
        capture("colleagues-linked-$language.png")
        // Ending asks first.
        compose.onNode(hasText(text.getString(R.string.colleagues_end)) and hasClickAction()).performScrollTo().performClick()
        // Dialogs are windows of their own and read the phone's language.
        compose.onAllNodes(hasText(base.getString(R.string.colleagues_end)) and hasClickAction()).onLast().performClick()
        compose.onNodeWithText(text.getString(R.string.colleagues_none)).assertExists()
        // Inviting by email.
        compose.onNode(hasText(text.getString(R.string.colleagues_invite)) and hasClickAction()).performScrollTo().performClick()
        compose.onNode(hasSetTextAction()).performTextInput("omar@example.test")
        compose.onNode(hasText(base.getString(R.string.colleagues_send)) and hasClickAction()).performClick()
        assertEquals(listOf("respond:true", "end:l1", "invite:omar@example.test"), calls)
    }

    @Test fun invitingAcceptingAndEndingInEnglish() = linkFlow("en")
    @Test fun invitingAcceptingAndEndingInFilipinoAtDoubleFont() = linkFlow("fil")

    private fun readOnly(language: String) {
        var opened: String? = null
        val text = show(language) {
            ColleaguePatientsCard(listOf(ColleaguePatient("p1", "Rosa Lim", null, "t1", "Dana Reyes"))) { opened = it }
            ColleaguePatientHeader(OpenedColleaguePatient("p1", "Rosa Lim", null, listOf("Dana Reyes")))
            ColleaguePlanCard(listOf(ColleaguePlanItem("a1", "Elbow flexion", "left", 20.0, 90.0, 8)))
        }
        compose.onAllNodesWithText(text.getString(R.string.colleagues_patient_of, "Dana Reyes"), substring = true).assertCountEquals(2)
        compose.onNodeWithText(text.getString(R.string.colleagues_read_only)).assertExists()
        compose.onNodeWithText(text.getString(R.string.colleagues_colleague_patient)).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(text.getString(R.string.colleagues_read_only_detail)).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(text.getString(R.string.colleagues_plan_line, text.getString(R.string.left_side), 20, 90, 8)).performScrollTo().assertIsDisplayed()
        // Nothing here prescribes, schedules or messages.
        listOf(R.string.chat_message_patient, R.string.exercise_assignment).forEach { compose.onNodeWithText(text.getString(it)).assertDoesNotExist() }
        capture("colleague-patient-$language.png")
        compose.onNode(hasText("Rosa Lim") and hasClickAction()).performScrollTo().performClick()
        assertEquals("p1", opened)
    }

    @Test fun aColleaguesPatientIsReadOnlyInEnglish() = readOnly("en")
    @Test fun aColleaguesPatientIsReadOnlyInFilipinoAtDoubleFont() = readOnly("fil")

    @Test fun thePatientTurnsSharingOnInFilipino() {
        var granted by mutableStateOf(false)
        val text = show("fil") { ColleagueSharingCard(granted) { granted = it } }
        compose.onNodeWithText(text.getString(R.string.colleagues_sharing_off)).performScrollTo().assertIsDisplayed()
        compose.onNode(isToggleable()).performScrollTo().assertIsOff().performClick()
        assertTrue(granted)
        compose.onNodeWithText(text.getString(R.string.colleagues_sharing_on)).performScrollTo().assertIsDisplayed()
        capture("colleague-sharing-fil.png")
    }
}
