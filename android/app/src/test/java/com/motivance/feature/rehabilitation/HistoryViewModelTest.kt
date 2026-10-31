package com.motivance.feature.rehabilitation

import com.motivance.domain.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class HistoryViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val owner = "10000000-0000-0000-0000-000000000001"
    private val other = "10000000-0000-0000-0000-000000000002"
    private val query = HistoryQuery(owner)
    private val remote = FakeHistory()
    @Before fun setup() { Dispatchers.setMain(dispatcher) }
    @After fun teardown() { Dispatchers.resetMain() }

    @Test fun accountChangeDiscardsEvenANonCooperativeLateResponse() = runTest(dispatcher) {
        val vm = HistoryViewModel(remote)
        remote.gate = CompletableDeferred()
        vm.configure(owner); vm.show(query); runCurrent()
        vm.configure(other)
        remote.gate!!.complete(HistoryPage(listOf(row()), null)); advanceUntilIdle()
        assertEquals(other, vm.state.value.owner)
        assertTrue(vm.state.value.rows.isEmpty())
        assertNull(vm.state.value.query)
    }

    @Test fun filterChangeCannotBeOverwrittenByAnOlderResponse() = runTest(dispatcher) {
        val vm = HistoryViewModel(remote)
        val old = CompletableDeferred<HistoryPage>(); remote.gate = old
        vm.configure(owner); vm.show(query); runCurrent()
        remote.gate = null
        val changed = query.copy(side = "right")
        vm.show(changed); advanceUntilIdle()
        old.complete(HistoryPage(listOf(row()), null)); advanceUntilIdle()
        assertEquals(changed, vm.state.value.query)
        assertTrue(vm.state.value.rows.isEmpty())
    }

    @Test fun loadingOlderAppendsUniqueSessionsAndRefreshFailureClearsStaleRecords() = runTest(dispatcher) {
        val vm = HistoryViewModel(remote)
        val cursor = HistoryCursor("2026-01-01T10:00:00Z", owner)
        remote.page = HistoryPage(listOf(row()), cursor)
        vm.configure(owner); vm.show(query); advanceUntilIdle()
        remote.page = HistoryPage(listOf(row(), row().copy(id = other)), null)
        vm.loadOlder(); advanceUntilIdle()
        assertEquals(listOf(null, cursor), remote.cursors)
        assertEquals(2, vm.state.value.rows.size)
        remote.fail = true
        vm.refresh(); advanceUntilIdle()
        assertTrue(vm.state.value.failed)
        assertTrue(vm.state.value.rows.isEmpty())
        remote.fail = false
        vm.refresh(); advanceUntilIdle()
        assertFalse(vm.state.value.failed)
        assertTrue(vm.state.value.loaded)
    }

    private fun row() = HistoricalSession(owner, owner, "2026-01-01T10:00:00Z", "2026-01-01T10:01:00Z", "completed", "model", "algorithm", null, emptyList())

    private class FakeHistory : RehabilitationRepository {
        var gate: CompletableDeferred<HistoryPage>? = null
        var page = HistoryPage(emptyList(), null)
        var fail = false
        val cursors = mutableListOf<HistoryCursor?>()
        override suspend fun loadHistory(query: HistoryQuery, cursor: HistoryCursor?): HistoryPage {
            cursors += cursor
            if (fail) throw RemoteFailure(403)
            val wait = gate
            return if (wait != null) withContext(NonCancellable) { wait.await() } else page
        }
        override suspend fun loadWorkspace() = RehabWorkspace()
        override suspend fun invitePatient(email: String) = error("unused")
        override suspend fun acceptInvitation(code: String) = error("unused")
        override suspend fun revokeLink(patientId: String) = error("unused")
        override suspend fun publishPrescription(draft: PrescriptionDraft) = error("unused")
        override suspend fun requestPatientData(id: String, kind: String) = error("unused")
        override suspend fun uploadConsent(owner: String, id: String, event: String, version: String, occurredAt: Long) = error("unused")
        override suspend fun uploadSession(owner: String, payload: String) = error("unused")
    }
}
