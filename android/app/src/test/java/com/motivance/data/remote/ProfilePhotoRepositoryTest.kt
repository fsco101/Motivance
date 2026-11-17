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
    private val path="0f8fad5b-d9cb-469f-a165-70867728950e/"+"b".repeat(32)+".webp"
    private val requests=mutableListOf<Pair<Request,ByteArray>>()
    private var ticketStatus=200
    private var issuedPath=path
    private var issuedBucket="avatars"
    private var storageStatus=200

    private fun repository():SupabaseAuthRepository {
        val client=OkHttpClient.Builder().addInterceptor {chain ->
            val request=chain.request()
            val body=request.body?.let {val b=okio.Buffer();it.writeTo(b);b.readByteArray()} ?: ByteArray(0)
            requests+=request to body
            val (code,text)=when(request.url.encodedPath) {
                "/rest/v1/user_roles" -> 200 to """[{"role":"patient"}]"""
                "/rest/v1/rpc/start_profile_photo" -> ticketStatus to """{"bucket":"$issuedBucket","path":"$issuedPath","limit":102400}"""
                "/storage/v1/object/avatars/$issuedPath" -> storageStatus to """{"Key":"avatars/$issuedPath"}"""
                "/rest/v1/rpc/set_my_profile_photo" -> 200 to "\"$path\""
                "/auth/v1/user" -> 200 to """{"email":"p@example.test"}"""
                "/rest/v1/patient_profiles" -> 200 to "[]"
                "/rest/v1/profiles" -> 200 to """[{"photo_url":"$path"}]"""
                else -> 200 to """{"access_token":"fixture-access","refresh_token":"fixture-refresh","user":{"id":"fixture-owner"}}"""
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code).message("fixture").body(text.toResponseBody("application/json".toMediaType())).build()
        }.build()
        return SupabaseAuthRepository(client,"https://fixture.invalid","public-fixture")
            .also {runBlocking {it.signIn("p@example.test","fixture-password")}}
    }

    @Test fun thePhotoIsStoredWhereTheServerSaidAndThenCheckedByTheServer()=runBlocking {
        val repo=repository();requests.clear()
        val webp=ByteArray(64) {it.toByte()}
        assertEquals(path,repo.uploadProfilePhoto(webp))
        assertEquals(listOf("/rest/v1/rpc/start_profile_photo","/storage/v1/object/avatars/$path","/rest/v1/rpc/set_my_profile_photo"),
            requests.map {it.first.url.encodedPath})
        assertEquals("image/webp",JSONObject(String(requests[0].second)).getString("p_mime"))
        val (upload,bytes)=requests[1]
        assertEquals("Bearer fixture-access",upload.header("Authorization"))
        assertEquals("false",upload.header("x-upsert"))
        assertEquals("image/webp",upload.body?.contentType()?.toString())
        assertArrayEquals(webp,bytes)
        assertEquals(path,JSONObject(String(requests[2].second)).getString("p_path"))
    }
    @Test fun theHourlyLimitStopsBeforeAnythingIsStored()=runBlocking {
        ticketStatus=429
        val repo=repository();requests.clear()
        val failure=runCatching {repo.uploadProfilePhoto(ByteArray(8))}.exceptionOrNull()
        assertEquals(429,(failure as RemoteFailure).status)
        assertTrue(requests.none {it.first.url.encodedPath.startsWith("/storage/")})
    }
    @Test fun anUnexpectedPlaceIsNeverUsed()=runBlocking {
        for((bucket,place) in listOf("chat-media" to path,"avatars" to "../$path","avatars" to path.replace(".webp",".jpg"))) {
            issuedBucket=bucket;issuedPath=place
            val repo=repository();requests.clear()
            assertTrue(runCatching {repo.uploadProfilePhoto(ByteArray(8))}.isFailure)
            assertTrue(requests.none {it.first.url.encodedPath.startsWith("/storage/") || it.first.url.encodedPath.endsWith("set_my_profile_photo")})
        }
    }
    @Test fun aRefusedFileIsNeverSaved()=runBlocking {
        storageStatus=413
        val repo=repository();requests.clear()
        assertEquals(413,(runCatching {repo.uploadProfilePhoto(ByteArray(8))}.exceptionOrNull() as RemoteFailure).status)
        assertTrue(requests.none {it.first.url.encodedPath.endsWith("set_my_profile_photo")})
    }
    @Test fun emptyOrOversizedPhotosAreRejectedLocally()=runBlocking {
        val repo=repository();requests.clear()
        assertTrue(runCatching {repo.uploadProfilePhoto(ByteArray(0))}.isFailure)
        assertTrue(runCatching {repo.uploadProfilePhoto(ByteArray(com.motivance.domain.MAX_PHOTO_BYTES+1))}.isFailure)
        assertTrue(requests.isEmpty())
    }
    @Test fun loadedProfileIncludesTheAccountPhoto()=runBlocking {
        assertEquals(path,repository().loadProfile().photoUrl)
    }
}
