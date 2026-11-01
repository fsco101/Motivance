package com.motivance.feature.auth
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.motivance.domain.AuthRepository
import com.motivance.domain.UserSession
import com.motivance.domain.WorkspaceOverview
import com.motivance.domain.RemoteFailure
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
enum class AuthAction { SIGN_IN, REGISTER, CONFIRM, RESEND_CONFIRMATION, REQUEST_RECOVERY, RECOVER, REFRESH, SIGN_OUT }
enum class AuthNotice { INVALID_EMAIL, PASSWORD_REQUIRED, CODE_REQUIRED, CONFIRM_EMAIL, RECOVERY_SENT, REQUEST_FAILED, SESSION_EXPIRED, EMAIL_UNCONFIRMED, INVALID_CODE, RATE_LIMITED, PASSWORD_POLICY }
data class AuthState(val session: UserSession? = null, val busy: Boolean = false, val notice: AuthNotice? = null, val restoring: Boolean = false, val activeAction: AuthAction? = null)
data class OverviewState(val data: WorkspaceOverview? = null, val busy: Boolean = false, val failed: Boolean = false)
@HiltViewModel class AuthViewModel @Inject constructor(private val auth: AuthRepository) : ViewModel() {
    private val mutable = MutableStateFlow(AuthState(restoring=true))
    val state = mutable.asStateFlow()
    private val overviewMutable=MutableStateFlow(OverviewState())
    val overview=overviewMutable.asStateFlow()
    fun restore() {
        if(mutable.value.session!=null || mutable.value.busy) return
        mutable.value=AuthState(busy=true,restoring=true)
        viewModelScope.launch {
            try {mutable.value=AuthState(session=auth.restoreSession())}
            catch(e:CancellationException) {throw e}
            catch(_:Exception) {mutable.value=AuthState()}
        }
    }
    fun loadOverview() {
        val user=mutable.value.session?.userId ?: return
        if(overviewMutable.value.busy) return
        overviewMutable.value=OverviewState(busy=true)
        viewModelScope.launch {
            try {
                val result=auth.loadOverview()
                if(mutable.value.session?.userId==user) overviewMutable.value=OverviewState(data=result)
            } catch(e: CancellationException) { throw e }
            catch(e: Exception) { if(mutable.value.session?.userId==user) overviewMutable.value=OverviewState(failed=true) }
        }
    }
    fun clearNotice() { if (!mutable.value.busy) mutable.value=mutable.value.copy(notice=null) }
    fun registerProfile(email:String,password:String,profile:com.motivance.domain.PatientProfile) {
        if(mutable.value.busy) return
        if(!profile.valid() || password.length<8 || !email.trim().matches(Regex("[^\\s@]+@[^\\s@]+\\.[^\\s@]+"))) {mutable.value=mutable.value.copy(notice=AuthNotice.REQUEST_FAILED);return}
        mutable.value=mutable.value.copy(busy=true,notice=null,activeAction=AuthAction.REGISTER)
        viewModelScope.launch {
            try {auth.registerProfile(email.trim(),password,profile);mutable.value=AuthState(notice=AuthNotice.CONFIRM_EMAIL)}
            catch(e:CancellationException) {throw e}
            catch(_:Exception) {mutable.value=mutable.value.copy(busy=false,activeAction=null,notice=AuthNotice.REQUEST_FAILED)}
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
        if(notice!=null) { mutable.value=mutable.value.copy(notice=notice,restoring=false); return }
        mutable.value=mutable.value.copy(busy=true,notice=null,restoring=false,activeAction=action)
        viewModelScope.launch {
            try {
                when(action) {
                    AuthAction.SIGN_IN -> mutable.value=AuthState(session=auth.signIn(email.trim(),password))
                    AuthAction.REGISTER -> { auth.register(email.trim(),password); mutable.value=AuthState(notice=AuthNotice.CONFIRM_EMAIL) }
                    AuthAction.CONFIRM -> mutable.value=AuthState(session=auth.confirmRegistration(email.trim(),otp.trim()))
                    AuthAction.RESEND_CONFIRMATION -> {auth.resendConfirmation(email.trim());mutable.value=AuthState(notice=AuthNotice.CONFIRM_EMAIL)}
                    AuthAction.REQUEST_RECOVERY -> { auth.requestRecovery(email.trim()); mutable.value=AuthState(notice=AuthNotice.RECOVERY_SENT) }
                    AuthAction.RECOVER -> mutable.value=AuthState(session=auth.recover(email.trim(),otp.trim(),password))
                    AuthAction.REFRESH -> mutable.value=AuthState(session=auth.refresh())
                    AuthAction.SIGN_OUT -> { overviewMutable.value=OverviewState(); mutable.value=AuthState(busy=true,activeAction=AuthAction.SIGN_OUT); auth.signOut() }
                }
            } catch(e: CancellationException) { throw e }
            catch(e: Exception) {
                if(action==AuthAction.REFRESH || action==AuthAction.SIGN_OUT) overviewMutable.value=OverviewState()
                val notice=when {
                    action==AuthAction.REFRESH -> AuthNotice.SESSION_EXPIRED
                    e is RemoteFailure && (e.status==429 || e.code=="over_email_send_rate_limit") -> AuthNotice.RATE_LIMITED
                    e is RemoteFailure && e.code=="email_not_confirmed" -> AuthNotice.EMAIL_UNCONFIRMED
                    e is RemoteFailure && e.code=="otp_expired" -> AuthNotice.INVALID_CODE
                    e is RemoteFailure && e.code in setOf("weak_password","same_password") -> AuthNotice.PASSWORD_POLICY
                    else -> AuthNotice.REQUEST_FAILED
                }
                mutable.value=mutable.value.copy(busy=false,notice=notice,session=if(action==AuthAction.REFRESH || action==AuthAction.SIGN_OUT) null else mutable.value.session)
            }
            finally { mutable.value=mutable.value.copy(busy=false,activeAction=null) }
        }
    }
}
