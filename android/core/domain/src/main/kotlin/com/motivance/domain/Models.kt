package com.motivance.domain

data class Landmark(val x: Float, val y: Float, val visibility: Float)
data class PoseFrame(val points: List<Landmark>, val width: Int, val height: Int, val timestampMs: Long, val latencyMs: Long)
enum class UserRole { PATIENT, THERAPIST, SCHEDULER, ADMIN;
    companion object {
        /** Null for a role this build does not know, so a newer server can never stop an older app signing in. */
        fun of(value:String)=entries.firstOrNull {it.name.equals(value,ignoreCase=true)}
    }
}
data class UserSession(val userId: String, val roles: Set<UserRole>) {
    /** Every account starts as a patient, so staff also hold that role: the most senior role decides where they land. */
    val primaryRole:UserRole? get()=listOf(UserRole.ADMIN,UserRole.SCHEDULER,UserRole.THERAPIST,UserRole.PATIENT).firstOrNull {it in roles}
    /** The workspace to show: the one [chosen] on the profile page while the account still holds it, else [primaryRole]. */
    fun workspace(chosen:UserRole?)=chosen?.takeIf {it in roles} ?: primaryRole
}
data class SessionSummary(val id: String, val patientId: String, val startedAt: String, val status: String)
data class AssignmentSummary(val id: String, val patientId: String)
data class WorkspaceOverview(val displayName: String = "", val patientIds: List<String> = emptyList(), val sessions: List<SessionSummary> = emptyList(), val assignments: List<AssignmentSummary> = emptyList())
/** How the signed-in person can sign in, from my_sign_in() (#167). The web app reads the same answer. */
data class SignInMethods(val password:Boolean=true,val google:Boolean=false,
    /** A patient who came through Google has no username or details yet, and finishes them before Home. */
    val profileRequired:Boolean=false)
/** Google's ID token from the phone, and the nonce whose hash Google signed into it. Auth checks one against the other. */
data class GoogleToken(val idToken:String,val rawNonce:String)
/** Why the phone could not produce a Google token. A token Auth refuses, or no connection, is a [RemoteFailure] or IOException. */
enum class GoogleFailure { CANCELLED, NO_ACCOUNT, UNAVAILABLE, NOT_CONFIGURED }
class GoogleSignInFailure(val reason:GoogleFailure):Exception(reason.name)
/** The phone's remembered Google choice. Forgetting it at sign-out makes the next person on a shared phone choose their own account. */
interface GoogleAccounts {
    suspend fun forget() {}
    companion object { val None=object:GoogleAccounts {} }
}
interface AuthRepository {
    suspend fun restoreSession():UserSession? = null
    suspend fun signIn(email: String, password: String): UserSession
    /** Exchanges Google's ID token for a session, stored exactly like a password sign-in. */
    suspend fun signInWithGoogle(token:GoogleToken):UserSession {throw UnsupportedOperationException()}
    suspend fun signInMethods():SignInMethods = SignInMethods()
    /** A Google-only account has no current password to prove, so its first one is set from the signed-in session. */
    suspend fun setFirstPassword(newPassword:String) {throw UnsupportedOperationException()}
    suspend fun register(email: String, password: String)
    suspend fun registerProfile(email:String,password:String,profile:PatientProfile) {throw UnsupportedOperationException()}
    suspend fun loadProfile():PatientProfile {throw UnsupportedOperationException()}
    suspend fun saveProfile(profile:PatientProfile) {throw UnsupportedOperationException()}
    suspend fun changePassword(currentPassword:String,newPassword:String) {throw UnsupportedOperationException()}
    /** Uploads an already cropped and shrunk WebP as the signed-in account's profile photo and returns its storage path. */
    suspend fun uploadProfilePhoto(webp:ByteArray):String {throw UnsupportedOperationException()}
    suspend fun removeProfilePhoto() {throw UnsupportedOperationException()}
    suspend fun confirmRegistration(email: String, token: String): UserSession
    suspend fun resendConfirmation(email:String) {throw UnsupportedOperationException("Confirmation resend is unavailable")}
    suspend fun requestRecovery(email: String)
    suspend fun recover(email: String, token: String, newPassword: String): UserSession
    suspend fun refresh(): UserSession
    suspend fun signOut()
    suspend fun loadOverview(): WorkspaceOverview
}
