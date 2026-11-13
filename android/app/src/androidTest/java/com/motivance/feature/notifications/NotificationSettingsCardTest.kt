package com.motivance.feature.notifications

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.test.platform.app.InstrumentationRegistry
import com.motivance.R
import com.motivance.designsystem.MotivanceTheme
import com.motivance.designsystem.Toaster
import com.motivance.domain.*
import org.junit.*
import org.junit.Assert.*

/** The Profile card on a real Android system, with the server stood in for. */
class NotificationSettingsCardTest {
    @get:Rule val compose=createComposeRule()
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private fun text(id:Int)=context.getString(id)

    private class Remote(var stored:NotificationSettings=NotificationSettings()):NotificationRepository {
        val saves=mutableListOf<NotificationSettings>()
        override suspend fun loadNotifications()=NotificationInbox()
        override suspend fun markNotificationsRead(ids:List<String>?)=0
        override suspend fun saveLanguage(language:String) {}
        override suspend fun registerDevice(token:String) {}
        override suspend fun unregisterDevice(token:String) {}
        override suspend fun loadNotificationSettings()=stored
        override suspend fun saveNotificationSettings(settings:NotificationSettings):NotificationSettings {saves+=settings;stored=settings;return settings}
    }

    private fun show(roles:Set<UserRole>,remote:Remote,pushAvailable:Boolean=true,allowed:Boolean=true,ask:()->Unit={}):NotificationSettingsViewModel {
        val vm=NotificationSettingsViewModel(remote,Toaster()).also {it.configure("owner")}
        compose.setContent {
            val state by vm.state.collectAsStateWithLifecycle()
            MotivanceTheme {Surface {Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
                NotificationSettingsCard(roles,state,vm,pushAvailable,allowed,ask)
            }}}
        }
        compose.waitUntil(10_000) {vm.state.value.loaded}
        return vm
    }

    @Test fun aPatientSeesTheirSwitchesAndNoTherapistOnes() {
        show(setOf(UserRole.PATIENT),Remote())
        listOf(R.string.notification_settings_bookings,R.string.notification_settings_exercise_plan,R.string.notification_settings_practice,R.string.notification_settings_care_team)
            .forEach {compose.onNodeWithText(text(it)).performScrollTo().assertExists()}
        compose.onNodeWithText(text(R.string.notification_settings_session_results)).assertDoesNotExist()
        compose.onNodeWithText(text(R.string.notification_settings_inactivity)).assertDoesNotExist()
    }

    @Test fun aTherapistSeesTheirPatientsSwitchesAndNoReminder() {
        show(setOf(UserRole.PATIENT,UserRole.THERAPIST),Remote())
        compose.onNodeWithText(text(R.string.notification_settings_session_results)).performScrollTo().assertExists()
        compose.onNodeWithText(text(R.string.notification_settings_inactivity)).performScrollTo().assertExists()
        compose.onNodeWithText(text(R.string.notification_settings_practice)).assertDoesNotExist()
    }

    @Test fun theWholeRowIsOneSwitchThatSaves() {
        val remote=Remote()
        val vm=show(setOf(UserRole.PATIENT,UserRole.THERAPIST),remote)
        val row=compose.onNode(hasText(text(R.string.notification_settings_session_results)) and isToggleable())
        row.performScrollTo().assertIsOn().performClick()
        compose.waitUntil(10_000) {remote.saves.isNotEmpty() && !vm.state.value.saving}
        assertFalse(remote.saves.single().sessionResults)
        row.assertIsOff()
    }

    @Test fun turningTheReminderOnShowsItsTime() {
        val remote=Remote()
        val vm=show(setOf(UserRole.PATIENT),remote)
        compose.onNodeWithText(text(R.string.notification_settings_change_time)).assertDoesNotExist()
        compose.onNode(hasText(text(R.string.notification_settings_practice)) and isToggleable()).performScrollTo().performClick()
        compose.waitUntil(10_000) {remote.saves.isNotEmpty() && !vm.state.value.saving}
        assertEquals("18:00",remote.stored.reminderTime)
        compose.onNodeWithText(context.getString(R.string.notification_settings_practice_at,reminderLabel("18:00"))).performScrollTo().assertExists()
        compose.onNodeWithText(text(R.string.notification_settings_change_time)).performClick()
        compose.onNodeWithText(text(R.string.notification_settings_pick_time)).assertExists()
        compose.onNodeWithText(text(R.string.notification_settings_time_cancel)).performClick()
        compose.onNodeWithText(text(R.string.notification_settings_pick_time)).assertDoesNotExist()
    }

    @Test fun aBuildWithoutFirebaseSaysSo() {
        show(setOf(UserRole.PATIENT),Remote(),pushAvailable=false)
        compose.onNodeWithText(text(R.string.notification_settings_unavailable)).assertExists()
        compose.onNodeWithText(text(R.string.notification_settings_allow)).assertDoesNotExist()
    }

    @Test fun aBlockedPhoneOffersItsSettings() {
        var asked=0
        show(setOf(UserRole.PATIENT),Remote(),allowed=false) {asked++}
        compose.onNodeWithText(text(R.string.notification_settings_blocked)).assertExists()
        compose.onNodeWithText(text(R.string.notification_settings_allow)).performScrollTo().performClick()
        assertEquals(1,asked)
    }

    @Test fun anAdministratorAloneHasNoCard() {
        val vm=NotificationSettingsViewModel(Remote(),Toaster()).also {it.configure("owner")}
        compose.setContent {
            val state by vm.state.collectAsStateWithLifecycle()
            MotivanceTheme {Surface {Column {NotificationSettingsCard(setOf(UserRole.PATIENT,UserRole.ADMIN),state,vm,true,true) {}}}}
        }
        compose.onNodeWithText(text(R.string.notification_settings_title)).assertDoesNotExist()
    }
}
