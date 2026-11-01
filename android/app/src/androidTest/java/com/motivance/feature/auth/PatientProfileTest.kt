package com.motivance.feature.auth

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
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
    private val fixture=PatientProfile("fixture_user","Fixture Patient","female","1995-01-01","Fixture address","09001234567","star",true,"patient@example.test")
    @Test fun signupCannotSubmitWithoutDetailsAndPrivacyAgreement() {
        var calls=0
        compose.setContent {MotivanceTheme {Surface {AuthContent(AuthState(),UserRole.PATIENT,{_,_,_,_->},{},{},{},onRegister={_,_,_->calls++})}}}
        compose.onNode(hasText(text(R.string.auth_create_account)) and hasClickAction()).performScrollTo().performClick()
        compose.onNodeWithText(text(R.string.email)).performScrollTo().performTextInput("patient@example.test")
        compose.onNodeWithText(text(R.string.auth_password)).performScrollTo().performTextInput("fixture-password")
        compose.onNode(hasText(text(R.string.auth_create_account)) and hasClickAction()).performScrollTo().assertIsNotEnabled()
        compose.onNodeWithText(text(R.string.profile_privacy_title)).assertExists()
        compose.onNodeWithText(text(R.string.profile_privacy_title)).performScrollTo()
        capture("profile-signup-consent.png")
        assertEquals(0,calls)
    }
    @Test fun profileEmailIsReadOnlyAndEditedDetailsSave() {
        val repository=Fixture();val vm=PatientProfileViewModel(repository)
        compose.runOnIdle {vm.configure("patient")}
        compose.setContent {MotivanceTheme {Surface {Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {PatientProfileEditor(vm) {}}}}}
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
        compose.setContent {MotivanceTheme {Surface {Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) {PatientProfileEditor(vm) {}}}}}
        compose.waitUntil(10_000) {vm.state.value.profile!=null}
        compose.onNodeWithText(text(R.string.profile_change_password)).performScrollTo().performClick()
        compose.onNodeWithText(text(R.string.profile_current_password)).performScrollTo().performTextInput("current-password")
        compose.onNodeWithText(text(R.string.auth_new_password)).performScrollTo().performTextInput("replacement-password")
        compose.onAllNodesWithText(text(R.string.profile_change_password)).filter(hasClickAction()).onLast().assertIsNotEnabled()
        compose.onNodeWithText(text(R.string.profile_confirm_password)).performScrollTo().performTextInput("replacement-password")
        compose.onAllNodesWithText(text(R.string.profile_change_password)).filter(hasClickAction()).onLast().performScrollTo().performClick()
        compose.waitUntil(10_000) {repository.passwordCalls==1}
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
