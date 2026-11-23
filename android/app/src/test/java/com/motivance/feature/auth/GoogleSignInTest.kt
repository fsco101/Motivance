package com.motivance.feature.auth

import com.motivance.R
import com.motivance.designsystem.ToastTone
import com.motivance.designsystem.Toaster
import com.motivance.domain.AuthRepository
import com.motivance.domain.GoogleAccounts
import com.motivance.domain.GoogleFailure
import com.motivance.domain.GoogleSignInFailure
import com.motivance.domain.GoogleToken
import com.motivance.domain.RemoteFailure
import com.motivance.domain.SignInMethods
import com.motivance.domain.UserRole
import com.motivance.domain.UserSession
import com.motivance.domain.WorkspaceOverview
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.io.IOException

/** Continue with Google on Android (#168), with a stubbed token: the picker itself needs a phone and is checked there. */
@OptIn(ExperimentalCoroutinesApi::class)
class GoogleSignInTest {
    private val dispatcher=StandardTestDispatcher()
    @Before fun setup() {Dispatchers.setMain(dispatcher)}
    @After fun teardown() {Dispatchers.resetMain()}
    private val token=GoogleToken("stub.id.token","raw-nonce")

    private class Fake(var roles:Set<UserRole> = setOf(UserRole.PATIENT),var methods:SignInMethods=SignInMethods()):AuthRepository {
        var failure:Exception?=null
        val received=mutableListOf<GoogleToken>()
        override suspend fun signInWithGoogle(token:GoogleToken):UserSession {received+=token;failure?.let {throw it};return UserSession("google-user",roles)}
        override suspend fun signInMethods()=methods
        override suspend fun signIn(email:String,password:String)=UserSession("fixture",roles)
        override suspend fun register(email:String,password:String) {}
        override suspend fun confirmRegistration(email:String,token:String)=UserSession("fixture",roles)
        override suspend fun requestRecovery(email:String) {}
        override suspend fun recover(email:String,token:String,newPassword:String)=UserSession("fixture",roles)
        override suspend fun refresh()=UserSession("fixture",roles)
        override suspend fun signOut() {}
        override suspend fun loadOverview()=WorkspaceOverview()
    }

    @Test fun aGoogleTokenSignsInAndIsStoredLikeAPasswordSignIn()=runTest(dispatcher) {
        val auth=Fake();val toasts=Toaster();val vm=AuthViewModel(auth,toasts)
        vm.continueWithGoogle {token};advanceUntilIdle()
        assertEquals("google-user",vm.state.value.session?.userId)
        assertEquals(listOf(token),auth.received)
        assertFalse(vm.state.value.busy);assertNull(vm.state.value.notice)
        assertEquals(R.string.toast_signed_in to ToastTone.SUCCESS,toasts.current.value?.let {it.message to it.tone})
    }

    @Test fun theButtonShowsItIsWorkingUntilGoogleAnswers()=runTest(dispatcher) {
        val vm=AuthViewModel(Fake())
        val answer=kotlinx.coroutines.CompletableDeferred<GoogleToken>()
        vm.continueWithGoogle {answer.await()};runCurrent()
        assertTrue(vm.state.value.busy);assertEquals(AuthAction.GOOGLE,vm.state.value.activeAction)
        vm.continueWithGoogle {error("A second tap must not start a second sign-in")};runCurrent()
        answer.complete(token);advanceUntilIdle()
        assertFalse(vm.state.value.busy);assertNull(vm.state.value.activeAction)
    }

    @Test fun aNewGooglePatientFinishesTheirProfileBeforeHome()=runTest(dispatcher) {
        val vm=AuthViewModel(Fake(methods=SignInMethods(password=false,google=true,profileRequired=true)))
        vm.continueWithGoogle {token};advanceUntilIdle()
        assertTrue(vm.state.value.profileRequired)
        vm.profileFinished()
        assertFalse(vm.state.value.profileRequired)
        assertNotNull(vm.state.value.session)
    }

    @Test fun staffAreNeverStoppedForPatientDetails()=runTest(dispatcher) {
        val vm=AuthViewModel(Fake(roles=setOf(UserRole.PATIENT,UserRole.THERAPIST),methods=SignInMethods(profileRequired=true)))
        vm.continueWithGoogle {token};advanceUntilIdle()
        assertFalse(vm.state.value.profileRequired)
    }

    @Test fun aRestoredGooglePatientIsStillAskedAndAnUnreadableAnswerHoldsNoOneBack()=runTest(dispatcher) {
        val auth=object:AuthRepository by Fake(methods=SignInMethods(profileRequired=true)) {
            override suspend fun restoreSession()=UserSession("google-user",setOf(UserRole.PATIENT))
        }
        val vm=AuthViewModel(auth);vm.restore();advanceUntilIdle()
        assertTrue(vm.state.value.profileRequired)
        val offline=object:AuthRepository by Fake() {
            override suspend fun restoreSession()=UserSession("google-user",setOf(UserRole.PATIENT))
            override suspend fun signInMethods():SignInMethods=throw IOException("offline")
        }
        val second=AuthViewModel(offline);second.restore();advanceUntilIdle()
        assertNotNull(second.state.value.session);assertFalse(second.state.value.profileRequired)
    }

    @Test fun eachFailureHasItsOwnMessageAndNeverTheGenericOne() {
        val cases=mapOf<Exception,AuthNotice>(
            GoogleSignInFailure(GoogleFailure.CANCELLED) to AuthNotice.GOOGLE_CANCELLED,
            GoogleSignInFailure(GoogleFailure.NO_ACCOUNT) to AuthNotice.GOOGLE_NO_ACCOUNT,
            GoogleSignInFailure(GoogleFailure.UNAVAILABLE) to AuthNotice.GOOGLE_UNAVAILABLE,
            GoogleSignInFailure(GoogleFailure.NOT_CONFIGURED) to AuthNotice.GOOGLE_NOT_CONFIGURED,
            IOException("no route") to AuthNotice.GOOGLE_OFFLINE,
            RemoteFailure(400) to AuthNotice.GOOGLE_REFUSED,
            RemoteFailure(401) to AuthNotice.GOOGLE_REFUSED,
            RemoteFailure(422,"signup_disabled") to AuthNotice.GOOGLE_CLOSED,
            RemoteFailure(400,"provider_disabled") to AuthNotice.GOOGLE_NOT_CONFIGURED,
            RemoteFailure(429) to AuthNotice.RATE_LIMITED,
            RemoteFailure(500) to AuthNotice.GOOGLE_FAILED,
            IllegalStateException("anything else") to AuthNotice.GOOGLE_FAILED,
        )
        cases.forEach {(failure,notice) -> assertEquals(failure.toString(),notice,googleNotice(failure))}
        assertTrue(cases.values.none {it==AuthNotice.REQUEST_FAILED})
        // Every Google message is its own text, not the generic one.
        assertTrue(cases.values.map {it.label()}.none {it==R.string.request_failed})
    }

    @Test fun aRefusedTokenOrNoConnectionIsShownOnThePage()=runTest(dispatcher) {
        for((failure,notice) in listOf(RemoteFailure(400) to AuthNotice.GOOGLE_REFUSED,IOException("offline") to AuthNotice.GOOGLE_OFFLINE)) {
            val auth=Fake().also {it.failure=failure};val toasts=Toaster();val vm=AuthViewModel(auth,toasts)
            vm.continueWithGoogle {token};advanceUntilIdle()
            assertEquals(notice,vm.state.value.notice);assertNull(vm.state.value.session);assertFalse(vm.state.value.busy)
            assertEquals(notice.label() to ToastTone.ERROR,toasts.current.value?.let {it.message to it.tone})
        }
    }

    @Test fun aCancelledPickerIsNotedWithoutAnAlarm()=runTest(dispatcher) {
        val auth=Fake();val toasts=Toaster();val vm=AuthViewModel(auth,toasts)
        vm.continueWithGoogle {throw GoogleSignInFailure(GoogleFailure.CANCELLED)};advanceUntilIdle()
        assertEquals(AuthNotice.GOOGLE_CANCELLED,vm.state.value.notice)
        assertNull(toasts.current.value)
        assertTrue("Nothing is sent when the picker is closed",auth.received.isEmpty())
    }

    @Test fun signingOutForgetsTheGoogleChoiceForTheNextPerson()=runTest(dispatcher) {
        val order=mutableListOf<String>()
        val accounts=object:GoogleAccounts {override suspend fun forget() {order+="forget"}}
        val auth=object:AuthRepository by Fake() {override suspend fun signOut() {order+="signOut"}}
        val vm=AuthViewModel(auth,Toaster(),com.motivance.domain.PushDevices.None,accounts)
        vm.act(AuthAction.SIGN_OUT);advanceUntilIdle()
        assertEquals(listOf("forget","signOut"),order)
    }

    @Test fun eachAttemptHasAFreshNonceAndGoogleSeesOnlyItsHash() {
        val first=newNonce();val second=newNonce()
        assertNotEquals(first,second)
        assertEquals(64,first.length)
        // SHA-256 of "abc", the standard test vector.
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",sha256Hex("abc"))
        assertNotEquals(first,sha256Hex(first))
    }
}
