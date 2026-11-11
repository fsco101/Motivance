package com.motivance.feature.rehabilitation

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.motivance.data.local.*
import com.motivance.R
import com.motivance.data.sync.SyncScheduler
import com.motivance.designsystem.Toaster
import com.motivance.designsystem.ToastTone
import com.motivance.domain.*
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import java.util.UUID
import javax.inject.Inject
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first

enum class RehabAction { REFRESH, INVITE, ACCEPT, REVOKE, PRESCRIBE, CREATE_EXERCISE, ARCHIVE_EXERCISE, SYNC, WITHDRAW, EXPORT, DELETE }

data class RehabilitationState(val owner:String="",val workspace:RehabWorkspace=RehabWorkspace(),val busy:Boolean=false,val activeAction:RehabAction?=null,val failed:Boolean=false,val invitation:String?=null,val outbox:List<OutboxEntry> = emptyList(),val consents:List<LocalConsent> = emptyList())

private fun RehabAction.doneToast()=when(this) {
    RehabAction.REFRESH -> R.string.toast_workspace_updated to ToastTone.SUCCESS
    RehabAction.INVITE -> R.string.toast_invitation_created to ToastTone.SUCCESS
    RehabAction.ACCEPT -> R.string.toast_therapist_connected to ToastTone.SUCCESS
    RehabAction.REVOKE -> R.string.toast_access_revoked to ToastTone.SUCCESS
    RehabAction.PRESCRIBE -> R.string.ui_prescription_published to ToastTone.SUCCESS
    RehabAction.CREATE_EXERCISE -> R.string.toast_exercise_created to ToastTone.SUCCESS
    RehabAction.ARCHIVE_EXERCISE -> R.string.toast_exercise_removed to ToastTone.SUCCESS
    RehabAction.SYNC -> R.string.ui_sync_queued to ToastTone.PENDING
    RehabAction.WITHDRAW -> R.string.consent_withdrawn to ToastTone.SUCCESS
    RehabAction.EXPORT, RehabAction.DELETE -> R.string.request_pending to ToastTone.PENDING
}

@HiltViewModel class RehabilitationViewModel @Inject constructor(private val repository:RehabilitationRepository,private val store:SessionStore,@ApplicationContext private val context:Context,private val toasts:Toaster=Toaster()):ViewModel() {
    private val mutable=MutableStateFlow(RehabilitationState())
    val state=mutable.asStateFlow()
    private var observers:Job?=null
    private var action:Job?=null
    private var background:Job?=null
    private var uploads:Map<String,String>?=null
    private val privacyIds=mutableMapOf<String,String>()
    fun configure(owner:String?) {
        if(mutable.value.owner==owner.orEmpty()) return
        observers?.cancel(); action?.cancel(); background?.cancel(); privacyIds.clear(); uploads=null
        mutable.value=RehabilitationState(owner=owner.orEmpty())
        if(owner==null) return
        observers=viewModelScope.launch {
            launch {store.dao.observeOutbox(owner).collect {if(mutable.value.owner==owner) {announceUploads(it); mutable.value=mutable.value.copy(outbox=it)}}}
            launch {store.dao.observeConsents(owner).collect {if(mutable.value.owner==owner) mutable.value=mutable.value.copy(consents=it)}}
        }
        SyncScheduler.schedule(context,owner)
        refresh()
    }
    /** The background worker finishes uploads after the screen has moved on, so results are reported as they change. */
    private fun announceUploads(rows:List<OutboxEntry>) {
        val known=uploads
        uploads=rows.associate {it.sessionId to it.state}
        if(known==null) return
        val changed=rows.filter {it.state!=(known[it.sessionId] ?: "PENDING")}.map {it.state}
        when {
            changed.any {it=="FAILED" || it=="REJECTED"} -> toasts.show(R.string.toast_upload_failed,ToastTone.ERROR)
            "WAITING_AUTH" in changed -> toasts.show(R.string.toast_upload_sign_in,ToastTone.INFO)
            "SYNCED" in changed -> toasts.show(R.string.toast_session_uploaded)
        }
    }
    private suspend fun assignments(owner:String)=store.dao.prescriptions(owner).first().map {it.versionId}.toSet()
    private fun perform(kind:RehabAction=RehabAction.REFRESH,refresh:Boolean=true,announce:Boolean=true,done:()->Unit={},block:suspend ()->Unit) {
        val owner=mutable.value.owner
        if(owner.isBlank() || mutable.value.busy) return
        background?.cancel()
        if(announce) toasts.show(kind.loadingLabel(),ToastTone.PENDING)
        mutable.value=mutable.value.copy(busy=true,activeAction=kind,failed=false)
        action=viewModelScope.launch {
            try {
                val before=assignments(owner)
                block()
                val data=if(refresh) repository.loadWorkspace() else null
                if(mutable.value.owner==owner) {
                    mutable.value=mutable.value.copy(workspace=data ?: mutable.value.workspace)
                    if(announce) {
                        val (message,tone)=if(kind==RehabAction.REFRESH && (assignments(owner)-before).isNotEmpty()) R.string.toast_new_assignment to ToastTone.INFO else kind.doneToast()
                        toasts.show(message,tone)
                    }
                    done()
                }
            } catch(e:CancellationException) {throw e}
            catch(_:Exception) {
                if(mutable.value.owner==owner) {
                    mutable.value=mutable.value.copy(failed=true,workspace=RehabWorkspace())
                    if(announce) toasts.show(R.string.connected_failed,ToastTone.ERROR)
                }
            }
            finally {if(mutable.value.owner==owner) mutable.value=mutable.value.copy(busy=false,activeAction=null)}
        }
    }
    /** Reloads without feedback, for loads the person did not ask for. */
    fun refresh()=perform(announce=false) { }
    /** A refresh the person asked for, reported like any other action. */
    fun refreshNow()=perform { }
    /**
     * Picks up what a therapist published while this app was open. Runs behind the page: no spinner, and a failed
     * attempt leaves the screen as it was, because the next attempt follows shortly and offline use is normal.
     */
    fun syncAssignments() {
        val owner=mutable.value.owner
        if(owner.isBlank() || mutable.value.busy || background?.isActive==true) return
        background=viewModelScope.launch {
            try {
                val before=assignments(owner)
                val data=repository.loadWorkspace()
                if(mutable.value.owner==owner && !mutable.value.busy) {
                    mutable.value=mutable.value.copy(workspace=data,failed=false)
                    if((assignments(owner)-before).isNotEmpty()) toasts.show(R.string.toast_new_assignment,ToastTone.INFO)
                }
            } catch(e:CancellationException) {throw e}
            catch(_:Exception) {}
        }
    }
    fun invite(email:String)=perform(RehabAction.INVITE,false) {
        require(email.trim().matches(Regex("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")))
        val owner=mutable.value.owner; val code=repository.invitePatient(email)
        if(mutable.value.owner==owner) mutable.value=mutable.value.copy(invitation=code)
    }
    fun accept(code:String)=perform(RehabAction.ACCEPT) {require(code.trim().matches(Regex("[a-fA-F0-9]{48}"))); repository.acceptInvitation(code)}
    fun revoke(patient:String)=perform(RehabAction.REVOKE) {repository.revokeLink(patient)}
    fun prescribe(draft:PrescriptionDraft,published:()->Unit={})=perform(RehabAction.PRESCRIBE,done=published) {
        ExerciseRules(side=draft.side,lowDegrees=draft.low,highDegrees=draft.high,targetRepetitions=draft.repetitions,minimumCycleMs=draft.minimumCycleMs,maximumCycleMs=draft.maximumCycleMs,peakHoldMs=draft.peakHoldMs,maxTrunkLeanDegrees=draft.maxTrunkLean,confidence=draft.confidence.toFloat(),bilateral=draft.bilateral,sideSeconds=draft.sideSeconds)
        repository.publishPrescription(draft)
    }
    /** [created] receives the published version, once the refreshed list contains it. */
    fun createExercise(draft:CustomExerciseDraft,created:(String)->Unit={}) {
        var version=""
        perform(RehabAction.CREATE_EXERCISE,done={created(version)}) {
            require(draft.valid)
            version=repository.createCustomExercise(draft)
        }
    }
    fun archiveExercise(exerciseId:String)=perform(RehabAction.ARCHIVE_EXERCISE) {repository.archiveCustomExercise(exerciseId)}
    fun synchronize()=perform(RehabAction.SYNC,false) {
        val owner=mutable.value.owner
        store.dao.retryFailed(owner); store.dao.retryConsents(owner); SyncScheduler.schedule(context,owner)
    }
    fun withdraw()=perform(RehabAction.WITHDRAW,false) {val owner=mutable.value.owner; store.recordConsent(owner,false); SyncScheduler.schedule(context,owner)}
    fun request(kind:String)=perform(if(kind=="export") RehabAction.EXPORT else RehabAction.DELETE) {
        require(kind in setOf("export","delete"))
        repository.requestPatientData(privacyIds.getOrPut(kind) {UUID.randomUUID().toString()},kind)
    }
}
