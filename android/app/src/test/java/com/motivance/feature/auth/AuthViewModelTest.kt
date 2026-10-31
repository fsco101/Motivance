package com.motivance.feature.auth

import com.motivance.domain.AuthRepository
import com.motivance.domain.UserRole
import com.motivance.domain.UserSession
import com.motivance.domain.WorkspaceOverview
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AuthViewModelTest {
    private val dispatcher=StandardTestDispatcher()
    private val repository=FakeAuth()
    @Before fun setup() { Dispatchers.setMain(dispatcher) }
    @After fun teardown() { Dispatchers.resetMain() }

    @Test fun invalidEmailNeverReachesBackend()=runTest(dispatcher) {
        val vm=AuthViewModel(repository)
        vm.act(AuthAction.SIGN_IN,"invalid","password")
        assertEquals(AuthNotice.INVALID_EMAIL,vm.state.value.notice)
        assertEquals(0,repository.calls)
        assertFalse(vm.state.value.busy)
    }
    @Test fun missingPasswordOrCodeNeverReachesBackend()=runTest(dispatcher) {
        val vm=AuthViewModel(repository)
        vm.act(AuthAction.SIGN_IN,"a@example.test","")
        assertEquals(AuthNotice.PASSWORD_REQUIRED,vm.state.value.notice)
        vm.act(AuthAction.CONFIRM,"a@example.test",otp="")
        assertEquals(AuthNotice.CODE_REQUIRED,vm.state.value.notice)
        assertEquals(0,repository.calls)
    }
    @Test fun duplicateSubmitDoesNotLaunchAnotherRequest()=runTest(dispatcher) {
        val vm=AuthViewModel(repository)
        repository.signInGate=CompletableDeferred()
        vm.act(AuthAction.SIGN_IN,"a@example.test","password")
        runCurrent()
        vm.act(AuthAction.SIGN_IN,"a@example.test","password")
        runCurrent()
        assertEquals(1,repository.calls)
        assertTrue(vm.state.value.busy)
        repository.signInGate!!.complete(repository.session)
        advanceUntilIdle()
        assertNotNull(vm.state.value.session)
        assertFalse(vm.state.value.busy)
    }
    @Test fun failedRefreshRemovesSessionAndShowsLocalizedNoticeKey()=runTest(dispatcher) {
        val vm=AuthViewModel(repository)
        vm.act(AuthAction.SIGN_IN,"a@example.test","password"); advanceUntilIdle()
        repository.failRefresh=true
        vm.act(AuthAction.REFRESH); advanceUntilIdle()
        assertNull(vm.state.value.session)
        assertEquals(AuthNotice.SESSION_EXPIRED,vm.state.value.notice)
        assertFalse(vm.state.value.busy)
    }
    @Test fun failedRequestDoesNotExposeBackendErrorPayload()=runTest(dispatcher) {
        val vm=AuthViewModel(repository)
        repository.failSignIn=true
        vm.act(AuthAction.SIGN_IN,"a@example.test","password"); advanceUntilIdle()
        assertEquals(AuthNotice.REQUEST_FAILED,vm.state.value.notice)
        assertNull(vm.state.value.session)
    }
    @Test fun signOutBlocksNewActionsUntilRemoteCleanupFinishes()=runTest(dispatcher) {
        val vm=AuthViewModel(repository)
        vm.act(AuthAction.SIGN_IN,"a@example.test","password"); advanceUntilIdle()
        repository.signOutGate=CompletableDeferred()
        vm.act(AuthAction.SIGN_OUT); runCurrent()
        assertNull(vm.state.value.session)
        assertTrue(vm.state.value.busy)
        vm.act(AuthAction.SIGN_IN,"b@example.test","password"); runCurrent()
        assertEquals(2,repository.calls)
        repository.signOutGate!!.complete(Unit); advanceUntilIdle()
        assertFalse(vm.state.value.busy)
    }
    @Test fun registrationAndRecoveryUseNeutralNotices()=runTest(dispatcher) {
        val vm=AuthViewModel(repository)
        vm.act(AuthAction.REGISTER,"a@example.test","password"); advanceUntilIdle()
        assertEquals(AuthNotice.CONFIRM_EMAIL,vm.state.value.notice)
        vm.act(AuthAction.REQUEST_RECOVERY,"a@example.test"); advanceUntilIdle()
        assertEquals(AuthNotice.RECOVERY_SENT,vm.state.value.notice)
        assertNull(vm.state.value.session)
    }
    @Test fun dashboardDoesNotPublishResultsAfterSignOut()=runTest(dispatcher) {
        val vm=AuthViewModel(repository)
        vm.act(AuthAction.SIGN_IN,"a@example.test","password"); advanceUntilIdle()
        repository.overviewGate=CompletableDeferred()
        vm.loadOverview(); runCurrent()
        assertTrue(vm.overview.value.busy)
        vm.act(AuthAction.SIGN_OUT); runCurrent()
        repository.overviewGate!!.complete(WorkspaceOverview(displayName="previous user"))
        advanceUntilIdle()
        assertNull(vm.overview.value.data)
        assertFalse(vm.overview.value.busy)
    }

    @Test fun restorationShowsLoadingUntilSessionCheckFinishes()=runTest(dispatcher) {
        val vm=AuthViewModel(repository)
        assertTrue(vm.state.value.restoring)
        repository.restoreGate=CompletableDeferred()
        vm.restore(); runCurrent()
        assertTrue(vm.state.value.restoring)
        assertTrue(vm.state.value.busy)
        repository.restoreGate!!.complete(repository.session)
        advanceUntilIdle()
        assertFalse(vm.state.value.restoring)
        assertFalse(vm.state.value.busy)
        assertEquals(repository.session,vm.state.value.session)
    }
    @Test fun failedRestorationExitsLoadingAndAllowsSignIn()=runTest(dispatcher) {
        val vm=AuthViewModel(repository)
        repository.restoreGate=CompletableDeferred()
        vm.restore(); runCurrent()
        repository.restoreGate!!.completeExceptionally(IllegalStateException("unavailable"))
        advanceUntilIdle()
        assertFalse(vm.state.value.restoring)
        assertFalse(vm.state.value.busy)
        assertNull(vm.state.value.session)
        vm.act(AuthAction.SIGN_IN,"a@example.test","password"); advanceUntilIdle()
        assertEquals(repository.session,vm.state.value.session)
    }

    private class FakeAuth : AuthRepository {
        val session=UserSession("fixture",setOf(UserRole.PATIENT))
        var calls=0
        var restoreGate: CompletableDeferred<UserSession?>?=null
        override suspend fun restoreSession():UserSession? = restoreGate?.await()
        var signInGate: CompletableDeferred<UserSession>?=null
        var signOutGate: CompletableDeferred<Unit>?=null
        var overviewGate: CompletableDeferred<WorkspaceOverview>?=null
        var failRefresh=false
        var failSignIn=false
        override suspend fun signIn(email:String,password:String):UserSession {
            calls++; if(failSignIn) error("sensitive backend detail")
            return signInGate?.await() ?: session
        }
        override suspend fun register(email:String,password:String) { calls++ }
        override suspend fun confirmRegistration(email:String,token:String):UserSession { calls++; return session }
        override suspend fun requestRecovery(email:String) { calls++ }
        override suspend fun recover(email:String,token:String,newPassword:String):UserSession { calls++; return session }
        override suspend fun refresh():UserSession { calls++; if(failRefresh) error("expired token"); return session }
        override suspend fun signOut() { calls++; signOutGate?.await() }
        override suspend fun loadOverview()=overviewGate?.await() ?: WorkspaceOverview()
    }
}
