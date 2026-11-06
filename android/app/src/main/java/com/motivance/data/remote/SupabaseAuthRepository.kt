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
import com.motivance.data.local.SessionVault
import java.io.IOException
import java.time.Instant
import java.time.OffsetDateTime

/** Authenticated GoTrue/PostgREST adapter with protected session persistence. */
@Singleton class SupabaseAuthRepository internal constructor(
    private val http: OkHttpClient,
    private val baseUrl: String,
    private val publicKey: String,
    private val allowLocalDevelopment: Boolean = BuildConfig.DEBUG,
    private val cache:SessionStore?=null,
    private val vault:SessionVault?=null,
    private val cloudinaryApi:String=CLOUDINARY_API,
) : AuthRepository, RehabilitationRepository, AdministrationRepository, BookingRepository, NotificationRepository {
    @Inject constructor(store:SessionStore,vault:SessionVault) : this(OkHttpClient(), BuildConfig.SUPABASE_URL, BuildConfig.SUPABASE_PUBLISHABLE_KEY,BuildConfig.DEBUG,store,vault)
    private val mutex = Mutex()
    private var access: String? = null
    private var refreshToken: String? = null
    private var userId: String? = null
    private var cachedRoles:Set<UserRole> = emptySet()
    private var expiresAt=0L
    private fun clearSession() {access=null; refreshToken=null; userId=null; cachedRoles=emptySet(); vault?.clear()}
    private fun loadStored() {
        if(access!=null) return
        val stored=vault?.read() ?: return
        try {
            val j=JSONObject(stored); require(j.getString("backend")==baseUrl); access=j.getString("access_token"); refreshToken=j.getString("refresh_token"); userId=j.getString("id"); expiresAt=j.getLong("expires_at")
            cachedRoles=j.getJSONArray("roles").let { a -> (0 until a.length()).mapNotNull {UserRole.of(a.getString(it))}.toSet() }
        } catch(_:Exception) {clearSession()}
    }
    private suspend fun <T> authorized(owner:String?=null,action:suspend (String,String)->T):T=mutex.withLock {
        loadStored()
        val id=userId ?: throw RemoteFailure(401)
        if(owner!=null && id!=owner) throw RemoteFailure(401)
        val token=access ?: throw RemoteFailure(401)
        try {action(token,id)} catch(e:RemoteFailure) {
            if(e.status!=401) throw e
            try {accept(call("/auth/v1/token?grant_type=refresh_token",JSONObject().put("refresh_token",refreshToken)))}
            catch(refreshError:RemoteFailure) {if(refreshError.status in setOf(400,401)) clearSession(); throw RemoteFailure(if(refreshError.status==400) 401 else refreshError.status)}
            action(checkNotNull(access),id)
        }
    }
    private suspend fun call(path: String, body: JSONObject?, bearer: String? = null, method: String = "POST"): String = withContext(Dispatchers.IO) {
        val url = baseUrl.toHttpUrlOrNull()
        val localDebug = allowLocalDevelopment && url?.scheme == "http" && url.host in setOf("localhost", "127.0.0.1", "10.0.2.2") && url.port == 54321
        check(url != null && (url.scheme == "https" || localDebug) && url.encodedUsername.isEmpty() && url.encodedPassword.isEmpty() && publicKey.isNotBlank()) { "Configure an HTTPS Supabase endpoint, or the debug-only local endpoint on port 54321." }
        val builder = Request.Builder().url(baseUrl.trimEnd('/') + path).header("apikey", publicKey)
        if (bearer != null) builder.header("Authorization", "Bearer $bearer")
        if (method == "GET") builder.get() else builder.method(method, (body ?: JSONObject()).toString().toRequestBody("application/json".toMediaType()))
        http.newCall(builder.build()).execute().use { response ->
            if(!response.isSuccessful) {
                val failure=runCatching {JSONObject(response.body?.string().orEmpty())}.getOrNull()
                // Only known codes pass: other server messages can name tables and columns.
                val code=failure?.optString("code")?.takeIf {it in setOf("email_not_confirmed","otp_expired","over_email_send_rate_limit","weak_password","same_password")}
                    ?: failure?.optString("message")?.takeIf {it.startsWith("booking_")}
                throw RemoteFailure(response.code,code)
            }
            response.body?.string().orEmpty()
        }
    }
    private suspend fun accept(raw: String): UserSession {
        val value = JSONObject(raw)
        val token = value.getString("access_token")
        val id = value.getJSONObject("user").getString("id")
        val roles = JSONArray(call("/rest/v1/user_roles?select=role&user_id=eq.$id", null, token, "GET"))
        val mapped = (0 until roles.length()).mapNotNull { UserRole.of(roles.getJSONObject(it).getString("role")) }.toSet()
        access = token; refreshToken = value.getString("refresh_token"); userId = id
        cachedRoles=mapped; expiresAt=value.optLong("expires_at",System.currentTimeMillis()/1000+value.optLong("expires_in",3600))
        vault?.write(JSONObject().put("backend",baseUrl).put("id",id).put("access_token",token).put("refresh_token",refreshToken).put("expires_at",expiresAt).put("roles",JSONArray(mapped.map {it.name})).toString())
        return UserSession(id, mapped)
    }
    override suspend fun restoreSession():UserSession?=mutex.withLock {
        loadStored(); val id=userId ?: return@withLock null
        try {accept(call("/auth/v1/token?grant_type=refresh_token",JSONObject().put("refresh_token",refreshToken)))}
        catch(e:IOException) {if(expiresAt>System.currentTimeMillis()/1000) UserSession(id,cachedRoles) else null}
        catch(e:RemoteFailure) {if(e.status in setOf(400,401)) clearSession(); throw e}
    }
    override suspend fun signIn(email: String, password: String) = mutex.withLock { accept(call("/auth/v1/token?grant_type=password", JSONObject().put("email",email).put("password",password))) }
    override suspend fun register(email: String, password: String) { call("/auth/v1/signup", JSONObject().put("email",email).put("password",password)) }
    private fun profileJson(p:PatientProfile)=JSONObject().put("username",p.username.trim()).put("first_name",p.firstName.trim()).put("last_name",p.lastName.trim())
        .put("gender",p.gender).put("birthdate",p.birthdate).put("address",p.address.trim()).put("contact",p.contact.trim()).put("consent",p.consent)
    private fun readProfile(j:JSONObject,email:String="")=PatientProfile(j.optString("username"),j.optString("full_name"),j.optString("gender"),j.optString("birthdate"),j.optString("address"),j.optString("contact"),null,j.optString("consented_at").isNotBlank(),email,if(j.isNull("first_name")) j.optString("full_name") else j.optString("first_name"),if(j.isNull("last_name")) "" else j.optString("last_name"))
    override suspend fun registerProfile(email:String,password:String,profile:PatientProfile) {
        require(profile.valid())
        call("/auth/v1/signup",JSONObject().put("email",email).put("password",password).put("data",JSONObject().put("patient_profile",profileJson(profile))))
    }
    override suspend fun loadProfile()=authorized {token,id ->
        val user=JSONObject(call("/auth/v1/user",null,token,"GET"))
        val rows=JSONArray(call("/rest/v1/patient_profiles?select=*&user_id=eq.$id",null,token,"GET"))
        val account=JSONArray(call("/rest/v1/profiles?select=photo_url&id=eq.$id",null,token,"GET"))
        val photo=if(account.length()>0) account.getJSONObject(0).text("photo_url") else null
        (if(rows.length()>0) readProfile(rows.getJSONObject(0),user.getString("email")) else PatientProfile(email=user.getString("email"))).copy(photoUrl=photo)
    }
    override suspend fun saveProfile(profile:PatientProfile) {require(profile.valid());authorized {token,_ -> call("/rest/v1/rpc/save_my_profile",JSONObject().put("p_details",profileJson(profile)),token)} }
    override suspend fun uploadProfilePhoto(jpeg:ByteArray):String {
        require(jpeg.isNotEmpty() && jpeg.size<=MAX_PHOTO_BYTES)
        // 1. The database issues a signature bound to a server-chosen public ID; the API secret never leaves Vault.
        val ticket=authorized {token,_ -> JSONObject(call("/rest/v1/rpc/profile_photo_upload",JSONObject(),token))}
        val cloud=ticket.getString("cloud_name");val publicId=ticket.getString("public_id")
        check(cloud.matches(Regex("[A-Za-z0-9_-]{1,64}")) && publicId.matches(Regex("motivance/avatars/[0-9a-f-]{36}/[0-9a-f]{32}")))
        // 2. Upload straight to Cloudinary, outside the session lock so other requests are not blocked.
        val form=MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("file","profile.jpg",jpeg.toRequestBody("image/jpeg".toMediaType()))
            .addFormDataPart("api_key",ticket.getString("api_key")).addFormDataPart("timestamp",ticket.getLong("timestamp").toString())
            .addFormDataPart("public_id",publicId).addFormDataPart("signature",ticket.getString("signature")).build()
        val uploaded=withContext(Dispatchers.IO) {
            http.newCall(Request.Builder().url("${cloudinaryApi.trimEnd('/')}/v1_1/$cloud/image/upload").post(form).build()).execute().use {response ->
                if(!response.isSuccessful) throw RemoteFailure(response.code,"photo_upload")
                JSONObject(response.body?.string().orEmpty())
            }
        }
        check(uploaded.getString("public_id")==publicId)
        // 3. The database verifies Cloudinary's response signature before saving the photo.
        return authorized {token,_ ->
            val raw=call("/rest/v1/rpc/set_my_profile_photo",JSONObject().put("p_public_id",publicId).put("p_version",uploaded.getLong("version"))
                .put("p_signature",uploaded.getString("signature")),token)
            JSONArray("[$raw]").getString(0)
        }
    }
    override suspend fun removeProfilePhoto() {authorized {token,_ -> call("/rest/v1/rpc/clear_my_profile_photo",JSONObject(),token)}}
    override suspend fun changePassword(currentPassword:String,newPassword:String) {require(newPassword.length>=8 && currentPassword!=newPassword);authorized {token,id ->
        val email=JSONObject(call("/auth/v1/user",null,token,"GET")).getString("email")
        val verified=call("/auth/v1/token?grant_type=password",JSONObject().put("email",email).put("password",currentPassword))
        require(JSONObject(verified).getJSONObject("user").getString("id")==id)
        call("/auth/v1/user",JSONObject().put("password",newPassword),JSONObject(verified).getString("access_token"),"PUT")
        accept(verified)
        Unit
    } }
    override suspend fun confirmRegistration(email: String, token: String) = mutex.withLock {
        accept(call("/auth/v1/verify", JSONObject().put("email",email).put("token",token.trim()).put("type","signup")))
    }
    override suspend fun resendConfirmation(email:String) {call("/auth/v1/resend",JSONObject().put("type","signup").put("email",email))}
    override suspend fun requestRecovery(email: String) { call("/auth/v1/recover", JSONObject().put("email",email)) }
    override suspend fun recover(email: String, token: String, newPassword: String) = mutex.withLock {
        val raw = call("/auth/v1/verify", JSONObject().put("email",email).put("token",token.trim()).put("type","recovery"))
        val recoveryToken = JSONObject(raw).getString("access_token")
        call("/auth/v1/user", JSONObject().put("password",newPassword), recoveryToken, "PUT")
        accept(raw)
    }
    override suspend fun refresh() = mutex.withLock {
        try { accept(call("/auth/v1/token?grant_type=refresh_token", JSONObject().put("refresh_token", checkNotNull(refreshToken)))) }
        catch (e: RemoteFailure) { if(e.status in setOf(400,401)) clearSession(); throw e }
    }
    override suspend fun signOut() = mutex.withLock {
        val old=access
        val account=userId
        clearSession()
        try { if(account!=null) cache?.clearCacheOnLogout(account) }
        finally { if (old != null) call("/auth/v1/logout",JSONObject(),old) }
        Unit
    }
    override suspend fun loadOverview() = authorized { token,id ->
        val profiles=JSONArray(call("/rest/v1/profiles?select=display_name&id=eq.$id",null,token,"GET"))
        val patients=JSONArray(call("/rest/v1/patients?select=id",null,token,"GET"))
        val sessions=JSONArray(call("/rest/v1/sessions?select=id,patient_id,started_at,status&order=started_at.desc&limit=20",null,token,"GET"))
        val assignments=JSONArray(call("/rest/v1/exercise_assignments?select=id,patient_id&active=eq.true",null,token,"GET"))
        WorkspaceOverview(
            displayName=if(profiles.length()>0) profiles.getJSONObject(0).optString("display_name") else "",
            patientIds=(0 until patients.length()).map { patients.getJSONObject(it).getString("id") }.filter { it!=id },
            sessions=(0 until sessions.length()).map { val s=sessions.getJSONObject(it); SessionSummary(s.getString("id"),s.getString("patient_id"),s.getString("started_at"),s.getString("status")) },
            assignments=(0 until assignments.length()).map { val a=assignments.getJSONObject(it); AssignmentSummary(a.getString("id"),a.getString("patient_id")) }
        )
    }
    override suspend fun loadWorkspace()=authorized { token,id ->
        // The patient's exercise list reads this cache, so it is downloaded first: nothing below can hold it back.
        if(cache!=null) {
            val details=JSONArray(call("/rest/v1/exercise_assignments?select=id,patient_id,prescription_versions(id,version,parameters,side,minimum_degrees,maximum_degrees,target_repetitions,exercise_versions(id,algorithm_key,definition))&active=eq.true&patient_id=eq.$id",null,token,"GET"))
            cache.replaceCache(id,PrescriptionCache.decode(id,details,System.currentTimeMillis()))
            val consent=JSONArray(call("/rest/v1/consents?select=client_event_id,event,occurred_at&patient_id=eq.$id&consent_type=eq.movement-summary&client_event_id=not.is.null&order=occurred_at.desc&limit=1",null,token,"GET"))
            if(consent.length()>0) cache.reconcileConsent(id,consent.getJSONObject(0).let {ServerConsent(it.getString("client_event_id"),it.getString("event"),OffsetDateTime.parse(it.getString("occurred_at")).toInstant().toEpochMilli())})
        }
        val patients=JSONArray(call("/rest/v1/patients?select=id,profiles:profiles!patients_id_fkey(display_name,photo_url)",null,token,"GET"))
        val details=JSONArray(call("/rest/v1/patient_profiles?select=*",null,token,"GET"))
        val profileById=(0 until details.length()).map {details.getJSONObject(it)}.associate {it.getString("user_id") to readProfile(it)}
        val catalogue=JSONArray(call("/rest/v1/exercise_versions?select=${CatalogueJson.SELECT}&published=eq.true",null,token,"GET"))
        val assignments=JSONArray(call("/rest/v1/exercise_assignments?select=id,patient_id,prescription_versions(id,version,exercise_version_id,side,minimum_degrees,maximum_degrees,target_repetitions,parameters)&active=eq.true",null,token,"GET"))
        val requests=JSONArray(call("/rest/v1/data_requests?select=id,kind,status&order=created_at.desc",null,token,"GET"))
        fun <T> rows(a:JSONArray,convert:(JSONObject)->T)=(0 until a.length()).map {convert(a.getJSONObject(it))}
        RehabWorkspace(
            rows(patients) {val account=it.optJSONObject("profiles");val photo=account?.text("photo_url")
                LinkedPatient(it.getString("id"),account?.optString("display_name").orEmpty(),profileById[it.getString("id")]?.copy(photoUrl=photo),photo)},
            CatalogueJson.decode(catalogue,id),
            rows(assignments) {a -> val v=a.getJSONArray("prescription_versions"); if(v.length()==0) null else {
                val p=(0 until v.length()).map {v.getJSONObject(it)}.maxBy {it.getInt("version")}
                PrescriptionSummary(a.getString("id"),p.getString("id"),a.getString("patient_id"),p.getString("exercise_version_id"),p.getInt("version"),p.getString("side"),p.getDouble("minimum_degrees"),p.getDouble("maximum_degrees"),p.getInt("target_repetitions"),p.optJSONObject("parameters")?.toString() ?: "{}")
            }}.filterNotNull(),
            rows(requests) {PrivacyRequest(it.getString("id"),it.getString("kind"),it.getString("status"))})
    }
    override suspend fun loadAdministration(after:String?,search:String?)=authorized {token,_ ->
        val query=search?.trim()?.takeIf {it.isNotEmpty()}
        val accounts=JSONArray(call("/rest/v1/rpc/admin_accounts",JSONObject().put("p_after",after ?: JSONObject.NULL).put("p_search",query ?: JSONObject.NULL),token))
        val links=JSONArray(call("/rest/v1/rpc/admin_links",JSONObject(),token))
        val exercises=JSONArray(call("/rest/v1/exercises?select=id,code,active,exercise_versions(version,algorithm_key,definition)&order=code&limit=500",null,token,"GET"))
        val summary=JSONObject(call("/rest/v1/rpc/admin_summary",JSONObject(),token))
        val activity=auditPage(JSONArray(call("/rest/v1/rpc/admin_activity",JSONObject(),token)))
        val rows=(0 until minOf(accounts.length(),ADMIN_PAGE)).map {val a=accounts.getJSONObject(it);val r=a.getJSONArray("roles")
            AdminAccount(a.getString("id"),a.optString("display_name"),a.getBoolean("active"),(0 until r.length()).map {r.getString(it)}.toSet(),
                a.text("email").orEmpty(),a.text("username"),a.text("created_at"),a.text("last_sign_in_at"),a.text("photo_url"))}
        AdminWorkspace(rows,(0 until links.length()).map {val l=links.getJSONObject(it)
                AdminLink(l.getString("therapist_id"),l.getString("patient_id"),l.getBoolean("active"),l.text("therapist_name").orEmpty(),l.text("patient_name").orEmpty())},
            (0 until exercises.length()).map {val e=exercises.getJSONObject(it);val v=e.getJSONArray("exercise_versions");val latest=(0 until v.length()).map {v.getJSONObject(it)}.maxByOrNull {it.getInt("version")};val d=latest?.getJSONObject("definition")
                AdminExercise(e.getString("id"),e.getString("code"),e.getBoolean("active"),latest?.getInt("version") ?: 0,d?.optString("name").orEmpty(),d?.optString("instructions_en").orEmpty(),d?.optString("instructions_fil").orEmpty(),latest?.text("algorithm_key").orEmpty())},
            if(accounts.length()>ADMIN_PAGE) rows.last().id else null,
            AdminSummary(summary.optInt("accounts"),summary.optInt("disabled"),summary.optInt("patients"),summary.optInt("therapists"),summary.optInt("admins"),
                summary.optInt("active_links"),summary.optInt("unlinked_patients"),summary.optInt("exercises"),summary.optInt("active_exercises"),
                summary.optInt("sessions_week"),summary.optInt("pending_requests"),summary.optInt("schedulers")),
            activity.events,activity.next)
    }
    override suspend fun clearPhoto(user:String) {authorized {t,_ -> call("/rest/v1/rpc/admin_clear_photo",JSONObject().put("p_user",user),t)}}
    override suspend fun loadActivity(before:Long)=authorized {token,_ -> auditPage(JSONArray(call("/rest/v1/rpc/admin_activity",JSONObject().put("p_before",before),token)))}
    private fun auditPage(rows:JSONArray):AuditPage {
        val events=(0 until minOf(rows.length(),ACTIVITY_PAGE)).map {val e=rows.getJSONObject(it)
            AuditEvent(e.getLong("id"),e.getString("action"),e.getString("target_type"),e.getString("target_id"),e.getString("recorded_at"),
                e.text("actor_id"),e.text("actor_name").orEmpty(),e.text("target_name").orEmpty(),e.text("related_name").orEmpty())}
        return AuditPage(events,if(rows.length()>ACTIVITY_PAGE) events.last().id else null)
    }
    override suspend fun setAccount(user:String,active:Boolean) {authorized {t,_ -> call("/rest/v1/rpc/admin_set_account",JSONObject().put("p_user",user).put("p_active",active),t)}}
    override suspend fun setRole(user:String,role:String,granted:Boolean) {authorized {t,_ -> call("/rest/v1/rpc/admin_set_role",JSONObject().put("p_user",user).put("p_role",role).put("p_granted",granted),t)}}
    override suspend fun setLink(therapist:String,patient:String,active:Boolean) {authorized {t,_ -> call("/rest/v1/rpc/admin_set_link",JSONObject().put("p_therapist",therapist).put("p_patient",patient).put("p_active",active),t)}}
    override suspend fun setExercise(exercise:String,active:Boolean) {authorized {t,_ -> call("/rest/v1/rpc/admin_set_exercise",JSONObject().put("p_exercise",exercise).put("p_active",active),t)}}
    override suspend fun publishExercise(exercise:String,name:String,english:String,filipino:String) {authorized {t,_ -> call("/rest/v1/rpc/admin_publish_exercise",JSONObject().put("p_exercise",exercise).put("p_name",name).put("p_english",english).put("p_filipino",filipino),t)}}
    override suspend fun loadAvailability(from:String,to:String)=authorized {token,_ -> BookingJson.availability(JSONObject(call("/rest/v1/rpc/booking_availability",JSONObject().put("p_from",from).put("p_to",to),token)))}
    override suspend fun requestBooking(requestId:String,startsAt:String)=authorized {token,_ -> BookingJson.booking(JSONObject(call("/rest/v1/rpc/request_booking",JSONObject().put("p_request",requestId).put("p_starts",startsAt),token)))}
    override suspend fun loadMyBookings()=authorized {token,_ -> BookingJson.bookings(JSONArray(call("/rest/v1/rpc/my_bookings",JSONObject(),token)))}
    override suspend fun cancelBooking(id:String) {authorized {token,_ -> call("/rest/v1/rpc/cancel_my_booking",JSONObject().put("p_booking",id),token)}}
    override suspend fun loadWaitlist()=authorized {token,_ -> BookingJson.waitlist(JSONArray(call("/rest/v1/rpc/my_waitlist",JSONObject(),token)))}
    override suspend fun joinWaitlist(startsAt:String) {authorized {token,_ -> call("/rest/v1/rpc/join_waitlist",JSONObject().put("p_starts",startsAt),token)}}
    override suspend fun leaveWaitlist(startsAt:String) {authorized {token,_ -> call("/rest/v1/rpc/leave_waitlist",JSONObject().put("p_starts",startsAt),token)}}
    override suspend fun loadNotifications()=authorized {token,_ -> BookingJson.inbox(JSONObject(call("/rest/v1/rpc/my_notifications",JSONObject(),token)))}
    override suspend fun markNotificationsRead(ids:List<String>?)=authorized {token,_ ->
        call("/rest/v1/rpc/mark_notifications_read",JSONObject().put("p_ids",ids?.let {JSONArray(it)} ?: JSONObject.NULL),token).trim().toInt()}
    override suspend fun saveLanguage(language:String) {authorized {token,_ -> call("/rest/v1/rpc/set_my_language",JSONObject().put("p_language",language),token)}}
    override suspend fun loadSchedule(from:String,to:String,therapist:Boolean)=authorized {token,_ ->
        BookingJson.schedule(JSONObject(call("/rest/v1/rpc/${if(therapist) "therapist_schedule" else "my_schedule"}",JSONObject().put("p_from",from).put("p_to",to),token)))}
    override suspend fun loadHistory(query:HistoryQuery,cursor:HistoryCursor?)=authorized { token,_ ->
        HistoryJson.decode(call(HistoryJson.path(query,cursor),null,token,"GET"))
    }
    override suspend fun invitePatient(email:String)=authorized { token,_ -> JSONObject(call("/rest/v1/rpc/invite_patient",JSONObject().put("p_email",email.trim()),token)).getString("code") }
    override suspend fun acceptInvitation(code:String) {authorized {token,_ -> call("/rest/v1/rpc/accept_patient_invitation",JSONObject().put("p_code",code.trim()),token)} }
    override suspend fun revokeLink(patientId:String) {authorized {token,_ -> call("/rest/v1/rpc/revoke_patient_link",JSONObject().put("p_patient",patientId),token)} }
    override suspend fun publishPrescription(draft:PrescriptionDraft) {authorized {token,_ ->
        val p=JSONObject().put("minimum_cycle_ms",draft.minimumCycleMs).put("maximum_cycle_ms",draft.maximumCycleMs).put("peak_hold_ms",draft.peakHoldMs).put("max_trunk_lean_degrees",draft.maxTrunkLean).put("confidence",draft.confidence).apply {draft.focusJoint?.let {put("focus_joint",it.name)}}
        val body=JSONObject().put("p_assignment",draft.assignmentId).put("p_version",draft.requestId).put("p_patient",draft.patientId).put("p_exercise",draft.exerciseId).put("p_side",draft.side.name.lowercase()).put("p_low",draft.low).put("p_high",draft.high).put("p_repetitions",draft.repetitions).put("p_parameters",p)
        call("/rest/v1/rpc/publish_prescription",body,token)
    }}
    override suspend fun createCustomExercise(draft:CustomExerciseDraft)=authorized {token,_ ->
        val body=JSONObject().put("p_id",draft.id).put("p_name",draft.name.trim()).put("p_joint",draft.joint.name).put("p_english",draft.english.trim())
            .put("p_filipino",draft.filipino.trim().ifBlank {null} ?: JSONObject.NULL)
        call("/rest/v1/rpc/create_custom_exercise",body,token).trim().trim('"')
    }
    override suspend fun archiveCustomExercise(exerciseId:String) {authorized {token,_ -> call("/rest/v1/rpc/archive_custom_exercise",JSONObject().put("p_exercise",exerciseId),token)} }
    override suspend fun requestPatientData(id:String,kind:String) {authorized {token,_ -> call("/rest/v1/rpc/request_patient_data",JSONObject().put("p_id",id).put("p_kind",kind),token)} }
    override suspend fun uploadConsent(owner:String,id:String,event:String,version:String,occurredAt:Long) {authorized(owner) {token,_ ->
        call("/rest/v1/rpc/record_consent",JSONObject().put("p_id",id).put("p_event",event).put("p_version",version).put("p_occurred_at",Instant.ofEpochMilli(occurredAt).toString()),token)
    }}
    override suspend fun uploadSession(owner:String,payload:String) {authorized(owner) {token,_ ->
        val result=JSONObject(call("/rest/v1/rpc/ingest_session",JSONObject().put("p_payload",JSONObject(payload)),token))
        check(result.getString("sessionId")==JSONObject(payload).getString("sessionId"))
    }}
}

private const val CLOUDINARY_API="https://api.cloudinary.com"
private const val ADMIN_PAGE=50
private const val ACTIVITY_PAGE=30
/** JSON null and missing keys both read as null; org.json's optString would return the text "null". */
private fun JSONObject.text(key:String):String?=if(isNull(key)) null else getString(key)
