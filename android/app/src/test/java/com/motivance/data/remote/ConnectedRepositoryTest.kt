package com.motivance.data.remote

import com.motivance.domain.RemoteFailure
import kotlinx.coroutines.runBlocking
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Test

class ConnectedRepositoryTest {
    @Test fun prescribedFocusIsSentInsideTheVersionedParameters()=runBlocking {
        var parameters:org.json.JSONObject?=null
        val client=OkHttpClient.Builder().addInterceptor {chain ->
            val request=chain.request();val path=request.url.encodedPath
            val body=when {
                path.endsWith("user_roles") -> """[{"role":"therapist"}]"""
                path.endsWith("publish_prescription") -> {
                    val buffer=okio.Buffer();request.body!!.writeTo(buffer)
                    parameters=org.json.JSONObject(buffer.readUtf8()).getJSONObject("p_parameters");"\"version\""
                }
                else -> """{"access_token":"fixture-access","refresh_token":"fixture-refresh","user":{"id":"fixture-owner"}}"""
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("fixture").body(body.toResponseBody("application/json".toMediaType())).build()
        }.build()
        val repo=SupabaseAuthRepository(client,"https://fixture.invalid","public-fixture")
        repo.signIn("fixture@example.test","fixture-password")
        repo.publishPrescription(com.motivance.domain.PrescriptionDraft("assignment","version","patient","exercise",com.motivance.domain.BodySide.RIGHT,20.0,90.0,5,focusJoint=com.motivance.domain.BodyJoint.KNEE))
        assertEquals("KNEE",parameters!!.getString("focus_joint"))
    }
    @Test fun expiredUploadTokenRefreshesOnceAndRetriesTheSameSession()=runBlocking {
        val requests=mutableListOf<Request>(); var uploads=0
        val client=OkHttpClient.Builder().addInterceptor {chain ->
            val request=chain.request(); requests+=request
            val path=request.url.encodedPath
            val body=when(path) {
                "/rest/v1/user_roles" -> """[{"role":"patient"}]"""
                "/rest/v1/rpc/ingest_session" -> """{"sessionId":"fixture-session","duplicate":true}"""
                else -> """{"access_token":"fixture-access","refresh_token":"fixture-refresh","user":{"id":"fixture-owner"}}"""
            }
            val rejected=path.endsWith("ingest_session") && uploads++==0
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(if(rejected) 401 else 200).message("fixture").body(body.toResponseBody("application/json".toMediaType())).build()
        }.build()
        val repo=SupabaseAuthRepository(client,"https://fixture.invalid","public-fixture")
        repo.signIn("fixture@example.test","fixture-password")
        repo.uploadSession("fixture-owner","""{"sessionId":"fixture-session"}""")
        assertEquals(2,uploads)
        assertEquals(1,requests.count {it.url.queryParameter("grant_type")=="refresh_token"})
        val bodies=requests.filter {it.url.encodedPath.endsWith("ingest_session")}.map {val buffer=okio.Buffer();it.body!!.writeTo(buffer);buffer.readUtf8()}
        assertEquals(bodies.first(),bodies.last())
    }
    @Test fun outboxOwnerMustMatchTheAuthenticatedAccountBeforeAnyUpload()=runBlocking {
        var calls=0
        val client=OkHttpClient.Builder().addInterceptor {chain ->
            calls++
            val body=if(chain.request().url.encodedPath.endsWith("user_roles")) """[{"role":"patient"}]""" else """{"access_token":"a","refresh_token":"r","user":{"id":"owner-a"}}"""
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("fixture").body(body.toResponseBody("application/json".toMediaType())).build()
        }.build()
        val repo=SupabaseAuthRepository(client,"https://fixture.invalid","public-fixture");repo.signIn("fixture@example.test","fixture-password")
        val before=calls
        val error=runCatching {repo.uploadSession("owner-b","{}")} .exceptionOrNull()
        assertTrue(error is RemoteFailure && error.status==401);assertEquals(before,calls)
    }
}
