package com.motivance.domain

/** Every account is provisioned with the patient role; staff roles are granted on top of it. */
data class AdminAccount(
    val id:String,val name:String,val active:Boolean,val roles:Set<String>,
    val email:String="",val username:String?=null,val createdAt:String?=null,val lastSignInAt:String?=null,val photoUrl:String?=null,
) {
    val staff get()="therapist" in roles || "admin" in roles || "scheduler" in roles
    /** The most privileged role, used for grouping and badges. */
    val primaryRole get()=when {"admin" in roles -> "admin";"scheduler" in roles -> "scheduler";"therapist" in roles -> "therapist";else -> "patient"}
    val label get()=name.ifBlank {email.ifBlank {id.take(8)}}
}
data class AdminLink(val therapist:String,val patient:String,val active:Boolean,val therapistName:String="",val patientName:String="")
data class AdminExercise(val id:String,val code:String,val active:Boolean,val version:Int,val name:String,val english:String,val filipino:String,val algorithm:String="")
/** Whole-system counts from the server, independent of how many directory pages are loaded. */
data class AdminSummary(
    val accounts:Int=0,val disabled:Int=0,val patients:Int=0,val therapists:Int=0,val admins:Int=0,
    val activeLinks:Int=0,val unlinkedPatients:Int=0,val exercises:Int=0,val activeExercises:Int=0,
    val sessionsWeek:Int=0,val pendingRequests:Int=0,val schedulers:Int=0,
)
data class AuditEvent(
    val id:Long,val action:String,val targetType:String,val targetId:String,val recordedAt:String,
    val actorId:String?=null,val actorName:String="",val targetName:String="",val relatedName:String="",
) {
    /** Events written by database triggers outside an authenticated request (for example signup provisioning) have no actor. */
    val system get()=actorId==null
}
data class AuditPage(val events:List<AuditEvent> = emptyList(),val next:Long?=null)
data class AdminWorkspace(
    val accounts:List<AdminAccount> = emptyList(),val links:List<AdminLink> = emptyList(),val exercises:List<AdminExercise> = emptyList(),
    val next:String?=null,val summary:AdminSummary?=null,val activity:List<AuditEvent> = emptyList(),val activityNext:Long?=null,
)

enum class AccountFilter { ALL, PATIENTS, THERAPISTS, SCHEDULERS, ADMINS, DISABLED }
fun AccountFilter.accepts(account:AdminAccount)=when(this) {
    AccountFilter.ALL -> true
    AccountFilter.PATIENTS -> account.primaryRole=="patient"
    AccountFilter.THERAPISTS -> "therapist" in account.roles
    AccountFilter.SCHEDULERS -> "scheduler" in account.roles
    AccountFilter.ADMINS -> "admin" in account.roles
    AccountFilter.DISABLED -> !account.active
}

enum class LinkFilter { ACTIVE, REVOKED, ALL }
fun LinkFilter.accepts(link:AdminLink)=when(this) {LinkFilter.ACTIVE -> link.active;LinkFilter.REVOKED -> !link.active;LinkFilter.ALL -> true}

/** Coarse grouping of audit records for filtering and iconography. */
enum class AuditCategory { ACCOUNTS, LINKS, CATALOGUE, CLINICAL, PRIVACY, BOOKINGS }
fun AuditEvent.category()=when(targetType) {
    "profiles","user_roles","patient_profiles" -> AuditCategory.ACCOUNTS
    "therapist_patients","patient_invitations" -> AuditCategory.LINKS
    "exercises","exercise_versions" -> AuditCategory.CATALOGUE
    "consents","data_requests" -> AuditCategory.PRIVACY
    "bookings" -> AuditCategory.BOOKINGS
    else -> AuditCategory.CLINICAL
}

/** Stable keys for every audited operation the backend currently records. */
enum class AuditKind { ACCOUNT_ENABLED, ACCOUNT_DISABLED, PHOTO_UPDATED, PHOTO_REMOVED, PROFILE_UPDATED, ROLE_GRANTED, ROLE_REMOVED, ROLE_CHANGED, LINK_CREATED, LINK_UPDATED,
    INVITATION_CREATED, EXERCISE_ACTIVATED, EXERCISE_DEACTIVATED, VERSION_PUBLISHED, PRESCRIPTION_PUBLISHED, SESSION_RECORDED,
    CONSENT_RECORDED, REQUEST_CREATED, REQUEST_UPDATED, BOOKING_REQUESTED, BOOKING_CONFIRMED, BOOKING_REJECTED, BOOKING_CANCELLED,
    BOOKING_RESCHEDULED, BOOKING_RETURNED, BOOKING_THERAPIST, BOOKING_ATTENDANCE, BOOKING_EXPORTED, OTHER }
fun AuditEvent.kind()=when(targetType to action) {
    "profiles" to "enable" -> AuditKind.ACCOUNT_ENABLED
    "profiles" to "disable" -> AuditKind.ACCOUNT_DISABLED
    "profiles" to "update_photo" -> AuditKind.PHOTO_UPDATED
    "profiles" to "remove_photo" -> AuditKind.PHOTO_REMOVED
    "patient_profiles" to "update_profile" -> AuditKind.PROFILE_UPDATED
    "user_roles" to "insert" -> AuditKind.ROLE_GRANTED
    "user_roles" to "delete" -> AuditKind.ROLE_REMOVED
    "user_roles" to "update" -> AuditKind.ROLE_CHANGED
    "therapist_patients" to "insert" -> AuditKind.LINK_CREATED
    "therapist_patients" to "update" -> AuditKind.LINK_UPDATED
    "patient_invitations" to "invite" -> AuditKind.INVITATION_CREATED
    "exercises" to "activate" -> AuditKind.EXERCISE_ACTIVATED
    "exercises" to "deactivate" -> AuditKind.EXERCISE_DEACTIVATED
    "exercise_versions" to "publish" -> AuditKind.VERSION_PUBLISHED
    "prescription_versions" to "insert" -> AuditKind.PRESCRIPTION_PUBLISHED
    "sessions" to "insert" -> AuditKind.SESSION_RECORDED
    "consents" to "insert" -> AuditKind.CONSENT_RECORDED
    "data_requests" to "insert" -> AuditKind.REQUEST_CREATED
    "data_requests" to "update" -> AuditKind.REQUEST_UPDATED
    "bookings" to "requested" -> AuditKind.BOOKING_REQUESTED
    "bookings" to "confirmed" -> AuditKind.BOOKING_CONFIRMED
    "bookings" to "rejected" -> AuditKind.BOOKING_REJECTED
    "bookings" to "cancelled" -> AuditKind.BOOKING_CANCELLED
    "bookings" to "rescheduled" -> AuditKind.BOOKING_RESCHEDULED
    "bookings" to "returned_to_pending" -> AuditKind.BOOKING_RETURNED
    "bookings" to "therapist_changed" -> AuditKind.BOOKING_THERAPIST
    "bookings" to "attendance_marked" -> AuditKind.BOOKING_ATTENDANCE
    "bookings" to "export" -> AuditKind.BOOKING_EXPORTED
    else -> AuditKind.OTHER
}

interface AdministrationRepository {
    /** Loads one directory page (optionally filtered server-side by [search]) plus links, catalogue, overview and recent activity. */
    suspend fun loadAdministration(after:String?=null,search:String?=null):AdminWorkspace
    /** Loads activity strictly older than [before]. */
    suspend fun loadActivity(before:Long):AuditPage
    suspend fun setAccount(user:String,active:Boolean)
    suspend fun setRole(user:String,role:String,granted:Boolean)
    suspend fun setLink(therapist:String,patient:String,active:Boolean)
    suspend fun setExercise(exercise:String,active:Boolean)
    suspend fun publishExercise(exercise:String,name:String,english:String,filipino:String)
    /** Moderation: removes another account's profile photo. */
    suspend fun clearPhoto(user:String)
}
