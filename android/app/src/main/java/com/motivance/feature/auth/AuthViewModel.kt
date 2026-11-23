package com.motivance.feature.auth
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.motivance.R
import com.motivance.designsystem.Toaster
import com.motivance.designsystem.ToastTone
import com.motivance.domain.AuthRepository
import com.motivance.domain.GoogleAccounts
import com.motivance.domain.GoogleFailure
import com.motivance.domain.GoogleSignInFailure
import com.motivance.domain.GoogleToken
import com.motivance.domain.UserRole
import com.motivance.domain.PushDevices
import com.motivance.domain.UserSession
import com.motivance.domain.WorkspaceOverview
import com.motivance.domain.RemoteFailure
import com.motivance.domain.isOffline
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
enum class AuthAction { SIGN_IN, REGISTER, CONFIRM, RESEND_CONFIRMATION, REQUEST_RECOVERY, RECOVER, REFRESH, SIGN_OUT, GOOGLE }
enum class AuthNotice { INVALID_EMAIL, PASSWORD_REQUIRED, CODE_REQUIRED, CONFIRM_EMAIL, RECOVERY_SENT, REQUEST_FAILED, SESSION_EXPIRED, EMAIL_UNCONFIRMED, INVALID_CODE, SIGNUP_CODE_EXPIRED, RATE_LIMITED, PASSWORD_POLICY,
    GOOGLE_CANCELLED, GOOGLE_NO_ACCOUNT, GOOGLE_OFFLINE, GOOGLE_REFUSED, GOOGLE_UNAVAILABLE, GOOGLE_NOT_CONFIGURED, GOOGLE_CLOSED, GOOGLE_FAILED }
/** [profileRequired]: a patient who came through Google finishes their details and the privacy agreement before Home (#167). */
data class AuthState(val session: UserSession? = null, val busy: Boolean = false, val notice: AuthNotice? = null, val restoring: Boolean = false, val activeAction: AuthAction? = null,
    val profileRequired: Boolean = false)
/** Each way Continue with Google can stop, as its own message: never the generic "Request failed" (#168). */
internal fun googleNotice(e:Exception)=when {
    e is GoogleSignInFailure -> when(e.reason) {
        GoogleFailure.CANCELLED -> AuthNotice.GOOGLE_CANCELLED
        GoogleFailure.NO_ACCOUNT -> AuthNotice.GOOGLE_NO_ACCOUNT
        GoogleFailure.UNAVAILABLE -> AuthNotice.GOOGLE_UNAVAILABLE
        GoogleFailure.NOT_CONFIGURED -> AuthNotice.GOOGLE_NOT_CONFIGURED
    }
    e.isOffline() -> AuthNotice.GOOGLE_OFFLINE
    e is RemoteFailure && e.code=="signup_disabled" -> AuthNotice.GOOGLE_CLOSED
    e is RemoteFailure && e.code=="provider_disabled" -> AuthNotice.GOOGLE_NOT_CONFIGURED
    e is RemoteFailure && e.status==429 -> AuthNotice.RATE_LIMITED
    e is RemoteFailure && e.status in 400..499 -> AuthNotice.GOOGLE_REFUSED
    else -> AuthNotice.GOOGLE_FAILED
}
data class OverviewState(val data: WorkspaceOverview? = null, val busy: Boolean = false, val failed: Boolean = false, val offline: Boolean = false)
private fun AuthAction.doneToast()=when(this) {
    AuthAction.SIGN_IN -> R.string.toast_signed_in to ToastTone.SUCCESS
    AuthAction.REGISTER -> R.string.toast_account_created to ToastTone.PENDING
    AuthAction.CONFIRM -> R.string.toast_email_verified to ToastTone.SUCCESS
    AuthAction.RESEND_CONFIRMATION, AuthAction.REQUEST_RECOVERY -> R.string.toast_code_sent to ToastTone.PENDING
    AuthAction.RECOVER -> R.string.toast_password_reset to ToastTone.SUCCESS
    AuthAction.REFRESH -> R.string.toast_session_refreshed to ToastTone.SUCCESS
    AuthAction.SIGN_OUT -> R.string.toast_signed_out to ToastTone.SUCCESS
    AuthAction.GOOGLE -> R.string.toast_signed_in to ToastTone.SUCCESS
}
@HiltViewModel class AuthViewModel @Inject constructor(private val auth: AuthRepository,private val toasts:Toaster=Toaster(),private val devices:PushDevices=PushDevices.None,
    private val google:GoogleAccounts=GoogleAccounts.None) : ViewModel() {
    private val mutable = MutableStateFlow(AuthState(restoring=true))
    val state = mutable.asStateFlow()
    private val overviewMutable=MutableStateFlow(OverviewState())
    val overview=overviewMutable.asStateFlow()
    fun restore() {
        if(mutable.value.session!=null || mutable.value.busy) return
        mutable.value=AuthState(busy=true,restoring=true)
        viewModelScope.launch {
            try {mutable.value=signedIn(auth.restoreSession())}
            catch(e:CancellationException) {throw e}
            catch(_:Exception) {mutable.value=AuthState()}
        }
    }
    /** Only a patient can be asked to finish a profile. If the question cannot be answered, nothing holds them back. */
    private suspend fun signedIn(session:UserSession?):AuthState {
        if(session==null || session.primaryRole!=UserRole.PATIENT) return AuthState(session=session)
        val required=try {auth.signInMethods().profileRequired} catch(e:CancellationException) {throw e} catch(_:Exception) {false}
        return AuthState(session=session,profileRequired=required)
    }
    /** The details are saved, so Home can open. */
    fun profileFinished() {mutable.value=mutable.value.copy(profileRequired=false)}
    /**
     * Continue with Google. [obtain] shows Google's picker on the phone and returns its token; the session is then stored exactly like a
     * password sign-in, so token renewal, the offline start and push registration work unchanged.
     */
    fun continueWithGoogle(obtain:suspend ()->GoogleToken) {
        if(mutable.value.busy) return
        mutable.value=mutable.value.copy(busy=true,notice=null,restoring=false,activeAction=AuthAction.GOOGLE)
        viewModelScope.launch {
            try {
                val token=obtain()
                toasts.show(AuthAction.GOOGLE.busyLabel(),ToastTone.PENDING)
                mutable.value=signedIn(auth.signInWithGoogle(token))
                report(AuthAction.GOOGLE)
            } catch(e:CancellationException) {throw e}
            catch(e:Exception) {
                val notice=googleNotice(e)
                mutable.value=mutable.value.copy(busy=false,notice=notice)
                // Closing the picker was the person's choice, so it is noted on the page without an alarm.
                if(notice!=AuthNotice.GOOGLE_CANCELLED) report(notice)
            }
            finally {mutable.value=mutable.value.copy(busy=false,activeAction=null)}
        }
    }
    private fun report(action:AuthAction) {val (message,tone)=action.doneToast(); toasts.show(message,tone)}
    private fun report(notice:AuthNotice) {toasts.show(notice.label(),ToastTone.ERROR)}
    fun loadOverview() {
        val user=mutable.value.session?.userId ?: return
        if(overviewMutable.value.busy) return
        val shown=overviewMutable.value.data
        overviewMutable.value=OverviewState(busy=true)
        viewModelScope.launch {
            try {
                val result=auth.loadOverview()
                if(mutable.value.session?.userId==user) overviewMutable.value=OverviewState(data=result)
            } catch(e: CancellationException) { throw e }
            catch(e: Exception) { if(mutable.value.session?.userId==user) overviewMutable.value=if(e.isOffline()) OverviewState(data=shown,failed=true,offline=true) else OverviewState(failed=true) }
        }
    }
    fun registerPush() {viewModelScope.launch {devices.register()}}
    fun clearNotice() { if (!mutable.value.busy) mutable.value=mutable.value.copy(notice=null) }
    fun registerProfile(email:String,password:String,profile:com.motivance.domain.PatientProfile) {
        if(mutable.value.busy) return
        if(!profile.valid() || password.length<8 || !email.trim().matches(Regex("[^\\s@]+@[^\\s@]+\\.[^\\s@]+"))) {mutable.value=mutable.value.copy(notice=AuthNotice.REQUEST_FAILED);report(AuthNotice.REQUEST_FAILED);return}
        mutable.value=mutable.value.copy(busy=true,notice=null,activeAction=AuthAction.REGISTER)
        toasts.show(AuthAction.REGISTER.busyLabel(),ToastTone.PENDING)
        viewModelScope.launch {
            try {auth.registerProfile(email.trim(),password,profile);mutable.value=AuthState(notice=AuthNotice.CONFIRM_EMAIL);report(AuthAction.REGISTER)}
            catch(e:CancellationException) {throw e}
            catch(_:Exception) {mutable.value=mutable.value.copy(busy=false,activeAction=null,notice=AuthNotice.REQUEST_FAILED);report(AuthNotice.REQUEST_FAILED)}
        }
    }
    fun act(action: AuthAction, email: String = "", password: String = "", otp: String = "") {
        if (mutable.value.busy) return
        val needsEmail=action in setOf(AuthAction.SIGN_IN,AuthAction.REGISTER,AuthAction.CONFIRM,AuthAction.RESEND_CONFIRMATION,AuthAction.REQUEST_RECOVERY,AuthAction.RECOVER)
        val notice=when {
            needsEmail && !email.trim().matches(Regex("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")) -> AuthNotice.INVALID_EMAIL
            action in setOf(AuthAction.SIGN_IN,AuthAction.REGISTER,AuthAction.RECOVER) && password.isBlank() -> AuthNotice.PASSWORD_REQUIRED
            action in setOf(AuthAction.CONFIRM,AuthAction.RECOVER) && otp.isBlank() -> AuthNotice.CODE_REQUIRED
            else -> null
        }
        if(notice!=null) { mutable.value=mutable.value.copy(notice=notice,restoring=false); report(notice); return }
        mutable.value=mutable.value.copy(busy=true,notice=null,restoring=false,activeAction=action)
        toasts.show(action.busyLabel(),ToastTone.PENDING)
        viewModelScope.launch {
            try {
                when(action) {
                    AuthAction.SIGN_IN -> mutable.value=signedIn(auth.signIn(email.trim(),password))
                    AuthAction.REGISTER -> { auth.register(email.trim(),password); mutable.value=AuthState(notice=AuthNotice.CONFIRM_EMAIL) }
                    AuthAction.CONFIRM -> mutable.value=signedIn(auth.confirmRegistration(email.trim(),otp.trim()))
                    AuthAction.RESEND_CONFIRMATION -> {auth.resendConfirmation(email.trim());mutable.value=AuthState(notice=AuthNotice.CONFIRM_EMAIL)}
                    AuthAction.REQUEST_RECOVERY -> { auth.requestRecovery(email.trim()); mutable.value=AuthState(notice=AuthNotice.RECOVERY_SENT) }
                    AuthAction.RECOVER -> mutable.value=signedIn(auth.recover(email.trim(),otp.trim(),password))
                    AuthAction.REFRESH -> mutable.value=signedIn(auth.refresh())
                    // Forgetting the Google choice comes first, so even a failed server sign-out leaves the next person to choose their own.
                    AuthAction.SIGN_OUT -> { overviewMutable.value=OverviewState(); mutable.value=AuthState(busy=true,activeAction=AuthAction.SIGN_OUT); devices.unregister(); google.forget(); auth.signOut() }
                    AuthAction.GOOGLE -> Unit
                }
                report(action)
            } catch(e: CancellationException) { throw e }
            catch(e: Exception) {
                if(action==AuthAction.REFRESH || action==AuthAction.SIGN_OUT) overviewMutable.value=OverviewState()
                val notice=when {
                    action==AuthAction.REFRESH -> AuthNotice.SESSION_EXPIRED
                    e is RemoteFailure && (e.status==429 || e.code=="over_email_send_rate_limit") -> AuthNotice.RATE_LIMITED
                    e is RemoteFailure && e.code=="email_not_confirmed" -> AuthNotice.EMAIL_UNCONFIRMED
                    // An expired sign-up is deleted, so only signing up again helps; a password reset can ask for a new code.
                    e is RemoteFailure && e.code=="otp_expired" && action==AuthAction.CONFIRM -> AuthNotice.SIGNUP_CODE_EXPIRED
                    e is RemoteFailure && e.code=="otp_expired" -> AuthNotice.INVALID_CODE
                    e is RemoteFailure && e.code in setOf("weak_password","same_password") -> AuthNotice.PASSWORD_POLICY
                    else -> AuthNotice.REQUEST_FAILED
                }
                mutable.value=mutable.value.copy(busy=false,notice=notice,session=if(action==AuthAction.REFRESH || action==AuthAction.SIGN_OUT) null else mutable.value.session)
                report(notice)
            }
            finally { mutable.value=mutable.value.copy(busy=false,activeAction=null) }
        }
    }
}
