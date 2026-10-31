package com.motivance.data.remote

import kotlinx.coroutines.runBlocking
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Test
import com.motivance.domain.UserRole

class SupabaseAuthRepositoryTest {
    private val requests=mutableListOf<Request>()
    private var failRefresh=false
    private var failLogout=false
    private val session="""{"access_token":"test-access","refresh_token":"test-refresh","user":{"id":"test-user"}}"""
    private val client=OkHttpClient.Builder().addInterceptor { chain ->
        val request=chain.request(); requests.add(request)
        val roles=request.url.encodedPath.contains("user_roles")
        val responseBody=when(request.url.encodedPath) {
            "/rest/v1/profiles" -> """[{"display_name":"Fixture patient"}]"""
            "/rest/v1/patients" -> """[{"id":"test-user"},{"id":"assigned-patient"}]"""
            "/rest/v1/sessions" -> """[{"id":"session","patient_id":"test-user","started_at":"2026-10-31T00:00:00Z","status":"completed"}]"""
            "/rest/v1/exercise_assignments" -> """[{"id":"assignment","patient_id":"test-user"}]"""
            else -> if(roles) """[{"role":"patient"}]""" else session
        }
        val failed=(failRefresh && request.url.query?.contains("refresh_token")==true) || (failLogout && request.url.encodedPath=="/auth/v1/logout")
        Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(if(failed) 401 else 200).message("Fixture")
            .body(responseBody.toResponseBody("application/json".toMediaType())).build()
    }.build()
    private fun repository()=SupabaseAuthRepository(client,"https://fixture.invalid","public-fixture-key")
    @Test fun dashboardUsesAuthenticatedApiAndExcludesOwnPatientProfileFromStaffCount()=runBlocking {
        val repo=repository(); repo.signIn("a@example.test","password")
        val result=repo.loadOverview()
        assertEquals("Fixture patient",result.displayName)
        assertEquals(listOf("assigned-patient"),result.patientIds)
        assertEquals("completed",result.sessions.single().status)
        assertEquals("assignment",result.assignments.single().id)
        assertTrue(requests.takeLast(4).all { it.header("Authorization")=="Bearer test-access" })
    }
    @Test fun confirmationUsesSignupVerificationAndLoadsServerRoles()=runBlocking {
        val result=repository().confirmRegistration("patient@example.invalid","fixture-code")
        assertEquals(setOf(UserRole.PATIENT),result.roles)
        assertEquals("/auth/v1/verify",requests.first().url.encodedPath)
        val buffer=okio.Buffer(); requests.first().body!!.writeTo(buffer)
        assertTrue(buffer.readUtf8().contains("signup"))
    }
    @Test fun releaseRejectsCleartextLocalEndpoint()=runBlocking {
        val repository=SupabaseAuthRepository(client,"http://127.0.0.1:54321","public-key",false)
        assertTrue(runCatching { repository.register("patient@example.invalid","fixture-password") }.isFailure)
        assertTrue(requests.isEmpty())
    }
    @Test fun debugRejectsRemoteCleartextEndpoint()=runBlocking {
        val repository=SupabaseAuthRepository(client,"http://remote.invalid:54321","public-key",true)
        assertTrue(runCatching { repository.register("patient@example.invalid","fixture-password") }.isFailure)
        assertTrue(requests.isEmpty())
    }
    @Test fun signInUsesServerRolesAndAuthenticatedRoleLookup()=runBlocking {
        val session=repository().signIn("patient@example.invalid","fixture-password")
        assertEquals(setOf(UserRole.PATIENT),session.roles)
        assertEquals("Bearer test-access",requests.last().header("Authorization"))
        assertEquals("password",requests.first().url.queryParameter("grant_type"))
    }
    @Test fun refreshFailureClearsSessionAndCannotRetryOldToken()=runBlocking {
        val repository=repository(); repository.signIn("patient@example.invalid","fixture-password")
        failRefresh=true
        assertTrue(runCatching { repository.refresh() }.isFailure)
        val count=requests.size
        assertTrue(runCatching { repository.refresh() }.isFailure)
        assertEquals(count,requests.size)
    }
    @Test fun signOutClearsLocalSessionEvenWhenRemoteFails()=runBlocking {
        val repository=repository(); repository.signIn("patient@example.invalid","fixture-password")
        failLogout=true
        assertTrue(runCatching { repository.signOut() }.isFailure)
        assertTrue(runCatching { repository.refresh() }.isFailure)
        assertEquals("/auth/v1/logout",requests.last().url.encodedPath)
    }
    @Test fun recoveryVerifiesCodeBeforePasswordChange()=runBlocking {
        val repository=repository()
        repository.requestRecovery("patient@example.invalid")
        repository.recover("patient@example.invalid","fixture-code","new-fixture-password")
        assertEquals(listOf("/auth/v1/recover","/auth/v1/verify","/auth/v1/user","/rest/v1/user_roles"),requests.map { it.url.encodedPath })
        assertEquals("PUT",requests[2].method)
        assertEquals("Bearer test-access",requests[2].header("Authorization"))
    }
    @Test fun registrationSendsNoPrivilegedRoleClaim()=runBlocking {
        repository().register("patient@example.invalid","fixture-password")
        val buffer=okio.Buffer(); requests.single().body!!.writeTo(buffer)
        val payload=buffer.readUtf8()
        assertFalse(payload.contains("role")); assertFalse(payload.contains("admin"))
    }
}
