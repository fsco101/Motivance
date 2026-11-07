package com.motivance.feature.notifications

import com.motivance.designsystem.Toaster
import com.motivance.domain.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.*
import org.junit.Assert.*

@OptIn(ExperimentalCoroutinesApi::class)
class NotificationsViewModelTest {
    private val dispatcher=StandardTestDispatcher()
    @Before fun setup() {Dispatchers.setMain(dispatcher)}
    @After fun cleanup() {Dispatchers.resetMain()}

    private fun note(id:String,readAt:String?=null)=AppNotification(id,NotificationKind.CONFIRMED,"BK-2026-000001","2026-12-07T01:00:00+00:00","2026-12-07T02:00:00+00:00",readAt=readAt)

    private inner class Remote:NotificationRepository {
        override suspend fun registerDevice(token:String) {}
        override suspend fun unregisterDevice(token:String) {}
        var inbox=NotificationInbox(2,listOf(note("a"),note("b"),note("c","2026-12-01T00:00:00Z")))
        var failure:RemoteFailure?=null
        var markFailure:RemoteFailure?=null
        val marked=mutableListOf<List<String>?>()
        val waits=ArrayDeque<CompletableDeferred<NotificationInbox>>()
        var reads=0
        override suspend fun loadNotifications():NotificationInbox {
            reads++
            failure?.let {throw it}
            return waits.removeFirstOrNull()?.let {withContext(NonCancellable) {it.await()}} ?: inbox
        }
        val languages=mutableListOf<String>()
        var languageFailure:RemoteFailure?=null
        override suspend fun saveLanguage(language:String) {languageFailure?.let {throw it};languages+=language}
        override suspend fun markNotificationsRead(ids:List<String>?):Int {
            marked+=ids
            markFailure?.let {throw it}
            return inbox.unread-(ids?.size ?: inbox.unread)
        }
    }

    private fun viewModel(remote:Remote)=NotificationsViewModel(remote,Toaster()).also {it.configure("owner")}

    @Test fun refreshingReadsTheInbox()=runTest {
        val remote=Remote();val vm=viewModel(remote)
        vm.refresh();advanceUntilIdle()
        assertEquals(2,vm.state.value.inbox.unread)
        assertEquals(3,vm.state.value.inbox.items.size)
        assertTrue(vm.state.value.loaded)
    }

    @Test fun openingAnUnreadNotificationMarksItReadOnce()=runTest {
        val remote=Remote();val vm=viewModel(remote)
        vm.refresh();advanceUntilIdle()
        val first=vm.state.value.inbox.items.first()
        vm.open(first)
        assertEquals("The count drops at once",1,vm.state.value.inbox.unread)
        assertFalse(vm.state.value.inbox.items.first().unread)
        advanceUntilIdle()
        assertEquals(listOf<List<String>?>(listOf("a")),remote.marked)
        assertEquals(1,vm.state.value.inbox.unread)
    }

    @Test fun openingOneAlreadyReadAsksNothing()=runTest {
        val remote=Remote();val vm=viewModel(remote)
        vm.refresh();advanceUntilIdle()
        vm.open(vm.state.value.inbox.items.last());advanceUntilIdle()
        assertTrue(remote.marked.isEmpty())
    }

    @Test fun markingAllClearsTheCountAndKeepsTheList()=runTest {
        val remote=Remote();val vm=viewModel(remote)
        vm.refresh();advanceUntilIdle()
        vm.markAllRead();advanceUntilIdle()
        assertEquals(listOf<List<String>?>(null),remote.marked)
        assertEquals(0,vm.state.value.inbox.unread)
        assertEquals(3,vm.state.value.inbox.items.size)
        assertTrue(vm.state.value.inbox.items.none {it.unread})
    }

    @Test fun markingAllWithNothingUnreadAsksNothing()=runTest {
        val remote=Remote();remote.inbox=NotificationInbox();val vm=viewModel(remote)
        vm.refresh();advanceUntilIdle()
        vm.markAllRead();advanceUntilIdle()
        assertTrue(remote.marked.isEmpty())
    }

    /** If the server never heard, the screen must not keep saying it did. */
    @Test fun aFailedMarkReadsTheTruthAgain()=runTest {
        val remote=Remote();val vm=viewModel(remote)
        vm.refresh();advanceUntilIdle()
        remote.markFailure=RemoteFailure(503)
        vm.open(vm.state.value.inbox.items.first());advanceUntilIdle()
        assertEquals(2,vm.state.value.inbox.unread)
        assertTrue(vm.state.value.inbox.items.first().unread)
    }

    @Test fun aFailedCheckKeepsWhatIsOnScreen()=runTest {
        val remote=Remote();val vm=viewModel(remote)
        vm.refresh();advanceUntilIdle()
        remote.failure=RemoteFailure(503)
        vm.refresh();advanceUntilIdle()
        assertEquals(3,vm.state.value.inbox.items.size)
        assertTrue(vm.state.value.failed)
    }

    /** One person must never see another's notifications, even for a moment. */
    @Test fun aResultForAnAccountThatSignedOutIsIgnored()=runTest {
        val remote=Remote();val vm=viewModel(remote)
        val slow=CompletableDeferred<NotificationInbox>()
        remote.waits.addLast(slow)
        vm.refresh();runCurrent()
        vm.configure("someone-else")
        slow.complete(remote.inbox);advanceUntilIdle()
        assertTrue(vm.state.value.inbox.items.isEmpty())
        assertEquals(0,vm.state.value.inbox.unread)
    }

    @Test fun signingOutClearsTheBell()=runTest {
        val remote=Remote();val vm=viewModel(remote)
        vm.refresh();advanceUntilIdle()
        vm.configure(null)
        assertEquals(0,vm.state.value.inbox.unread)
        assertTrue(vm.state.value.inbox.items.isEmpty())
    }

    @Test fun theServerIsToldTheReadersLanguage()=runTest {
        val remote=Remote();val vm=viewModel(remote)
        vm.saveLanguage("fil");advanceUntilIdle()
        assertEquals(listOf("fil"),remote.languages)
    }

    /** Failing only leaves email in the language it was in, so nobody needs interrupting. */
    @Test fun aLanguageThatCouldNotBeSavedIsNotAnError()=runTest {
        val remote=Remote();val vm=viewModel(remote)
        remote.languageFailure=RemoteFailure(503)
        vm.saveLanguage("fil");advanceUntilIdle()
        assertFalse(vm.state.value.failed)
    }

    @Test fun noLanguageIsSavedWithoutAnAccount()=runTest {
        val remote=Remote();val vm=NotificationsViewModel(remote,Toaster())
        vm.saveLanguage("fil");advanceUntilIdle()
        assertTrue(remote.languages.isEmpty())
    }

    @Test fun nothingIsReadWithoutAnAccount()=runTest {
        val remote=Remote();val vm=NotificationsViewModel(remote,Toaster())
        vm.refresh();advanceUntilIdle()
        assertEquals(0,remote.reads)
    }
}
