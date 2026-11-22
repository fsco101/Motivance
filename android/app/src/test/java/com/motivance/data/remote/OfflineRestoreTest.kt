package com.motivance.data.remote

import com.motivance.data.local.SessionSecrets
import com.motivance.domain.RemoteFailure
import com.motivance.domain.UserRole
import kotlinx.coroutines.runBlocking
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

/** A cold start without a connection keeps the stored account, whatever the access token's age (#160). */
class OfflineRestoreTest {
    private class MemoryVault(var value:String?):SessionSecrets {
        override fun read()=value
        override fun write(value:String) {this.value=value}
        override fun clear() {value=null}
    }
    private val backend="https://fixture.invalid"
    private var offline=true
    private var refreshStatus=200
    private val requests=mutableListOf<Request>()
    private val client=OkHttpClient.Builder().addInterceptor { chain ->
        val request=chain.request(); requests.add(request)
        if(offline) throw IOException("No connection")
        val path=request.url.encodedPath
        val refreshing=request.url.query?.contains("refresh_token")==true
        val expired=path=="/rest/v1/profiles" && request.header("Authorization")=="Bearer expired-access"
        val code=when {refreshing -> refreshStatus; expired -> 401; else -> 200}
        val body=when {
            refreshing -> """{"access_token":"fresh-access","refresh_token":"fresh-refresh","expires_in":3600,"user":{"id":"patient"}}"""
            path.contains("user_roles") -> """[{"role":"patient"}]"""
            path=="/rest/v1/profiles" -> """[{"display_name":"Fixture patient"}]"""
            else -> "[]"
        }
        Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code).message("Fixture")
            .body(body.toResponseBody("application/json".toMediaType())).build()
    }.build()
    private fun stored(backend:String=this.backend,refresh:String?="stored-refresh")=JSONObject().put("backend",backend).put("id","patient")
        .put("access_token","expired-access").put("expires_at",System.currentTimeMillis()/1000-7200)
        .put("roles",JSONArray(listOf("PATIENT"))).apply {if(refresh!=null) put("refresh_token",refresh)}.toString()
    private fun repository(vault:MemoryVault)=SupabaseAuthRepository(client,backend,"public-fixture-key",false,null,vault)

    @Test fun offlineRestoreWithExpiredAccessTokenKeepsTheStoredAccount()=runBlocking {
        val vault=MemoryVault(stored())
        val session=repository(vault).restoreSession()
        assertEquals("patient",session?.userId)
        assertEquals(setOf(UserRole.PATIENT),session?.roles)
        assertNotNull("nothing is cleared while offline",vault.value)
    }
    @Test fun offlineServerCallsFailThenRenewTheTokenOnceWhenTheConnectionReturns()=runBlocking {
        val vault=MemoryVault(stored()); val repository=repository(vault)
        assertNotNull(repository.restoreSession())
        assertTrue(runCatching {repository.loadOverview()}.exceptionOrNull() is IOException)
        offline=false; requests.clear()
        repository.loadOverview()
        assertEquals(1,requests.count {it.url.query?.contains("refresh_token")==true})
        assertTrue(vault.value!!.contains("fresh-refresh"))
    }
    @Test fun refusedRefreshSignsOut()=runBlocking {
        for(status in listOf(400,401)) {
            offline=false; refreshStatus=status
            val vault=MemoryVault(stored()); val repository=repository(vault)
            val failure=runCatching {repository.restoreSession()}.exceptionOrNull()
            assertEquals(status,(failure as RemoteFailure).status)
            assertNull(vault.value)
            offline=true
            assertNull("signed out stays signed out offline",repository.restoreSession())
        }
    }
    @Test fun vaultForAnotherBackendRestoresNothing()=runBlocking {
        val vault=MemoryVault(stored(backend="https://other.invalid"))
        assertNull(repository(vault).restoreSession())
        assertNull(vault.value)
    }
    @Test fun vaultWithoutRefreshTokenRestoresNothing()=runBlocking {
        assertNull(repository(MemoryVault(stored(refresh=null))).restoreSession())
    }
}
