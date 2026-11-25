package com.motivance.feature.colleagues

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.motivance.R
import com.motivance.designsystem.ToastTone
import com.motivance.designsystem.Toaster
import com.motivance.domain.*
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** A colleague's patient once opened: who they are, their plan, or that they can no longer be shown. */
sealed interface OpenedState {
    data object Opening:OpenedState
    data object Unavailable:OpenedState
    data class Open(val patient:OpenedColleaguePatient,val plan:List<ColleaguePlanItem>?):OpenedState
}

data class ColleaguesUiState(
    val colleagues:List<Colleague>?=null,val patients:List<ColleaguePatient>?=null,val failed:Boolean=false,val busy:Boolean=false,
    val opened:Map<String,OpenedState> = emptyMap(),val access:Map<String,ColleagueAccess> = emptyMap(),val sharing:Boolean?=null,
)

/** The server's refusals, in the reader's words (colleagueFailureKey on the web). */
internal fun colleagueRefusal(e:Exception)=when((e as? RemoteFailure)?.code) {
    "colleague_not_found" -> R.string.colleagues_error_not_found
    "colleague_self" -> R.string.colleagues_error_self
    "colleague_exists" -> R.string.colleagues_error_exists
    "colleague_state" -> R.string.colleagues_error_state
    "colleague_unavailable" -> R.string.colleagues_error_unavailable
    else -> if(e.isOffline()) R.string.offline_action else R.string.connected_failed
}

/**
 * Colleagues (#173) for a therapist, and the patient's own choice to share with them. Opening a colleague's patient is always the
 * first call, because the server records it and only then lets that patient's progress be read.
 */
@HiltViewModel class ColleagueViewModel @Inject constructor(private val repository:ColleagueRepository,private val toasts:Toaster):ViewModel() {
    private val mutable=MutableStateFlow(ColleaguesUiState())
    val state=mutable.asStateFlow()

    fun load() {
        viewModelScope.launch {
            try {
                val colleagues=repository.loadColleagues(); val patients=repository.loadColleaguePatients()
                mutable.update {it.copy(colleagues=colleagues,patients=patients,failed=false)}
            } catch(e:CancellationException) {throw e} catch(_:Exception) {mutable.update {it.copy(failed=true)}}
        }
    }

    private fun act(done:Int,work:suspend ()->Unit) {
        if(mutable.value.busy) return
        mutable.update {it.copy(busy=true)}
        viewModelScope.launch {
            try {work(); toasts.show(done); load()}
            catch(e:CancellationException) {throw e}
            catch(e:Exception) {toasts.show(colleagueRefusal(e),ToastTone.ERROR)}
            finally {mutable.update {it.copy(busy=false)}}
        }
    }
    fun invite(email:String)=act(R.string.colleagues_invited) {repository.inviteColleague(email)}
    fun respond(colleague:Colleague,accept:Boolean)=act(if(accept) R.string.colleagues_accepted else R.string.colleagues_declined) {repository.respondColleague(colleague.id,accept)}
    fun end(colleague:Colleague)=act(R.string.colleagues_ended) {repository.endColleague(colleague.id)}

    /** Opens a colleague's patient: recorded by the server, and only then are the plan and progress read. */
    fun open(patientId:String) {
        mutable.update {it.copy(opened=it.opened+(patientId to OpenedState.Opening))}
        viewModelScope.launch {
            val opened=try {repository.openColleaguePatient(patientId)} catch(e:CancellationException) {throw e} catch(_:Exception) {null}
            if(opened==null) {mutable.update {it.copy(opened=it.opened+(patientId to OpenedState.Unavailable))}; return@launch}
            mutable.update {it.copy(opened=it.opened+(patientId to OpenedState.Open(opened,null)))}
            val plan=try {repository.loadColleaguePlan(patientId)} catch(e:CancellationException) {throw e} catch(_:Exception) {emptyList()}
            mutable.update {it.copy(opened=it.opened+(patientId to OpenedState.Open(opened,plan)))}
        }
    }

    fun loadAccess(patientId:String) {
        viewModelScope.launch {
            try {val access=repository.loadColleagueAccess(patientId); mutable.update {it.copy(access=it.access+(patientId to access))}}
            catch(e:CancellationException) {throw e} catch(_:Exception) {}
        }
    }

    fun loadSharing() {
        viewModelScope.launch {
            try {val granted=repository.loadColleagueSharing(); mutable.update {it.copy(sharing=granted)}}
            catch(e:CancellationException) {throw e} catch(_:Exception) {}
        }
    }
    fun setSharing(granted:Boolean) {
        val before=mutable.value.sharing
        mutable.update {it.copy(sharing=granted)}
        viewModelScope.launch {
            try {
                mutable.update {it.copy(sharing=repository.setColleagueSharing(granted))}
                toasts.show(if(granted) R.string.colleagues_sharing_turned_on else R.string.colleagues_sharing_turned_off)
            } catch(e:CancellationException) {throw e}
            catch(e:Exception) {mutable.update {it.copy(sharing=before)}; toasts.show(colleagueRefusal(e),ToastTone.ERROR)}
        }
    }
}
