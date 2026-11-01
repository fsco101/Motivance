package com.motivance.feature.auth

import android.content.res.Configuration
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import com.motivance.R
import com.motivance.designsystem.MotivanceTheme
import com.motivance.domain.UserRole
import java.io.File
import java.util.Locale
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class AuthScreenTest {
    @get:Rule val compose = createComposeRule()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val state = mutableStateOf(AuthState())
    private val submissions = mutableListOf<List<Any>>()
    private fun text(id: Int) = context.getString(id)
    private fun button(id: Int) = compose.onNode(hasText(text(id)) and hasClickAction())
    private fun display(role: UserRole = UserRole.PATIENT) {
        compose.setContent {
            MotivanceTheme { Surface {
                AuthContent(state.value, role, { action, email, password, code ->
                    submissions += listOf(action, email, password, code)
                    state.value = AuthState(busy = true)
                }, { state.value = state.value.copy(notice = null) }, {}, {})
            } }
        }
    }
    private fun capture(name: String) {
        compose.waitForIdle()
        val output = File(context.getExternalFilesDir(null), "auth-$name.png")
        output.outputStream().use {
            compose.onRoot().captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
        assertTrue(output.length() > 0)
    }
    @Test fun loginSubmitsOnceAndDisablesInputsDuringLoading() {
        display()
        capture("login")
        compose.onNodeWithText(text(R.string.email)).performTextInput("patient@example.test")
        compose.onNodeWithText(text(R.string.auth_password)).performTextInput("fixture-password")
        compose.onNodeWithContentDescription(text(R.string.auth_show_password)).performClick()
        compose.onNodeWithContentDescription(text(R.string.auth_hide_password)).assertExists()
        compose.onNodeWithContentDescription(text(R.string.auth_hide_password)).performClick()
        button(R.string.sign_in).performScrollTo().performClick()
        button(R.string.auth_signing_in).assertIsNotEnabled()
        compose.onNodeWithText(text(R.string.email)).assertIsNotEnabled()
        button(R.string.auth_create_account).assertIsNotEnabled()
        assertEquals(listOf(AuthAction.SIGN_IN, "patient@example.test", "fixture-password", ""), submissions.single())
        capture("busy")
    }
    @Test fun signupPreservesEmailClearsPasswordAndAdvancesToConfirmation() {
        display()
        compose.onNodeWithText(text(R.string.email)).performTextInput("patient@example.test")
        compose.onNodeWithText(text(R.string.auth_password)).performTextInput("old-password")
        button(R.string.auth_create_account).performScrollTo().performClick()
        compose.onNodeWithText(text(R.string.auth_signup_heading)).performScrollTo()
        compose.onNode(hasText(text(R.string.auth_password)) and hasSetTextAction()).assertTextContains("", substring = false)
        capture("signup")
        compose.onNodeWithText(text(R.string.auth_password)).performTextInput("new-password")
        button(R.string.auth_create_account).performScrollTo().performClick()
        assertEquals(listOf(AuthAction.REGISTER, "patient@example.test", "new-password", ""), submissions.single())
        compose.runOnIdle { state.value = AuthState(notice = AuthNotice.CONFIRM_EMAIL) }
        compose.onNodeWithText(text(R.string.auth_confirm_heading)).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(text(R.string.auth_password)).assertDoesNotExist()
        compose.onNodeWithText(text(R.string.auth_email_code)).performTextInput("123456")
        button(R.string.auth_verify_email).performScrollTo().performClick()
        assertEquals(listOf(AuthAction.CONFIRM, "patient@example.test", "", "123456"), submissions.last())
    }
    @Test fun unconfirmedSignInOffersConfirmationResend() {
        display()
        compose.onNodeWithText(text(R.string.email)).performTextInput("patient@example.test")
        compose.runOnIdle {state.value=AuthState(notice=AuthNotice.EMAIL_UNCONFIRMED)}
        compose.onNodeWithText(text(R.string.auth_confirm_heading)).performScrollTo().assertIsDisplayed()
        button(R.string.auth_resend_code).performScrollTo().performClick()
        assertEquals(listOf(AuthAction.RESEND_CONFIRMATION,"patient@example.test","",""),submissions.single())
        button(R.string.auth_resend_code).assertIsNotEnabled()
    }
    @Test fun recoveryResendDoesNotSubmitNewPasswordOrOldCode() {
        display()
        compose.onNodeWithText(text(R.string.email)).performTextInput("patient@example.test")
        compose.runOnIdle {state.value=AuthState(notice=AuthNotice.RECOVERY_SENT)}
        compose.onNodeWithText(text(R.string.auth_new_password)).performScrollTo().performTextInput("replacement")
        compose.onNodeWithText(text(R.string.auth_email_code)).performScrollTo().performTextInput("123456")
        button(R.string.auth_resend_code).performScrollTo().performClick()
        assertEquals(listOf(AuthAction.REQUEST_RECOVERY,"patient@example.test","",""),submissions.single())
    }
    @Test fun recoveryHasDistinctCodeAndNewPasswordSteps() {
        display()
        button(R.string.auth_forgot_password).performScrollTo().performClick()
        compose.onNodeWithText(text(R.string.auth_password)).assertDoesNotExist()
        compose.onNodeWithText(text(R.string.email)).performTextInput("patient@example.test")
        button(R.string.auth_send_code).performScrollTo().performClick()
        assertEquals(AuthAction.REQUEST_RECOVERY, submissions.single()[0])
        compose.runOnIdle { state.value = AuthState(notice = AuthNotice.RECOVERY_SENT) }
        compose.onNodeWithText(text(R.string.auth_new_password)).performScrollTo().performTextInput("replacement")
        compose.onNodeWithText(text(R.string.auth_email_code)).performScrollTo().performTextInput("123456")
        button(R.string.auth_save_password).performScrollTo().performClick()
        assertEquals(listOf(AuthAction.RECOVER, "patient@example.test", "replacement", "123456"), submissions.last())
    }
    @Test fun therapistPortalDoesNotOfferPatientRegistration() {
        display(UserRole.THERAPIST)
        compose.onNodeWithText(text(R.string.clinical_portal)).assertIsDisplayed()
        button(R.string.auth_create_account).assertDoesNotExist()
        button(R.string.sign_in).assertIsEnabled()
        capture("therapist")
    }
    @Test fun loadingScreenShowsStatusWithoutSignInForm() {
        compose.setContent { MotivanceTheme { AuthLoadingScreen() } }
        compose.onNodeWithText(text(R.string.auth_restoring)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.email)).assertDoesNotExist()
        capture("loading")
    }
    @Test fun filipinoLargeTextOnNarrowScreenKeepsSignupAndRecoveryReachable() {
        val configuration = Configuration(context.resources.configuration).apply { setLocale(Locale.forLanguageTag("fil")) }
        val localized = context.createConfigurationContext(configuration)
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalContext provides localized, LocalConfiguration provides configuration,
                LocalDensity provides Density(density.density, 1.6f)) {
                MotivanceTheme { Box(Modifier.widthIn(max = 320.dp).fillMaxSize()) {
                    AuthContent(state.value, UserRole.PATIENT, { _, _, _, _ -> }, {}, {}, {})
                } }
            }
        }
        compose.onNode(hasText(localized.getString(R.string.auth_create_account)) and hasClickAction()).performScrollTo().performClick()
        compose.onNode(hasText(localized.getString(R.string.auth_create_account)) and hasClickAction()).performScrollTo().assertIsDisplayed()
        capture("signup-large-fil")
        compose.onNodeWithText(localized.getString(R.string.back_to_sign_in)).performScrollTo().performClick()
        compose.onNodeWithText(localized.getString(R.string.auth_forgot_password)).performScrollTo().performClick()
        compose.onNode(hasText(localized.getString(R.string.auth_send_code)) and hasClickAction()).performScrollTo().assertIsDisplayed()
    }
}
