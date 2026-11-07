package com.motivance.data.push

import com.motivance.domain.NotificationInbox
import com.motivance.domain.NotificationRepository
import com.motivance.domain.RemoteFailure
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PushRegistrarTest {
    private class Remote:NotificationRepository {
        val registered=mutableListOf<String>()
        val removed=mutableListOf<String>()
        var failure:Exception?=null
        override suspend fun loadNotifications()=NotificationInbox()
        override suspend fun markNotificationsRead(ids:List<String>?)=0
        override suspend fun saveLanguage(language:String) {}
        override suspend fun registerDevice(token:String) {failure?.let {throw it};registered+=token}
        override suspend fun unregisterDevice(token:String) {failure?.let {throw it};removed+=token}
    }

    @Test fun aPhoneWithAFirebaseTokenRegistersIt()=runTest {
        val remote=Remote()
        PushRegistrar(remote) {"token-1"}.register()
        assertEquals(listOf("token-1"),remote.registered)
    }

    @Test fun withNoFirebaseValuesThereIsNoTokenAndNothingIsSent()=runTest {
        val remote=Remote()
        val registrar=PushRegistrar(remote) {null}
        registrar.register();registrar.unregister()
        assertTrue(remote.registered.isEmpty() && remote.removed.isEmpty())
    }

    @Test fun signingOutRemovesThePhone()=runTest {
        val remote=Remote()
        PushRegistrar(remote) {"token-1"}.unregister()
        assertEquals(listOf("token-1"),remote.removed)
    }

    @Test fun aNewTokenIsSentOn()=runTest {
        val remote=Remote()
        PushRegistrar(remote) {null}.tokenChanged("token-2")
        assertEquals(listOf("token-2"),remote.registered)
    }

    @Test fun aFailureNeverReachesThePerson()=runTest {
        val remote=Remote().apply {failure=RemoteFailure(503)}
        val registrar=PushRegistrar(remote) {"token-1"}
        registrar.register();registrar.unregister();registrar.tokenChanged("token-2")
        assertTrue(remote.registered.isEmpty())
    }

    @Test fun aSlowConnectionCannotHoldUpSigningOut()=runTest {
        val never=CompletableDeferred<String?>()
        val registrar=PushRegistrar(Remote()) {never.await()}
        registrar.unregister()
        assertTrue("It gave up rather than waiting for a token",!never.isCompleted)
    }

    @Test fun allFourValuesAreNeeded() {
        assertTrue(FirebaseValues("p","a","k","s").complete)
        listOf(FirebaseValues("","a","k","s"),FirebaseValues("p","","k","s"),FirebaseValues("p","a","","s"),FirebaseValues("p","a","k"," ")).forEach {assertFalse(it.toString(),it.complete)}
    }

    @Test fun thePersonIsAskedOnlyWhenItMatters() {
        assertEquals("No Firebase values",PushPrompt.NOTHING,pushPrompt(enabled=false,signedIn=true,sdk=35,granted=false))
        assertEquals("Signed out",PushPrompt.NOTHING,pushPrompt(enabled=true,signedIn=false,sdk=35,granted=false))
        assertEquals(PushPrompt.ASK,pushPrompt(enabled=true,signedIn=true,sdk=33,granted=false))
        assertEquals(PushPrompt.REGISTER,pushPrompt(enabled=true,signedIn=true,sdk=33,granted=true))
        assertEquals("Before Android 13 there is nothing to ask",PushPrompt.REGISTER,pushPrompt(enabled=true,signedIn=true,sdk=32,granted=false))
    }
}
