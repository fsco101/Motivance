package com.motivance.feature.auth

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import java.io.File
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import com.motivance.R
import com.motivance.designsystem.MotivanceTheme
import com.motivance.domain.*
import org.junit.*
import org.junit.Assert.*

class PatientProfileTest {
    @get:Rule val compose=createComposeRule()
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private fun text(id:Int)=context.getString(id)
    private fun capture(name:String) {
        File(context.getExternalFilesDir(null),name).outputStream().use {compose.onRoot().captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
    }
    private val fixture=PatientProfile("fixture_user","Fixture Patient","female","1995-01-01","Fixture address","09001234567",null,true,"patient@example.test")
    private fun continueButton()=compose.onNode(hasText(text(R.string.signup_continue)) and hasClickAction())
    private fun openSignup(onRegister:(String,String,PatientProfile)->Unit,initial:PatientProfile=PatientProfile()) {
        compose.setContent {MotivanceTheme {Surface {AuthContent(AuthState(),{_,_,_,_->},{},{},{},onRegister=onRegister,initialProfile=initial)}}}
        compose.onNode(hasText(text(R.string.auth_create_account)) and hasClickAction()).performScrollTo().performClick()
    }
    private fun fillAccount() {
        compose.onNodeWithText(text(R.string.email)).performScrollTo().performTextInput("patient@example.test")
        compose.onNodeWithText(text(R.string.auth_password)).performScrollTo().performTextInput("fixture-password")
        compose.onNodeWithText(text(R.string.signup_confirm_password)).performScrollTo().performTextInput("fixture-password")
    }
    @Test fun signupStepsBlockIncompleteDetails() {
        var calls=0
        openSignup({_,_,_->calls++})
        // Mismatched confirmation keeps the patient on the sign-in step with a visible reason.
        compose.onNodeWithText(text(R.string.email)).performScrollTo().performTextInput("patient@example.test")
        compose.onNodeWithText(text(R.string.auth_password)).performScrollTo().performTextInput("fixture-password")
        compose.onNodeWithText(text(R.string.signup_confirm_password)).performScrollTo().performTextInput("different-pass")
        continueButton().performScrollTo().performClick()
        compose.onNodeWithText(text(R.string.form_password_match)).assertExists()
        compose.onNodeWithText(text(R.string.signup_fix_fields)).assertExists()
        compose.onNodeWithText(text(R.string.signup_step_counter).format(1,4)).assertExists()
        compose.onNodeWithText(text(R.string.signup_confirm_password)).performTextReplacement("fixture-password")
        continueButton().performScrollTo().performClick()
        // An empty personal step shows every missing field only after Continue.
        compose.onNodeWithText(text(R.string.signup_step_counter).format(2,4)).assertExists()
        compose.onNodeWithText(text(R.string.form_gender_required)).assertDoesNotExist()
        continueButton().performScrollTo().performClick()
        compose.onNodeWithText(text(R.string.signup_step_counter).format(2,4)).assertExists()
        compose.onNodeWithText(text(R.string.form_gender_required)).performScrollTo().assertExists()
        compose.onNodeWithText(text(R.string.form_birthdate_required)).assertExists()
        compose.onNode(hasText(text(R.string.auth_create_account)) and hasClickAction()).assertDoesNotExist()
        capture("signup-step-errors.png")
        assertEquals(0,calls)
    }
    @Test fun signupReviewRequiresConsentAndSubmitsTheReviewedProfile() {
        var submitted:Triple<String,String,PatientProfile>?=null
        openSignup({e,pw,p->submitted=Triple(e,pw,p)},fixture.copy(consent=false,email=""))
        fillAccount()
        compose.onNodeWithText(text(R.string.signup_confirm_password)).performImeAction()
        compose.onNodeWithText(text(R.string.signup_req_match)).performScrollTo().assertExists()
        capture("signup-step-account.png")
        continueButton().performScrollTo().performClick()
        compose.onNodeWithText(text(R.string.auth_signup_heading)).assertDoesNotExist()
        compose.onNodeWithText(context.getString(R.string.profile_age,fixture.age.toString())).performScrollTo().assertExists()
        capture("signup-step-personal.png")
        continueButton().performScrollTo().performClick()
        compose.onNodeWithText(text(R.string.profile_photo_later)).performScrollTo().assertExists()
        capture("signup-step-contact.png")
        continueButton().performScrollTo().performClick()
        compose.onNodeWithText("@fixture_user").performScrollTo().assertExists()
        compose.onNodeWithText("patient@example.test").assertExists()
        val create=compose.onNode(hasText(text(R.string.auth_create_account)) and hasClickAction())
        create.performScrollTo().assertIsNotEnabled()
        compose.onNodeWithText(text(R.string.signup_consent_needed)).assertExists()
        // The full agreement text stays available on demand.
        compose.onNodeWithText(text(R.string.profile_privacy_text)).assertDoesNotExist()
        compose.onNodeWithText(text(R.string.signup_privacy_read_full)).performScrollTo().performClick()
        compose.onNodeWithText(text(R.string.profile_privacy_text)).performScrollTo().assertExists()
        compose.onNodeWithText(text(R.string.signup_privacy_hide_full)).performScrollTo().performClick()
        compose.onNodeWithText(text(R.string.profile_agree)).performScrollTo().performClick()
        compose.onNodeWithText(text(R.string.profile_privacy_title)).performScrollTo()
        capture("profile-signup-consent.png")
        // Edit returns to the step, and its values are kept.
        compose.onNodeWithContentDescription(text(R.string.signup_edit_section).format(text(R.string.form_identity))).performScrollTo().performClick()
        compose.onNodeWithText(text(R.string.signup_step_counter).format(2,4)).assertExists()
        repeat(2) {continueButton().performScrollTo().performClick()}
        create.performScrollTo().assertIsEnabled().performClick()
        assertEquals("patient@example.test",submitted?.first)
        assertEquals("fixture-password",submitted?.second)
        assertEquals(fixture.username,submitted?.third?.username)
        assertTrue(submitted?.third?.consent==true)
    }
    @Test fun profileEmailIsReadOnlyAndEditedDetailsSave() {
        val repository=Fixture();val vm=PatientProfileViewModel(repository)
        compose.runOnIdle {vm.configure("patient")}
        compose.setContent {MotivanceTheme {Surface {Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {PatientProfileEditor(vm,onSaved={})}}}}
        compose.waitUntil(10_000) {vm.state.value.profile!=null}
        compose.onNodeWithText(fixture.email).assert(hasSetTextAction().not())
        compose.onNodeWithText("@fixture_user").assertExists()
        compose.onNodeWithText(text(R.string.profile_edit)).performScrollTo().performClick()
        compose.onNodeWithText(text(R.string.profile_first_name)).performScrollTo().performTextReplacement("Updated Patient")
        compose.onNodeWithText(text(R.string.profile_save)).performScrollTo().performClick()
        compose.waitUntil(10_000) {repository.saved?.firstName=="Updated Patient"}
        assertEquals(fixture.email,repository.saved?.email)
    }
    @Test fun passwordChangeRequiresMatchingConfirmation() {
        val repository=Fixture();val vm=PatientProfileViewModel(repository)
        compose.runOnIdle {vm.configure("patient")}
        compose.setContent {MotivanceTheme {Surface {Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) {PatientProfileEditor(vm,onSaved={})}}}}
        compose.waitUntil(10_000) {vm.state.value.profile!=null}
        compose.onNodeWithText(text(R.string.profile_current_password)).performScrollTo().performTextInput("current-password")
        compose.onNodeWithText(text(R.string.auth_new_password)).performScrollTo().performTextInput("replacement-password")
        compose.onAllNodesWithText(text(R.string.profile_change_password)).filter(hasClickAction()).onLast().assertIsNotEnabled()
        compose.onNodeWithText(text(R.string.profile_confirm_password)).performScrollTo().performTextInput("replacement-password")
        compose.onAllNodesWithText(text(R.string.profile_change_password)).filter(hasClickAction()).onLast().performScrollTo().performClick()
        compose.waitUntil(10_000) {repository.passwordCalls==1}
    }
    @Test fun profilePageMatchesTheWebLayoutAndHasNoToggleButtons() {
        val repository=Fixture();val vm=PatientProfileViewModel(repository)
        compose.runOnIdle {vm.configure("patient")}
        compose.setContent {MotivanceTheme {Surface {Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {PatientProfileEditor(vm,onSaved={})}}}}
        compose.waitUntil(10_000) {vm.state.value.profile!=null}
        compose.onNodeWithText(text(R.string.profile_details)).assertExists()
        compose.onNodeWithText(text(R.string.profile_current_password)).performScrollTo().assertExists()
        compose.onNodeWithText(text(R.string.profile_female)).assertExists()
        capture("profile-mobile.png")
        compose.onNodeWithText(text(R.string.profile_edit)).performScrollTo().performClick()
        compose.onNodeWithText(text(R.string.profile_save)).performScrollTo().assertExists()
        capture("profile-mobile-editing.png")
        compose.onNodeWithText(text(R.string.cancel_action)).performScrollTo().performClick()
        compose.onNodeWithText(text(R.string.profile_save)).assertDoesNotExist()
    }
    @Test fun genderIsADropdown() {
        compose.setContent {MotivanceTheme {Surface {
            var profile by remember {mutableStateOf(fixture.copy(gender=""))}
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
                ProfileFields(profile,true) {profile=it}
                Text("Chosen: ${profile.gender}")
            }
        }}}
        compose.onNodeWithText(text(R.string.profile_nonbinary)).assertDoesNotExist()
        compose.onNodeWithText(text(R.string.profile_gender)).performScrollTo().performClick()
        compose.onNodeWithText(text(R.string.profile_nonbinary)).performClick()
        compose.onNodeWithText("Chosen: nonbinary").assertExists()
        compose.onNodeWithText(text(R.string.profile_male)).assertDoesNotExist()
    }
    @Test fun therapistSummaryShowsUsernameAvatarAndDemographics() {
        compose.setContent {MotivanceTheme {Surface {Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) {PatientProfileSummary(fixture)}}}}
        compose.onNodeWithText("@fixture_user").assertExists()
        compose.onNodeWithText(fixture.address).assertExists()
        compose.onNodeWithText(text(R.string.profile_female)).assertExists()
        compose.onNodeWithContentDescription(text(R.string.profile_avatar)).assertExists()
        capture("profile-therapist-demographics.png")
    }
    @Test fun inlineUsernameValidationAndCalendarCancel() {
        compose.setContent {MotivanceTheme {Surface {
            var profile by remember {mutableStateOf(fixture)}
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
                ProfileFields(profile,true) {profile=it}
            }
        }}}
        compose.onNodeWithText(text(R.string.profile_username)).performScrollTo().performTextReplacement("f_u_c_k")
        compose.onNodeWithText(text(R.string.form_username_blocked)).assertExists()
        compose.onNodeWithText(text(R.string.profile_first_name)).performScrollTo().assertExists()
        capture("profile-fields-refined.png")
        compose.onNodeWithContentDescription(text(R.string.profile_birthdate)).performScrollTo().performClick()
        compose.onNodeWithText(text(R.string.cancel_action)).performClick()
        compose.onNodeWithText(com.motivance.designsystem.displayDate(fixture.birthdate)).assertExists()
    }
    private inner class Fixture:AuthRepository {
        var saved:PatientProfile?=null;var passwordCalls=0
        override suspend fun loadProfile()=saved ?: fixture
        override suspend fun saveProfile(profile:PatientProfile) {saved=profile}
        override suspend fun changePassword(currentPassword:String,newPassword:String) {passwordCalls++}
        override suspend fun signIn(email:String,password:String)=error("unused")
        override suspend fun register(email:String,password:String) {}
        override suspend fun confirmRegistration(email:String,token:String)=error("unused")
        override suspend fun requestRecovery(email:String) {}
        override suspend fun recover(email:String,token:String,newPassword:String)=error("unused")
        override suspend fun refresh()=error("unused")
        override suspend fun signOut() {}
        override suspend fun loadOverview()=WorkspaceOverview()
    }
}
