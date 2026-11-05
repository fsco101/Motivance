package com.motivance.domain

data class Landmark(val x: Float, val y: Float, val visibility: Float)
data class PoseFrame(val points: List<Landmark>, val width: Int, val height: Int, val timestampMs: Long, val latencyMs: Long)
enum class UserRole { PATIENT, THERAPIST, ADMIN }
data class UserSession(val userId: String, val roles: Set<UserRole>) {
    /** Every account starts as a patient, so staff also hold that role: the most senior role decides where they land. */
    val primaryRole:UserRole? get()=listOf(UserRole.ADMIN,UserRole.THERAPIST,UserRole.PATIENT).firstOrNull {it in roles}
    /** The workspace to show: the one [chosen] on the profile page while the account still holds it, else [primaryRole]. */
    fun workspace(chosen:UserRole?)=chosen?.takeIf {it in roles} ?: primaryRole
}
data class SessionSummary(val id: String, val patientId: String, val startedAt: String, val status: String)
data class AssignmentSummary(val id: String, val patientId: String)
data class WorkspaceOverview(val displayName: String = "", val patientIds: List<String> = emptyList(), val sessions: List<SessionSummary> = emptyList(), val assignments: List<AssignmentSummary> = emptyList())
interface AuthRepository {
    suspend fun restoreSession():UserSession? = null
    suspend fun signIn(email: String, password: String): UserSession
    suspend fun register(email: String, password: String)
    suspend fun registerProfile(email:String,password:String,profile:PatientProfile) {throw UnsupportedOperationException()}
    suspend fun loadProfile():PatientProfile {throw UnsupportedOperationException()}
    suspend fun saveProfile(profile:PatientProfile) {throw UnsupportedOperationException()}
    suspend fun changePassword(currentPassword:String,newPassword:String) {throw UnsupportedOperationException()}
    /** Uploads an already-prepared JPEG as the signed-in account's profile photo and returns its delivery URL. */
    suspend fun uploadProfilePhoto(jpeg:ByteArray):String {throw UnsupportedOperationException()}
    suspend fun removeProfilePhoto() {throw UnsupportedOperationException()}
    suspend fun confirmRegistration(email: String, token: String): UserSession
    suspend fun resendConfirmation(email:String) {throw UnsupportedOperationException("Confirmation resend is unavailable")}
    suspend fun requestRecovery(email: String)
    suspend fun recover(email: String, token: String, newPassword: String): UserSession
    suspend fun refresh(): UserSession
    suspend fun signOut()
    suspend fun loadOverview(): WorkspaceOverview
}
