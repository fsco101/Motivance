package com.motivance.feature.rehabilitation

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.motivance.data.local.*
import com.motivance.data.sync.SyncScheduler
import com.motivance.domain.*
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import java.util.UUID
import javax.inject.Inject
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

data class RehabilitationState(val owner:String="",val workspace:RehabWorkspace=RehabWorkspace(),val busy:Boolean=false,val failed:Boolean=false,val notice:Boolean=false,val invitation:String?=null,val outbox:List<OutboxEntry> = emptyList(),val consents:List<LocalConsent> = emptyList())

@HiltViewModel class RehabilitationViewModel @Inject constructor(private val repository:RehabilitationRepository,private val store:SessionStore,@ApplicationContext private val context:Context):ViewModel() {
    private val mutable=MutableStateFlow(RehabilitationState())
    val state=mutable.asStateFlow()
    private var observers:Job?=null
    private var action:Job?=null
    private val privacyIds=mutableMapOf<String,String>()
    fun configure(owner:String?) {
        if(mutable.value.owner==owner.orEmpty()) return
        observers?.cancel(); action?.cancel(); privacyIds.clear()
        mutable.value=RehabilitationState(owner=owner.orEmpty())
        if(owner==null) return
        observers=viewModelScope.launch {
            launch {store.dao.observeOutbox(owner).collect {if(mutable.value.owner==owner) mutable.value=mutable.value.copy(outbox=it)}}
            launch {store.dao.observeConsents(owner).collect {if(mutable.value.owner==owner) mutable.value=mutable.value.copy(consents=it)}}
        }
        SyncScheduler.schedule(context,owner)
        refresh()
    }
    private fun perform(refresh:Boolean=true,block:suspend ()->Unit) {
        val owner=mutable.value.owner
        if(owner.isBlank() || mutable.value.busy) return
        mutable.value=mutable.value.copy(busy=true,failed=false,notice=false)
        action=viewModelScope.launch {
            try {
                block()
                val data=if(refresh) repository.loadWorkspace() else null
                if(mutable.value.owner==owner) mutable.value=mutable.value.copy(workspace=data ?: mutable.value.workspace,notice=true)
            } catch(e:CancellationException) {throw e}
            catch(_:Exception) {if(mutable.value.owner==owner) mutable.value=mutable.value.copy(failed=true)}
            finally {if(mutable.value.owner==owner) mutable.value=mutable.value.copy(busy=false)}
        }
    }
    fun refresh()=perform { }
    fun invite(email:String)=perform(false) {
        require(email.trim().matches(Regex("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")))
        val owner=mutable.value.owner; val code=repository.invitePatient(email)
        if(mutable.value.owner==owner) mutable.value=mutable.value.copy(invitation=code)
    }
    fun accept(code:String)=perform {require(code.trim().matches(Regex("[a-fA-F0-9]{48}"))); repository.acceptInvitation(code)}
    fun revoke(patient:String)=perform {repository.revokeLink(patient)}
    fun prescribe(draft:PrescriptionDraft)=perform {
        ExerciseRules(side=draft.side,lowDegrees=draft.low,highDegrees=draft.high,targetRepetitions=draft.repetitions,minimumCycleMs=draft.minimumCycleMs,maximumCycleMs=draft.maximumCycleMs,peakHoldMs=draft.peakHoldMs,maxTrunkLeanDegrees=draft.maxTrunkLean,confidence=draft.confidence.toFloat())
        repository.publishPrescription(draft)
    }
    fun synchronize()=perform(false) {
        val owner=mutable.value.owner
        store.dao.retryFailed(owner); store.dao.retryConsents(owner); SyncScheduler.schedule(context,owner)
    }
    fun withdraw()=perform(false) {val owner=mutable.value.owner; store.recordConsent(owner,false); SyncScheduler.schedule(context,owner)}
    fun request(kind:String)=perform {
        require(kind in setOf("export","delete"))
        repository.requestPatientData(privacyIds.getOrPut(kind) {UUID.randomUUID().toString()},kind)
    }
}
