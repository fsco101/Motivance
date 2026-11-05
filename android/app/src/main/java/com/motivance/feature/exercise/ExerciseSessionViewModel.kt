package com.motivance.feature.exercise

import android.os.SystemClock
import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.motivance.BuildConfig
import com.motivance.R
import com.motivance.assessment.MovementAssessment
import com.motivance.data.local.*
import com.motivance.designsystem.Toaster
import com.motivance.designsystem.ToastTone
import com.motivance.domain.*
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import com.motivance.data.sync.SyncScheduler
import java.util.UUID
import javax.inject.Inject
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

data class ExerciseSessionState(
    val rules:ExerciseRules=ExerciseRules(), val metrics:AssessmentSnapshot=AssessmentSnapshot(),
    val id:String?=null,val saving:Boolean=false,val saved:Boolean=false,val error:Boolean=false,
    val recoverable:LocalSession?=null,val history:List<LocalSession> = emptyList(),val cached:List<CachedPrescription> = emptyList()
)
@HiltViewModel class ExerciseSessionViewModel @Inject constructor(private val store:SessionStore,@ApplicationContext private val context:Context,private val toasts:Toaster=Toaster()):ViewModel() {
    private val mutable=MutableStateFlow(ExerciseSessionState())
    val state=mutable.asStateFlow()
    private var engine=MovementAssessment(ExerciseRules())
    private var owner=""
    private var startedAt=0L
    private var lastCheckpoint=0L
    private var observeJob:Job?=null
    private var cacheJob:Job?=null
    private var lifecycleRevision=0L
    private val writes=Mutex()
    fun configure(account:String) {
        if(owner==account) return
        interrupt()
        owner=account; engine=MovementAssessment(ExerciseRules()); mutable.value=ExerciseSessionState()
        observeJob?.cancel(); cacheJob?.cancel()
        observeJob=viewModelScope.launch {
            store.recover(account)
            store.dao.observe(account).collect { rows ->
                if(owner==account) mutable.value=mutable.value.copy(history=rows,recoverable=recoverable(rows,mutable.value.cached,mutable.value.id))
            }
        }
        cacheJob=viewModelScope.launch { store.dao.prescriptions(account).collect { rows -> if(owner==account) applyCache(rows) } }
    }
    /** One state write, so nothing can observe the new assignments alongside the old demo rules. */
    private fun applyCache(rows:List<CachedPrescription>) {
        val current=mutable.value
        val adopted=assigned(rows).takeIf {current.rules.demo && current.id==null && !current.saving && !current.saved}
        if(adopted!=null) engine=MovementAssessment(adopted)
        mutable.value=current.copy(cached=rows,rules=adopted ?: current.rules,metrics=if(adopted!=null) engine.snapshot else current.metrics,
            recoverable=recoverable(current.history,rows,current.id))
    }
    private fun prescribed(p:CachedPrescription):ExerciseRules? {
        if(p.ownerId!=owner || p.patientId!=owner || p.expiresAt<=System.currentTimeMillis()) return null
        return ExerciseJson.rules(p.rulesJson).takeIf {!it.demo && it.prescriptionVersionId==p.versionId}
    }
    /** Demo thresholds are only for an account with no valid assignment; [preferred] keeps the one already in use. */
    private fun assigned(rows:List<CachedPrescription>,preferred:String?=null):ExerciseRules? {
        val valid=rows.mapNotNull {prescribed(it)}
        return valid.firstOrNull {it.prescriptionVersionId==preferred} ?: valid.firstOrNull()
    }
    private fun recoverable(rows:List<LocalSession>,cached:List<CachedPrescription>,active:String?):LocalSession? {
        val hasAssignment=assigned(cached)!=null
        return rows.firstOrNull {it.status!="COMPLETED" && it.id!=active && !(hasAssignment && ExerciseJson.rules(it.rulesJson).demo)}
    }
    fun select(kind:ExerciseKind,side:BodySide) {
        if(mutable.value.id!=null || mutable.value.saving || !mutable.value.rules.demo) return
        val rules=ExerciseRules(kind=kind,side=side)
        engine=MovementAssessment(rules); mutable.value=mutable.value.copy(rules=rules,metrics=engine.snapshot,saved=false,error=false)
    }
    fun usePrescription(p:CachedPrescription) {
        if(mutable.value.id!=null) return
        val rules=prescribed(p) ?: return
        engine=MovementAssessment(rules); mutable.value=mutable.value.copy(rules=rules,metrics=engine.snapshot,error=false)
    }
    fun frame(people:List<List<Landmark>>,width:Int,height:Int,time:Long) {
        if(owner.isBlank() || mutable.value.saving || mutable.value.saved) return
        val metrics=engine.process(people,width,height,time)
        mutable.value=mutable.value.copy(metrics=metrics)
        if(metrics.running && time-lastCheckpoint>=500) { lastCheckpoint=time; persist("DRAFT") }
    }
    fun start(consent:Boolean) {
        val current=mutable.value
        if(!consent || current.saving || current.saved || owner.isBlank() || (current.rules.demo && !BuildConfig.DEBUG)) return
        if(!current.rules.demo && current.cached.none { it.versionId==current.rules.prescriptionVersionId && it.ownerId==owner && it.expiresAt>System.currentTimeMillis() }) return
        val account=owner
        val revision=lifecycleRevision
        mutable.value=current.copy(saving=true,error=false)
        viewModelScope.launch {
            try {
                val grant=if(current.rules.demo) null else if(current.id==null) store.recordConsent(account,true) else {
                    val row=store.dao.get(account,current.id)
                    store.dao.latestConsent(account)?.takeIf {it.event=="granted" && it.id==row?.consentId} ?: error("Consent changed; begin a new session")
                }
                if(owner!=account || mutable.value.id!=current.id || revision!=lifecycleRevision) return@launch
                if(!engine.start(SystemClock.uptimeMillis())) return@launch
                if(current.id==null) {startedAt=maxOf(System.currentTimeMillis(),grant?.occurredAt ?: 0); mutable.value=mutable.value.copy(id=UUID.randomUUID().toString())}
                mutable.value=mutable.value.copy(metrics=engine.snapshot)
                persist("DRAFT")
                toasts.show(R.string.toast_session_started)
            } catch(e:CancellationException) {throw e}
            catch(_:Exception) {if(owner==account) {mutable.value=mutable.value.copy(error=true); toasts.show(R.string.local_save_failed,ToastTone.ERROR)}}
            finally {if(owner==account) mutable.value=mutable.value.copy(saving=false)}
        }
    }
    fun interrupt() {
        lifecycleRevision++
        val metrics=engine.pause(SystemClock.uptimeMillis())
        mutable.value=mutable.value.copy(metrics=metrics)
        if(mutable.value.id!=null && !mutable.value.saved && !mutable.value.saving) persist("INTERRUPTED")
    }
    /** The person's own pause. [interrupt] also runs for lifecycle events, which are not announced. */
    fun pause() {
        interrupt()
        if(mutable.value.id!=null) toasts.show(R.string.toast_session_paused,ToastTone.INFO)
    }
    fun finish() {
        lifecycleRevision++
        if(mutable.value.id==null || mutable.value.saving || mutable.value.saved) return
        val metrics=engine.pause(SystemClock.uptimeMillis())
        mutable.value=mutable.value.copy(metrics=metrics,saving=true,error=false)
        persist("COMPLETED")
    }
    private fun persist(status:String) {
        val captured=mutable.value; val id=captured.id ?: return
        val account=owner; val start=startedAt
        viewModelScope.launch {
            try {
                writes.withLock { store.save(account,id,captured.rules,captured.metrics,start,status) }
                if(status=="COMPLETED") {
                    SyncScheduler.schedule(context,account)
                    if(owner==account && mutable.value.id==id) mutable.value=mutable.value.copy(saving=false,saved=true,error=false)
                    if(captured.rules.demo) toasts.show(R.string.toast_session_saved)
                    else toasts.show(R.string.toast_session_saved_pending,ToastTone.PENDING)
                }
            } catch(e: CancellationException) { throw e }
            catch(e: Exception) {
                if(owner==account && mutable.value.id==id) {
                    // Checkpoints repeat twice a second, so a persistent failure is reported once.
                    if(!mutable.value.error) toasts.show(R.string.local_save_failed,ToastTone.ERROR)
                    mutable.value=mutable.value.copy(saving=false,error=true)
                }
            }
        }
    }
    fun restore() {
        val row=mutable.value.recoverable ?: return
        if(row.ownerId!=owner) return
        val rules=ExerciseJson.rules(row.rulesJson)
        if(!rules.demo && mutable.value.cached.none { it.versionId==rules.prescriptionVersionId && it.expiresAt>System.currentTimeMillis() }) return
        engine=MovementAssessment(rules,ExerciseJson.snapshot(row.snapshotJson)); startedAt=row.startedAt
        mutable.value=mutable.value.copy(id=row.id,rules=rules,metrics=engine.snapshot,saved=false,error=false,recoverable=null)
        toasts.show(R.string.toast_session_restored,ToastTone.INFO)
    }
    fun newSession() {
        if(mutable.value.saving) return
        interrupt()
        val current=mutable.value
        val rules=assigned(current.cached,current.rules.prescriptionVersionId) ?: ExerciseRules()
        engine=MovementAssessment(rules)
        mutable.value=current.copy(id=null,rules=rules,metrics=engine.snapshot,saved=false,error=false)
    }
}
