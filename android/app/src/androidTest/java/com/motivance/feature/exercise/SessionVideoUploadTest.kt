package com.motivance.feature.exercise

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
import com.motivance.data.sync.QueuedVideo
import com.motivance.data.sync.VideoUploadState
import com.motivance.designsystem.MotivanceTheme
import com.motivance.domain.SharedVideo
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.util.Locale

/** #175: asking to record, the message after a recorded session and each upload status, in Filipino at twice the font size. */
class SessionVideoUploadTest {
    @get:Rule val compose = createComposeRule()
    private val base get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val queued = QueuedVideo("v1", "p1", "s1", "/q/v1.mp4", "/q/v1.jpg", 480, 270, 30_000)
    private val shared = SharedVideo("v1", "s1", "p1", "t1", 480, 270, 30_000, "m", "p", "2026-11-25T00:00:00Z", "2026-12-10T00:00:00Z")

    private fun show(scroll: Boolean = true, content: @Composable ColumnScope.() -> Unit): android.content.Context {
        val config = Configuration(base.resources.configuration).apply { setLocale(Locale.forLanguageTag("fil")); fontScale = 2f }
        val localized = base.createConfigurationContext(config)
        compose.setContent {
            CompositionLocalProvider(LocalContext provides localized, LocalConfiguration provides config, LocalDensity provides Density(base.resources.displayMetrics.density, 2f)) {
                MotivanceTheme { Surface { Column(Modifier.fillMaxSize().then(if (scroll) Modifier.verticalScroll(rememberScrollState()) else Modifier).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp), content = content) } }
            }
        }
        return localized
    }
    private fun capture(name: String) =
        File(base.getExternalFilesDir(null), name).outputStream().use { compose.onAllNodes(isRoot()).let { roots -> roots[roots.fetchSemanticsNodes().size - 1] }.captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it) }
    private fun tall(node: SemanticsNodeInteraction) = assertTrue(node.fetchSemanticsNode().boundsInRoot.height / base.resources.displayMetrics.density >= 48f)

    @Test fun finishScreenAsksToUploadAndNotNowLeavesTheUploadButton() {
        var uploads = 0
        lateinit var text: android.content.Context
        text = show {
            var later by remember { mutableStateOf(false) }
            if (!later) UploadVideoPrompt({ uploads++ }) { later = true }
            else VideoShareControls(null, false, null, onShare = { uploads++ }, onStop = null)
        }
        compose.onNodeWithText(text.getString(R.string.video_upload_ask)).assertIsDisplayed()
        compose.onNodeWithText(text.getString(R.string.video_upload_what)).performScrollTo().assertIsDisplayed()
        val upload = compose.onNode(hasText(text.getString(R.string.video_upload)) and hasClickAction())
        upload.performScrollTo(); tall(upload)
        capture("video-upload-prompt-fil.png")
        upload.performClick(); assertEquals(1, uploads)
        compose.onNode(hasText(text.getString(R.string.video_not_now)) and hasClickAction()).performScrollTo().performClick()
        compose.onNodeWithTag("upload_prompt").assertDoesNotExist()
        compose.onNode(hasText(text.getString(R.string.video_share)) and hasClickAction()).assertIsDisplayed()
    }

    @Test fun eachStatusReadsInFilipino() {
        var state by mutableStateOf<Pair<SharedVideo?, QueuedVideo?>>(null to queued)
        var cancelled = 0; var retried = 0
        val text = show {
            VideoShareControls(state.first, false, null, onShare = {}, onStop = {}, queued = state.second, onCancel = { cancelled++ }, onRetry = { retried++ })
        }
        // Waiting to upload, which can be cancelled.
        compose.onNodeWithText(text.getString(R.string.video_status_waiting)).assertIsDisplayed()
        val cancel = compose.onNode(hasText(text.getString(R.string.video_cancel_upload)) and hasClickAction())
        tall(cancel); cancel.performClick(); assertEquals(1, cancelled)
        capture("video-status-waiting-fil.png")
        // Uploading, with its progress.
        state = null to queued.copy(state = VideoUploadState.UPLOADING, progress = .42f)
        compose.onNodeWithText(text.getString(R.string.video_status_uploading, 42)).assertIsDisplayed()
        capture("video-status-uploading-fil.png")
        // Couldn't upload, with the reason and Try again.
        state = null to queued.copy(state = VideoUploadState.FAILED, reason = "video_rate_limited")
        compose.onNodeWithText(text.getString(R.string.video_status_failed, text.getString(R.string.video_share_error_rate))).performScrollTo().assertIsDisplayed()
        val retry = compose.onNode(hasText(text.getString(R.string.video_try_again)) and hasClickAction())
        retry.performScrollTo(); tall(retry); retry.performClick(); assertEquals(1, retried)
        capture("video-status-failed-fil.png")
        // Shared until a date.
        state = shared to null
        compose.onNodeWithTag("video_status").assertTextContains(text.getString(R.string.video_status_shared, sharedUntil(shared)))
        capture("video-status-shared-fil.png")
    }

    @Test fun theQuestionLeadsWithTheBenefitInFilipino() {
        val text = show(scroll = false) { RecordConsentText() }
        val benefit = compose.onNodeWithText(text.getString(R.string.video_consent_benefit))
        benefit.assertIsDisplayed()
        // The benefit comes before what is recorded.
        assertTrue(benefit.fetchSemanticsNode().boundsInRoot.top < compose.onNodeWithText(text.getString(R.string.video_consent_point1), substring = true).fetchSemanticsNode().boundsInRoot.top)
        compose.onNodeWithText(text.getString(R.string.video_consent_point5), substring = true).performScrollTo().assertIsDisplayed()
        capture("video-consent-fil.png")
    }

    /** A dialog is a window of its own and reads the phone's language, so its buttons are checked in that language. */
    @Test fun dontAskAgainIsOfferedOnlyWhenTheAppAsksAgain() {
        var answer = ""
        var again by mutableStateOf(false)
        compose.setContent { MotivanceTheme { RecordConsentDialog({ answer = "later" }, if (again) ({ answer = "never" }) else null) { answer = "yes" } } }
        compose.onNodeWithText(base.getString(R.string.video_never_ask)).assertDoesNotExist()
        compose.onNode(hasText(base.getString(R.string.video_consent_accept)) and hasClickAction()).performClick()
        assertEquals("yes", answer)
        compose.onNode(hasText(base.getString(R.string.video_consent_decline)) and hasClickAction()).performClick()
        assertEquals("later", answer)
        again = true
        compose.onNode(hasText(base.getString(R.string.video_never_ask)) and hasClickAction()).performClick()
        assertEquals("never", answer)
    }

    @Test fun theSwitchStartsOnWhenAgreedAndSaysWhyWhenOff() {
        var on by mutableStateOf(true)
        val text = show { RecordChoice(on) { on = it } }
        compose.onNodeWithTag("record_off_note", useUnmergedTree = true).assertDoesNotExist()
        compose.onNode(isToggleable()).assertIsOn().performClick()
        assertFalse(on)
        compose.onNodeWithText(text.getString(R.string.video_record_off_note)).assertIsDisplayed()
        capture("video-record-off-fil.png")
    }
}
