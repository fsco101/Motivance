package com.motivance.feature.auth

import com.motivance.R
import com.motivance.designsystem.Toaster
import com.motivance.designsystem.ToastTone
import com.motivance.domain.AuthRepository
import com.motivance.domain.UserRole
import com.motivance.domain.UserSession
import com.motivance.domain.WorkspaceOverview
import com.motivance.domain.RemoteFailure
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
    @Test fun signingOutRemovesThePhoneWhileTheSessionStillWorks()=runTest(dispatcher) {
        val order=mutableListOf<String>()
        val devices=object:com.motivance.domain.PushDevices {override suspend fun unregister() {order+="unregister"}}
        val repository=object:AuthRepository by FakeAuth() {override suspend fun signOut() {order+="signOut"}}
        val vm=AuthViewModel(repository,com.motivance.designsystem.Toaster(),devices)
        vm.act(AuthAction.SIGN_OUT);advanceUntilIdle()
        assertEquals(listOf("unregister","signOut"),order)
    }

    private val dispatcher=StandardTestDispatcher()
    private val repository=FakeAuth()
    @Before fun setup() { Dispatchers.setMain(dispatcher) }
    @After fun teardown() { Dispatchers.resetMain() }

    private fun toasted(toasts:Toaster)=toasts.current.value?.let {it.message to it.tone}
    @Test fun signingInReportsPendingThenDone()=runTest(dispatcher) {
        val toasts=Toaster();val vm=AuthViewModel(repository,toasts)
        repository.signInGate=CompletableDeferred()
        vm.act(AuthAction.SIGN_IN,"a@example.test","password"); runCurrent()
        assertEquals(R.string.auth_signing_in to ToastTone.PENDING,toasted(toasts))
        repository.signInGate!!.complete(repository.session); advanceUntilIdle()
        assertEquals(R.string.toast_signed_in to ToastTone.SUCCESS,toasted(toasts))
    }
    @Test fun aFailedSignInReportsTheSameReasonAsTheScreen()=runTest(dispatcher) {
        val toasts=Toaster();val vm=AuthViewModel(repository,toasts)
        repository.signInFailure=RemoteFailure(400,"email_not_confirmed")
        vm.act(AuthAction.SIGN_IN,"a@example.test","password"); advanceUntilIdle()
        assertEquals(AuthNotice.EMAIL_UNCONFIRMED.label() to ToastTone.ERROR,toasted(toasts))
    }
    @Test fun invalidInputIsReportedWithoutARequest()=runTest(dispatcher) {
        val toasts=Toaster();val vm=AuthViewModel(repository,toasts)
        vm.act(AuthAction.SIGN_IN,"invalid","password")
        assertEquals(AuthNotice.INVALID_EMAIL.label() to ToastTone.ERROR,toasted(toasts))
        assertEquals(0,repository.calls)
    }
    @Test fun creatingAnAccountIsPendingUntilTheEmailIsVerified()=runTest(dispatcher) {
        val toasts=Toaster();val vm=AuthViewModel(repository,toasts)
        vm.act(AuthAction.REGISTER,"a@example.test","password"); advanceUntilIdle()
        assertEquals(R.string.toast_account_created to ToastTone.PENDING,toasted(toasts))
    }
    private val profile=com.motivance.domain.PatientProfile("fixture_user","Fixture Person","female","1990-01-01","Fixture address","+639001234567",consent=true,firstName="Fixture",lastName="Person")
    @Test fun theSignupFlowReportsPendingThenAwaitingVerification()=runTest(dispatcher) {
        val toasts=Toaster();val vm=AuthViewModel(repository,toasts)
        vm.registerProfile("a@example.test","password1",profile)
        assertEquals(R.string.auth_creating_account to ToastTone.PENDING,toasted(toasts))
        advanceUntilIdle()
        assertEquals(R.string.toast_account_created to ToastTone.PENDING,toasted(toasts))
    }
    @Test fun aFailedSignupIsReported()=runTest(dispatcher) {
        val toasts=Toaster();val vm=AuthViewModel(repository,toasts)
        repository.failRegister=true
        vm.registerProfile("a@example.test","password1",profile); advanceUntilIdle()
        assertEquals(AuthNotice.REQUEST_FAILED.label() to ToastTone.ERROR,toasted(toasts))
    }
    @Test fun signingOutIsReported()=runTest(dispatcher) {
        val toasts=Toaster();val vm=AuthViewModel(repository,toasts)
        vm.act(AuthAction.SIGN_IN,"a@example.test","password"); advanceUntilIdle()
        vm.act(AuthAction.SIGN_OUT); advanceUntilIdle()
        assertEquals(R.string.toast_signed_out to ToastTone.SUCCESS,toasted(toasts))
    }
    @Test fun restoringASessionOnLaunchIsSilent()=runTest(dispatcher) {
        val toasts=Toaster();val vm=AuthViewModel(repository,toasts)
        vm.restore(); advanceUntilIdle()
        assertNull(toasts.current.value)
    }
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

    @Test fun resendTrimsEmailAndNeverPublishesSession()=runTest(dispatcher) {
        val vm=AuthViewModel(repository)
        vm.act(AuthAction.RESEND_CONFIRMATION,"  a@example.test  "); advanceUntilIdle()
        assertEquals("a@example.test",repository.resentEmail)
        assertEquals(AuthNotice.CONFIRM_EMAIL,vm.state.value.notice)
        assertNull(vm.state.value.session)
    }
    @Test fun authFailuresHaveActionableSafeNotices()=runTest(dispatcher) {
        val vm=AuthViewModel(repository)
        for((failure,notice) in listOf(
            RemoteFailure(400,"email_not_confirmed") to AuthNotice.EMAIL_UNCONFIRMED,
            RemoteFailure(403,"otp_expired") to AuthNotice.INVALID_CODE,
            RemoteFailure(429) to AuthNotice.RATE_LIMITED,
            RemoteFailure(422,"weak_password") to AuthNotice.PASSWORD_POLICY
        )) {
            repository.signInFailure=failure
            vm.act(AuthAction.SIGN_IN,"a@example.test","password"); advanceUntilIdle()
            assertEquals(notice,vm.state.value.notice)
            assertNull(vm.state.value.session)
            assertFalse(vm.state.value.busy)
        }
    }

    @Test fun aSignUpCodeThatFailsSaysToSignUpAgainButARecoveryCodeDoesNot()=runTest(dispatcher) {
        // An expired sign-up is deleted, so a new code cannot help it; a password reset can still ask for one.
        val vm=AuthViewModel(repository)
        repository.codeFailure=RemoteFailure(403,"otp_expired")
        vm.act(AuthAction.CONFIRM,"a@example.test",otp="123456"); advanceUntilIdle()
        assertEquals(AuthNotice.SIGNUP_CODE_EXPIRED,vm.state.value.notice)
        vm.act(AuthAction.RECOVER,"a@example.test","new-password-1",otp="123456"); advanceUntilIdle()
        assertEquals(AuthNotice.INVALID_CODE,vm.state.value.notice)
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
        var failRegister=false
        override suspend fun registerProfile(email:String,password:String,profile:com.motivance.domain.PatientProfile) {if(failRegister) error("sensitive backend detail")}
        var failSignIn=false
        var signInFailure:Exception?=null
        var resentEmail:String?=null
        override suspend fun signIn(email:String,password:String):UserSession {
            calls++; if(failSignIn) error("sensitive backend detail")
            signInFailure?.let {throw it}
            return signInGate?.await() ?: session
        }
        override suspend fun register(email:String,password:String) { calls++ }
        override suspend fun resendConfirmation(email:String) {calls++;resentEmail=email}
        var codeFailure:Exception?=null
        override suspend fun confirmRegistration(email:String,token:String):UserSession { calls++; codeFailure?.let {throw it}; return session }
        override suspend fun requestRecovery(email:String) { calls++ }
        override suspend fun recover(email:String,token:String,newPassword:String):UserSession { calls++; codeFailure?.let {throw it}; return session }
        override suspend fun refresh():UserSession { calls++; if(failRefresh) error("expired token"); return session }
        override suspend fun signOut() { calls++; signOutGate?.await() }
        override suspend fun loadOverview()=overviewGate?.await() ?: WorkspaceOverview()
    }
}
