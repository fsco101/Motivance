package com.motivance.data.remote

import com.motivance.BuildConfig
import com.motivance.domain.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONArray
import org.json.JSONObject
import javax.inject.Inject
import javax.inject.Singleton
import com.motivance.data.local.SessionStore

/** GoTrue REST adapter. Tokens deliberately remain in memory in the S1 prototype. */
@Singleton class SupabaseAuthRepository internal constructor(
    private val http: OkHttpClient,
    private val baseUrl: String,
    private val publicKey: String,
    private val allowLocalDevelopment: Boolean = BuildConfig.DEBUG,
    private val cache:SessionStore?=null
) : AuthRepository {
    @Inject constructor(store:SessionStore) : this(OkHttpClient(), BuildConfig.SUPABASE_URL, BuildConfig.SUPABASE_PUBLISHABLE_KEY,BuildConfig.DEBUG,store)
    private val mutex = Mutex()
    private var access: String? = null
    private var refreshToken: String? = null
    private var userId: String? = null
    private suspend fun call(path: String, body: JSONObject?, bearer: String? = null, method: String = "POST"): String = withContext(Dispatchers.IO) {
        val url = baseUrl.toHttpUrlOrNull()
        val localDebug = allowLocalDevelopment && url?.scheme == "http" && url.host in setOf("localhost", "127.0.0.1", "10.0.2.2") && url.port == 54321
        check(url != null && (url.scheme == "https" || localDebug) && url.encodedUsername.isEmpty() && url.encodedPassword.isEmpty() && publicKey.isNotBlank()) { "Configure an HTTPS Supabase endpoint, or the debug-only local endpoint on port 54321." }
        val builder = Request.Builder().url(baseUrl.trimEnd('/') + path).header("apikey", publicKey)
        if (bearer != null) builder.header("Authorization", "Bearer $bearer")
        if (method == "GET") builder.get() else builder.method(method, (body ?: JSONObject()).toString().toRequestBody("application/json".toMediaType()))
        http.newCall(builder.build()).execute().use { response ->
            check(response.isSuccessful) { "Authentication request failed (${response.code}). Check your details or connection and try again." }
            response.body?.string().orEmpty()
        }
    }
    private suspend fun accept(raw: String): UserSession {
        val value = JSONObject(raw)
        val token = value.getString("access_token")
        val id = value.getJSONObject("user").getString("id")
        val roles = JSONArray(call("/rest/v1/user_roles?select=role&user_id=eq.$id", null, token, "GET"))
        val mapped = (0 until roles.length()).map { UserRole.valueOf(roles.getJSONObject(it).getString("role").uppercase()) }.toSet()
        access = token; refreshToken = value.getString("refresh_token"); userId = id
        return UserSession(id, mapped)
    }
    override suspend fun signIn(email: String, password: String) = mutex.withLock { accept(call("/auth/v1/token?grant_type=password", JSONObject().put("email",email).put("password",password))) }
    override suspend fun register(email: String, password: String) { call("/auth/v1/signup", JSONObject().put("email",email).put("password",password)) }
    override suspend fun confirmRegistration(email: String, token: String) = mutex.withLock {
        accept(call("/auth/v1/verify", JSONObject().put("email",email).put("token",token).put("type","signup")))
    }
    override suspend fun requestRecovery(email: String) { call("/auth/v1/recover", JSONObject().put("email",email)) }
    override suspend fun recover(email: String, token: String, newPassword: String) = mutex.withLock {
        val raw = call("/auth/v1/verify", JSONObject().put("email",email).put("token",token).put("type","recovery"))
        val recoveryToken = JSONObject(raw).getString("access_token")
        call("/auth/v1/user", JSONObject().put("password",newPassword), recoveryToken, "PUT")
        accept(raw)
    }
    override suspend fun refresh() = mutex.withLock {
        try { accept(call("/auth/v1/token?grant_type=refresh_token", JSONObject().put("refresh_token", checkNotNull(refreshToken)))) }
        catch (e: Exception) { access=null; refreshToken=null; userId=null; throw e }
    }
    override suspend fun signOut() = mutex.withLock {
        val old=access
        val account=userId
        access=null; refreshToken=null; userId=null
        try { if(account!=null) cache?.clearCacheOnLogout(account) }
        finally { if (old != null) call("/auth/v1/logout",JSONObject(),old) }
        Unit
    }
    override suspend fun loadOverview() = mutex.withLock {
        val token=checkNotNull(access)
        val id=checkNotNull(userId)
        val profiles=JSONArray(call("/rest/v1/profiles?select=display_name&id=eq.$id",null,token,"GET"))
        val patients=JSONArray(call("/rest/v1/patients?select=id",null,token,"GET"))
        val sessions=JSONArray(call("/rest/v1/sessions?select=id,patient_id,started_at,status&order=started_at.desc&limit=20",null,token,"GET"))
        val assignments=JSONArray(call("/rest/v1/exercise_assignments?select=id,patient_id&active=eq.true",null,token,"GET"))
        if(cache!=null) {
            val details=JSONArray(call("/rest/v1/exercise_assignments?select=id,patient_id,prescription_versions(id,version,side,minimum_degrees,maximum_degrees,target_repetitions,exercise_versions(id,algorithm_key,definition))&active=eq.true&patient_id=eq.$id",null,token,"GET"))
            cache.replaceCache(id,PrescriptionCache.decode(id,details,System.currentTimeMillis()))
        }
        WorkspaceOverview(
            displayName=if(profiles.length()>0) profiles.getJSONObject(0).optString("display_name") else "",
            patientIds=(0 until patients.length()).map { patients.getJSONObject(it).getString("id") }.filter { it!=id },
            sessions=(0 until sessions.length()).map { val s=sessions.getJSONObject(it); SessionSummary(s.getString("id"),s.getString("patient_id"),s.getString("started_at"),s.getString("status")) },
            assignments=(0 until assignments.length()).map { val a=assignments.getJSONObject(it); AssignmentSummary(a.getString("id"),a.getString("patient_id")) }
        )
    }
}
