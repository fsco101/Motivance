package com.motivance.feature.auth
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.motivance.domain.AuthRepository
import com.motivance.domain.UserSession
import com.motivance.domain.WorkspaceOverview
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
enum class AuthAction { SIGN_IN, REGISTER, CONFIRM, REQUEST_RECOVERY, RECOVER, REFRESH, SIGN_OUT }
enum class AuthNotice { INVALID_EMAIL, PASSWORD_REQUIRED, CODE_REQUIRED, CONFIRM_EMAIL, RECOVERY_SENT, REQUEST_FAILED, SESSION_EXPIRED }
data class AuthState(val session: UserSession? = null, val busy: Boolean = false, val notice: AuthNotice? = null)
data class OverviewState(val data: WorkspaceOverview? = null, val busy: Boolean = false, val failed: Boolean = false)
@HiltViewModel class AuthViewModel @Inject constructor(private val auth: AuthRepository) : ViewModel() {
    private val mutable = MutableStateFlow(AuthState())
    val state = mutable.asStateFlow()
    private val overviewMutable=MutableStateFlow(OverviewState())
    val overview=overviewMutable.asStateFlow()
    fun restore() {
        if(mutable.value.session!=null || mutable.value.busy) return
        mutable.value=AuthState(busy=true)
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
    fun act(action: AuthAction, email: String = "", password: String = "", otp: String = "") {
        if (mutable.value.busy) return
        val needsEmail=action in setOf(AuthAction.SIGN_IN,AuthAction.REGISTER,AuthAction.CONFIRM,AuthAction.REQUEST_RECOVERY,AuthAction.RECOVER)
        val notice=when {
            needsEmail && !email.trim().matches(Regex("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")) -> AuthNotice.INVALID_EMAIL
            action in setOf(AuthAction.SIGN_IN,AuthAction.REGISTER,AuthAction.RECOVER) && password.isBlank() -> AuthNotice.PASSWORD_REQUIRED
            action in setOf(AuthAction.CONFIRM,AuthAction.RECOVER) && otp.isBlank() -> AuthNotice.CODE_REQUIRED
            else -> null
        }
        if(notice!=null) { mutable.value=mutable.value.copy(notice=notice); return }
        mutable.value=mutable.value.copy(busy=true,notice=null)
        viewModelScope.launch {
            try {
                when(action) {
                    AuthAction.SIGN_IN -> mutable.value=AuthState(session=auth.signIn(email.trim(),password))
                    AuthAction.REGISTER -> { auth.register(email.trim(),password); mutable.value=AuthState(notice=AuthNotice.CONFIRM_EMAIL) }
                    AuthAction.CONFIRM -> mutable.value=AuthState(session=auth.confirmRegistration(email.trim(),otp.trim()))
                    AuthAction.REQUEST_RECOVERY -> { auth.requestRecovery(email.trim()); mutable.value=AuthState(notice=AuthNotice.RECOVERY_SENT) }
                    AuthAction.RECOVER -> mutable.value=AuthState(session=auth.recover(email.trim(),otp.trim(),password))
                    AuthAction.REFRESH -> mutable.value=AuthState(session=auth.refresh())
                    AuthAction.SIGN_OUT -> { overviewMutable.value=OverviewState(); mutable.value=AuthState(busy=true); auth.signOut() }
                }
            } catch(e: CancellationException) { throw e }
            catch(e: Exception) {
                if(action==AuthAction.REFRESH || action==AuthAction.SIGN_OUT) overviewMutable.value=OverviewState()
                mutable.value=mutable.value.copy(busy=false,notice=if(action==AuthAction.REFRESH) AuthNotice.SESSION_EXPIRED else AuthNotice.REQUEST_FAILED,session=if(action==AuthAction.REFRESH || action==AuthAction.SIGN_OUT) null else mutable.value.session)
            }
            finally { mutable.value=mutable.value.copy(busy=false) }
        }
    }
}
