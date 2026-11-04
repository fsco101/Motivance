package com.motivance.data.remote

import com.motivance.domain.RemoteFailure
import kotlinx.coroutines.runBlocking
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ProfilePhotoRepositoryTest {
    private val pid="motivance/avatars/0f8fad5b-d9cb-469f-a165-70867728950e/"+"b".repeat(32)
    private val delivered="https://res.cloudinary.com/demo/image/upload/v17/$pid"
    private val requests=mutableListOf<Pair<Request,String>>()
    private var ticketStatus=200
    private var uploadedId=pid

    private fun repository():SupabaseAuthRepository {
        val client=OkHttpClient.Builder().addInterceptor {chain ->
            val request=chain.request()
            val body=request.body?.let {val b=okio.Buffer();it.writeTo(b);b.readUtf8()}.orEmpty()
            requests+=request to body
            val path=request.url.encodedPath
            val (code,text)=when {
                request.url.host=="cloudinary.fixture.invalid" -> 200 to """{"public_id":"$uploadedId","version":17,"signature":"response-signature"}"""
                path=="/rest/v1/user_roles" -> 200 to """[{"role":"patient"}]"""
                path=="/rest/v1/rpc/profile_photo_upload" -> ticketStatus to """{"cloud_name":"demo","api_key":"123456789012345","timestamp":1730700000,"public_id":"$pid","signature":"request-signature"}"""
                path=="/rest/v1/rpc/set_my_profile_photo" -> 200 to "\"$delivered\""
                path=="/auth/v1/user" -> 200 to """{"email":"p@example.test"}"""
                path=="/rest/v1/patient_profiles" -> 200 to "[]"
                path=="/rest/v1/profiles" -> 200 to """[{"photo_url":"$delivered"}]"""
                else -> 200 to """{"access_token":"fixture-access","refresh_token":"fixture-refresh","user":{"id":"fixture-owner"}}"""
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code).message("fixture").body(text.toResponseBody("application/json".toMediaType())).build()
        }.build()
        return SupabaseAuthRepository(client,"https://fixture.invalid","public-fixture",cloudinaryApi="https://cloudinary.fixture.invalid")
            .also {runBlocking {it.signIn("p@example.test","fixture-password")}}
    }

    @Test fun signedUploadGoesToCloudinaryAndIsVerifiedByTheServer()=runBlocking {
        val repo=repository();requests.clear()
        val jpeg=ByteArray(64) {it.toByte()}
        assertEquals(delivered,repo.uploadProfilePhoto(jpeg))
        val (upload,form)=requests.single {it.first.url.host=="cloudinary.fixture.invalid"}
        assertEquals("/v1_1/demo/image/upload",upload.url.encodedPath)
        assertNull("Cloudinary must not receive the Supabase session",upload.header("Authorization"))
        listOf("name=\"file\"","name=\"api_key\"","123456789012345","name=\"timestamp\"","1730700000","name=\"public_id\"",pid,"name=\"signature\"","request-signature").forEach {
            assertTrue(it,form.contains(it))
        }
        assertFalse(form.contains("secret"))
        val finalize=JSONObject(requests.single {it.first.url.encodedPath.endsWith("set_my_profile_photo")}.second)
        assertEquals(pid,finalize.getString("p_public_id"));assertEquals(17,finalize.getLong("p_version"));assertEquals("response-signature",finalize.getString("p_signature"))
        assertEquals(listOf("profile_photo_upload","image/upload","set_my_profile_photo"),
            requests.map {it.first.url.encodedPath.substringAfterLast("rpc/").removePrefix("/v1_1/demo/")})
    }
    @Test fun unconfiguredBackendStopsBeforeContactingCloudinary()=runBlocking {
        ticketStatus=503
        val repo=repository();requests.clear()
        val failure=runCatching {repo.uploadProfilePhoto(ByteArray(8))}.exceptionOrNull()
        assertEquals(503,(failure as RemoteFailure).status)
        assertTrue(requests.none {it.first.url.host=="cloudinary.fixture.invalid"})
    }
    @Test fun aMismatchedCloudinaryResponseIsNeverSaved()=runBlocking {
        uploadedId=pid.dropLast(1)+"c"
        val repo=repository();requests.clear()
        assertTrue(runCatching {repo.uploadProfilePhoto(ByteArray(8))}.isFailure)
        assertTrue(requests.none {it.first.url.encodedPath.endsWith("set_my_profile_photo")})
    }
    @Test fun emptyOrOversizedPhotosAreRejectedLocally()=runBlocking {
        val repo=repository();requests.clear()
        assertTrue(runCatching {repo.uploadProfilePhoto(ByteArray(0))}.isFailure)
        assertTrue(runCatching {repo.uploadProfilePhoto(ByteArray(com.motivance.domain.MAX_PHOTO_BYTES+1))}.isFailure)
        assertTrue(requests.isEmpty())
    }
    @Test fun loadedProfileIncludesTheAccountPhoto()=runBlocking {
        assertEquals(delivered,repository().loadProfile().photoUrl)
    }
}
