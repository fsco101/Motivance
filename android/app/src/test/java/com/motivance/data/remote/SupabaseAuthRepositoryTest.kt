package com.motivance.data.remote

import kotlinx.coroutines.runBlocking
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Test
import com.motivance.domain.UserRole
import com.motivance.domain.RemoteFailure
import org.json.JSONObject

class SupabaseAuthRepositoryTest {
    private val requests=mutableListOf<Request>()
    private var failRefresh=false
    private var failLogout=false
    private var verificationError:String?=null
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
        val verifyFailed=verificationError!=null && request.url.encodedPath=="/auth/v1/verify"
        val failed=verifyFailed || (failRefresh && request.url.query?.contains("refresh_token")==true) || (failLogout && request.url.encodedPath=="/auth/v1/logout")
        Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(if(failed) 401 else 200).message("Fixture")
            .body((if(verifyFailed) verificationError!! else responseBody).toResponseBody("application/json".toMediaType())).build()
    }.build()
    private fun repository()=SupabaseAuthRepository(client,"https://fixture.invalid","public-fixture-key")
    @Test fun signupSendsValidatedDetailsAndConsent()=runBlocking {
        val profile=com.motivance.domain.PatientProfile("patient_one","Test Patient","female","1995-01-01","Test address","09001234567",consent=true)
        repository().registerProfile("a@example.test","fixture-password",profile)
        val buffer=okio.Buffer();requests.single().body!!.writeTo(buffer)
        val data=JSONObject(buffer.readUtf8()).getJSONObject("data").getJSONObject("patient_profile")
        assertTrue(data.getBoolean("consent"));assertFalse("The retired icon choice is no longer sent",data.has("avatar"))
        requests.clear()
        assertTrue(runCatching {repository().registerProfile("a@example.test","fixture-password",profile.copy(consent=false))}.isFailure)
        assertTrue(requests.isEmpty())
    }
    @Test fun incorrectCurrentPasswordNeverReachesPasswordUpdate()=runBlocking {
        val seen=mutableListOf<Request>();var signingIn=true
        val http=OkHttpClient.Builder().addInterceptor {chain ->
            val r=chain.request();seen+=r
            val rejected=!signingIn && r.url.queryParameter("grant_type")=="password"
            val body=when(r.url.encodedPath) {
                "/rest/v1/user_roles" -> "[{\"role\":\"patient\"}]"
                "/auth/v1/user" -> "{\"email\":\"a@example.test\"}"
                else -> session
            }
            Response.Builder().request(r).protocol(Protocol.HTTP_1_1).code(if(rejected)400 else 200).message("Fixture").body(body.toResponseBody("application/json".toMediaType())).build()
        }.build()
        val repo=SupabaseAuthRepository(http,"https://fixture.invalid","public-fixture")
        repo.signIn("a@example.test","old-password");signingIn=false
        assertTrue(runCatching {repo.changePassword("wrong-password","new-password")}.isFailure)
        assertFalse(seen.any {it.method=="PUT"})
    }
    @Test fun resendUsesSignupEmailAndNoPasswordOrToken()=runBlocking {
        repository().resendConfirmation("patient@example.test")
        val request=requests.single()
        assertEquals("/auth/v1/resend",request.url.encodedPath)
        val buffer=okio.Buffer();request.body!!.writeTo(buffer)
        val payload=JSONObject(buffer.readUtf8())
        assertEquals("signup",payload.getString("type"))
        assertEquals("patient@example.test",payload.getString("email"))
        assertEquals(2,payload.length())
        assertNull(request.header("Authorization"))
    }
    @Test fun invalidRecoveryCodeCannotChangePasswordAndOnlySafeCodeEscapes()=runBlocking {
        verificationError="""{"code":"otp_expired","msg":"sensitive provider detail"}"""
        val failure=runCatching {repository().recover("patient@example.test","bad-code","new-password")}.exceptionOrNull() as RemoteFailure
        assertEquals("otp_expired",failure.code)
        assertFalse(failure.toString().contains("sensitive"))
        assertEquals(listOf("/auth/v1/verify"),requests.map {it.url.encodedPath})
    }
    @Test fun unknownBackendCodeAndPayloadAreDiscarded()=runBlocking {
        verificationError="""{"code":"private-token-value","msg":"sensitive provider detail"}"""
        val failure=runCatching {repository().confirmRegistration("patient@example.test","123456")}.exceptionOrNull() as RemoteFailure
        assertNull(failure.code)
        assertFalse(failure.toString().contains("private-token-value"))
    }
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
    /** A role added on the server must never stop an existing app signing in. */
    @Test fun signInKeepsKnownRolesAndIgnoresOnesThisBuildDoesNotKnow()=runBlocking {
        val http=OkHttpClient.Builder().addInterceptor {chain ->
            val r=chain.request()
            val body=if(r.url.encodedPath=="/rest/v1/user_roles") """[{"role":"patient"},{"role":"scheduler"},{"role":"clerk"}]""" else session
            Response.Builder().request(r).protocol(Protocol.HTTP_1_1).code(200).message("Fixture").body(body.toResponseBody("application/json".toMediaType())).build()
        }.build()
        val signedIn=SupabaseAuthRepository(http,"https://fixture.invalid","public-fixture").signIn("a@example.test","fixture-password")
        assertEquals(setOf(UserRole.PATIENT,UserRole.SCHEDULER),signedIn.roles)
        assertEquals(UserRole.SCHEDULER,signedIn.primaryRole)
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

    /** One fixture backend for the Google tests: answers by path, and can refuse the ID token. */
    private fun googleBackend(seen:MutableList<Pair<Request,String>>,refuse:Int?=null,methods:String="""{"password":false,"google":true,"profile_required":true}""")=OkHttpClient.Builder().addInterceptor {chain ->
        val r=chain.request()
        val body=r.body?.let {val b=okio.Buffer();it.writeTo(b);b.readUtf8()}.orEmpty();seen+=r to body
        val idToken=r.url.queryParameter("grant_type")=="id_token"
        val (code,answer)=when {
            idToken && refuse!=null -> refuse to """{"code":"bad_jwt","message":"Bad ID token"}"""
            r.url.encodedPath=="/rest/v1/user_roles" -> 200 to """[{"role":"patient"}]"""
            r.url.encodedPath=="/rest/v1/rpc/my_sign_in" -> 200 to methods
            r.url.encodedPath=="/auth/v1/user" -> 200 to """{"email":"google@example.test"}"""
            r.url.encodedPath.startsWith("/rest/v1/") -> 200 to "[]"
            else -> 200 to session
        }
        Response.Builder().request(r).protocol(Protocol.HTTP_1_1).code(code).message("Fixture").body(answer.toResponseBody("application/json".toMediaType())).build()
    }.build()
    @Test fun googleSignInSendsTheIdTokenAndRawNonceAndStoresTheSession()=runBlocking {
        val seen=mutableListOf<Pair<Request,String>>()
        val repo=SupabaseAuthRepository(googleBackend(seen),"https://fixture.invalid","public-fixture")
        val result=repo.signInWithGoogle(com.motivance.domain.GoogleToken("stub.id.token","raw-nonce"))
        val (request,body)=seen.first()
        assertEquals("/auth/v1/token",request.url.encodedPath);assertEquals("id_token",request.url.queryParameter("grant_type"))
        assertEquals("POST",request.method)
        val sent=JSONObject(body)
        assertEquals("google",sent.getString("provider"));assertEquals("stub.id.token",sent.getString("id_token"));assertEquals("raw-nonce",sent.getString("nonce"))
        assertEquals(setOf(UserRole.PATIENT),result.roles)
        // Stored exactly like a password sign-in: later calls carry the same session's token.
        repo.signInMethods()
        assertEquals("Bearer test-access",seen.last().first.header("Authorization"))
    }
    @Test fun aRefusedGoogleTokenFailsWithItsStatusAndStoresNothing()=runBlocking {
        val seen=mutableListOf<Pair<Request,String>>()
        val repo=SupabaseAuthRepository(googleBackend(seen,refuse=400),"https://fixture.invalid","public-fixture")
        val failure=runCatching {repo.signInWithGoogle(com.motivance.domain.GoogleToken("forged","raw-nonce"))}.exceptionOrNull()
        assertEquals(400,(failure as RemoteFailure).status)
        assertNull("The server's own words are not passed on",failure.code)
        assertEquals(1,seen.size)
        assertTrue(runCatching {repo.signInMethods()}.exceptionOrNull() is RemoteFailure)
    }
    @Test fun signInMethodsAndProfileShowAGoogleOnlyAccount()=runBlocking {
        val seen=mutableListOf<Pair<Request,String>>()
        val repo=SupabaseAuthRepository(googleBackend(seen),"https://fixture.invalid","public-fixture")
        repo.signInWithGoogle(com.motivance.domain.GoogleToken("stub.id.token","raw-nonce"))
        assertEquals(com.motivance.domain.SignInMethods(password=false,google=true,profileRequired=true),repo.signInMethods())
        val profile=repo.loadProfile()
        assertFalse(profile.passwordSet);assertTrue(profile.googleLinked)
        val disabled=SupabaseAuthRepository(googleBackend(mutableListOf(),methods="null"),"https://fixture.invalid","public-fixture")
        disabled.signInWithGoogle(com.motivance.domain.GoogleToken("stub.id.token","raw-nonce"))
        assertEquals(com.motivance.domain.SignInMethods(),disabled.signInMethods())
    }
    @Test fun aGoogleOnlyAccountSetsItsFirstPasswordWithoutACurrentOne()=runBlocking {
        val seen=mutableListOf<Pair<Request,String>>()
        val repo=SupabaseAuthRepository(googleBackend(seen),"https://fixture.invalid","public-fixture")
        repo.signInWithGoogle(com.motivance.domain.GoogleToken("stub.id.token","raw-nonce"));seen.clear()
        repo.setFirstPassword("new-password-1")
        val (request,body)=seen.single()
        assertEquals("PUT",request.method);assertEquals("/auth/v1/user",request.url.encodedPath)
        assertEquals("new-password-1",JSONObject(body).getString("password"))
        assertFalse(seen.any {it.first.url.queryParameter("grant_type")=="password"})
        assertTrue(runCatching {repo.setFirstPassword("short")}.isFailure)
    }
}
