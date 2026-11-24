package com.motivance.feature.rehabilitation

import android.content.res.Configuration
import android.graphics.Bitmap
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.*
import androidx.test.platform.app.InstrumentationRegistry
import com.motivance.R
import com.motivance.designsystem.*
import com.motivance.domain.LinkedPatient
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.util.Locale

/** #174: a therapist sees whose progress they are reading, with the patient's photo or initials, in Filipino at twice the font size. */
class ProgressPatientHeaderTest {
    @get:Rule val compose = createComposeRule()
    private val base get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val photoPath = "20000000-0000-0000-0000-000000000001/0123456789abcdef0123456789abcdef.webp"
    private val ana = LinkedPatient("20000000-0000-0000-0000-000000000001", "Ana Dela Cruz", photoUrl = photoPath)
    private val ben = LinkedPatient("20000000-0000-0000-0000-000000000002", "Ben Santos")

    private fun show(content: @Composable () -> Unit): android.content.Context {
        avatarAddress(photoPath)?.let { AvatarImages.put(it, Bitmap.createBitmap(4, 4, Bitmap.Config.ARGB_8888).apply { eraseColor(android.graphics.Color.RED) }.asImageBitmap()) }
        val config = Configuration(base.resources.configuration).apply { setLocale(Locale.forLanguageTag("fil")); fontScale = 2f }
        val localized = base.createConfigurationContext(config)
        compose.setContent {
            CompositionLocalProvider(LocalContext provides localized, LocalConfiguration provides config, LocalDensity provides Density(base.resources.displayMetrics.density, 2f)) {
                MotivanceTheme { Surface { Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) { content() } } }
            }
        }
        return localized
    }

    /** The open menu is a window of its own, so the last root is what is on top. */
    private fun capture(name: String) =
        File(base.getExternalFilesDir(null), name).outputStream().use { compose.onAllNodes(isRoot()).let { roots -> roots[roots.fetchSemanticsNodes().size - 1] }.captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it) }

    @Test fun headerWithPhotoOpensTheRecordAndReadsOnlyTheName() {
        var opened: String? = null
        val localized = show { ProgressPatientHeader(ana) { opened = ana.id } }
        val header = compose.onNodeWithTag("progress_patient")
        header.assertIsDisplayed().assertHasClickAction()
        header.assert(hasText("Ana Dela Cruz") and hasText(localized.getString(R.string.progress_open_record)))
        // The photo is shown, and a screen reader hears no initials.
        compose.onNodeWithTag(AVATAR_PHOTO, useUnmergedTree = true).assertExists()
        compose.onNodeWithText("AD").assertDoesNotExist()
        assertTrue(header.fetchSemanticsNode().boundsInRoot.height / base.resources.displayMetrics.density >= 48f)
        capture("progress-patient-photo-fil.png")
        header.performClick()
        assertEquals(ana.id, opened)
    }

    @Test fun headerWithoutPhotoShowsInitials() {
        show { ProgressPatientHeader(ben) {} }
        compose.onNodeWithTag(AVATAR_INITIALS, useUnmergedTree = true).assertExists()
        compose.onNodeWithTag(AVATAR_PHOTO, useUnmergedTree = true).assertDoesNotExist()
        compose.onNodeWithTag("progress_patient").assert(hasText("Ben Santos"))
        capture("progress-patient-initials-fil.png")
    }

    @Test fun choiceShowsEachPatientWithTheirFaceOrInitials() {
        var chosen by mutableStateOf(ana.id)
        val localized = show { PatientChoice(listOf(ana, ben), chosen) { chosen = it } }
        val button = compose.onNode(hasText("Ana Dela Cruz", substring = true) and hasClickAction())
        button.assertIsDisplayed()
        assertTrue(button.fetchSemanticsNode().boundsInRoot.height / base.resources.displayMetrics.density >= 48f)
        compose.onNodeWithTag(AVATAR_PHOTO, useUnmergedTree = true).assertExists()
        button.performClick()
        compose.onAllNodesWithTag(AVATAR_INITIALS, useUnmergedTree = true).assertCountEquals(1)
        compose.onAllNodesWithTag(AVATAR_PHOTO, useUnmergedTree = true).assertCountEquals(2)
        capture("progress-patient-choice-fil.png")
        compose.onNodeWithText("Ben Santos").performClick()
        compose.waitForIdle()
        assertEquals(ben.id, chosen)
        compose.onNode(hasText(localized.getString(R.string.select_patient), substring = true) and hasText("Ben Santos", substring = true)).assertExists()
        compose.onNodeWithTag(AVATAR_INITIALS, useUnmergedTree = true).assertExists()
    }
}
