package com.motivance.feature.notifications

import com.motivance.designsystem.Toaster
import com.motivance.domain.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.*
import org.junit.Assert.*

@OptIn(ExperimentalCoroutinesApi::class)
class NotificationSettingsViewModelTest {
    private val dispatcher=StandardTestDispatcher()
    @Before fun setup() {Dispatchers.setMain(dispatcher)}
    @After fun cleanup() {Dispatchers.resetMain()}

    private class Remote:NotificationRepository {
        var stored=NotificationSettings()
        var loadFailure:RemoteFailure?=null
        var saveFailure:RemoteFailure?=null
        val saves=mutableListOf<NotificationSettings>()
        var gate:CompletableDeferred<Unit>?=null
        override suspend fun loadNotifications()=NotificationInbox()
        override suspend fun markNotificationsRead(ids:List<String>?)=0
        override suspend fun saveLanguage(language:String) {}
        override suspend fun registerDevice(token:String) {}
        override suspend fun unregisterDevice(token:String) {}
        override suspend fun loadNotificationSettings():NotificationSettings {loadFailure?.let {throw it};return stored}
        override suspend fun saveNotificationSettings(settings:NotificationSettings):NotificationSettings {
            saves+=settings
            gate?.await()
            saveFailure?.let {throw it}
            stored=settings
            return stored
        }
    }

    private fun TestScope.loaded(remote:Remote)=NotificationSettingsViewModel(remote,Toaster()).also {it.configure("owner");it.load();advanceUntilIdle()}

    @Test fun theSwitchesShowWhatTheServerHolds()=runTest {
        val remote=Remote().apply {stored=NotificationSettings(sessionResults=false,reminderTime="07:30")}
        val vm=loaded(remote)
        assertTrue(vm.state.value.loaded)
        assertEquals(remote.stored,vm.state.value.settings)
    }

    @Test fun turningASwitchOffSavesItAndKeepsTheRest()=runTest {
        val remote=Remote();val vm=loaded(remote)
        vm.toggle(NotificationGroup.SESSION_RESULTS,false)
        assertFalse("The switch moves at once",vm.state.value.settings.sessionResults)
        assertTrue(vm.state.value.saving)
        advanceUntilIdle()
        assertEquals(listOf(NotificationSettings(sessionResults=false)),remote.saves)
        assertFalse(vm.state.value.saving)
    }

    @Test fun turningTheReminderOnChoosesADefaultTimeAndAChosenTimeReplacesIt()=runTest {
        val remote=Remote();val vm=loaded(remote)
        vm.toggle(NotificationGroup.PRACTICE,true);advanceUntilIdle()
        assertEquals("18:00",remote.stored.reminderTime)
        vm.setReminder("07:15");advanceUntilIdle()
        assertEquals("07:15",remote.stored.reminderTime)
        vm.setReminder("7:15");advanceUntilIdle()
        assertEquals("A time the server would refuse is never sent",2,remote.saves.size)
    }

    @Test fun aFailedSaveMovesTheSwitchBack()=runTest {
        val remote=Remote().apply {saveFailure=RemoteFailure(503)}
        val vm=loaded(remote)
        vm.toggle(NotificationGroup.BOOKINGS,false);advanceUntilIdle()
        assertTrue(vm.state.value.settings.bookings)
        assertFalse(vm.state.value.saving)
    }

    @Test fun nothingElseIsSavedWhileASaveIsUnderway()=runTest {
        val remote=Remote().apply {gate=CompletableDeferred()}
        val vm=loaded(remote)
        vm.toggle(NotificationGroup.BOOKINGS,false);runCurrent()
        vm.toggle(NotificationGroup.CARE_TEAM,false);runCurrent()
        remote.gate!!.complete(Unit);advanceUntilIdle()
        assertEquals(1,remote.saves.size)
        assertTrue(vm.state.value.settings.careTeam)
    }

    @Test fun aSwitchCannotMoveBeforeTheSettingsAreKnown()=runTest {
        val remote=Remote().apply {loadFailure=RemoteFailure(503)}
        val vm=loaded(remote)
        assertTrue(vm.state.value.failed)
        vm.toggle(NotificationGroup.BOOKINGS,false);advanceUntilIdle()
        assertTrue("Saving now would overwrite choices it never read",remote.saves.isEmpty())
        remote.loadFailure=null
        vm.load();advanceUntilIdle()
        assertTrue(vm.state.value.loaded)
    }

    @Test fun anotherAccountStartsFromNothing()=runTest {
        val remote=Remote().apply {stored=NotificationSettings(bookings=false)}
        val vm=loaded(remote)
        vm.configure("someone-else")
        assertFalse(vm.state.value.loaded)
        assertEquals(NotificationSettings(),vm.state.value.settings)
    }
}
