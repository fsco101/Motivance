package com.motivance.feature.booking

import android.content.res.Configuration
import android.graphics.Bitmap
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.*
import androidx.test.platform.app.InstrumentationRegistry
import com.motivance.R
import com.motivance.designsystem.MotivanceTheme
import com.motivance.domain.Booking
import com.motivance.domain.BookingStatus
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.time.Instant
import java.util.Locale

/** #172: a rejected request says why in Filipino, with the center's note and a way to ask again, readable at twice the font size. */
class RejectedBookingTest {
    @get:Rule val compose = createComposeRule()
    private val base get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val rejected = Booking("b1", "BK-2026-000097", BookingStatus.REJECTED, "therapist_away", "2026-12-07T01:00:00Z", "2026-12-07T02:00:00Z", null, null,
        visitReason = "Pananakit ng tuhod", patient = "Ana Dela Cruz", note = "Babalik si Dana sa Lunes.")

    @Test fun rejectedBookingInFilipinoAtDoubleFontOffersRequestAgain() {
        val config = Configuration(base.resources.configuration).apply { setLocale(Locale.forLanguageTag("fil")); fontScale = 2f }
        val localized = base.createConfigurationContext(config)
        var again = 0
        compose.setContent {
            CompositionLocalProvider(LocalContext provides localized, LocalConfiguration provides config, LocalDensity provides Density(base.resources.displayMetrics.density, 2f)) {
                MotivanceTheme { Surface { Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) {
                    BookingCard(rejected, true, Instant.parse("2026-12-10T00:00:00Z"), {}, {}) { again++ }
                } } }
            }
        }
        compose.onNodeWithText(localized.getString(R.string.booking_reject_therapist_away), substring = true).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("therapist_away", substring = true).assertDoesNotExist()
        compose.onNodeWithText("Babalik si Dana sa Lunes.", substring = true).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(localized.getString(R.string.booking_request_again_hint)).performScrollTo().assertIsDisplayed()
        val button = compose.onNode(hasText(localized.getString(R.string.booking_request_again)) and hasClickAction())
        button.performScrollTo().assertIsDisplayed()
        assertTrue(button.fetchSemanticsNode().boundsInRoot.height / base.resources.displayMetrics.density >= 48f)
        File(base.getExternalFilesDir(null), "booking-rejected-large-fil.png").outputStream().use { compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it) }
        button.performClick()
        assertEquals(1, again)
    }

    @Test fun aSchedulersOwnWordsShowAsWritten() {
        compose.setContent { MotivanceTheme { Surface { Column(Modifier.verticalScroll(rememberScrollState())) {
            BookingCard(rejected.copy(reason = "The therapy room is being repaired.", note = null), true, Instant.parse("2026-12-10T00:00:00Z"), {}, {})
        } } } }
        compose.onNodeWithText("The therapy room is being repaired.", substring = true).assertExists()
        compose.onNodeWithText(base.getString(R.string.booking_note), substring = true).assertDoesNotExist()
    }
}
