package com.motivance.feature.exercise

import android.os.SystemClock
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.motivance.BuildConfig
import com.motivance.assessment.MovementAssessment
import com.motivance.data.local.*
import com.motivance.domain.*
import dagger.hilt.android.lifecycle.HiltViewModel
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
@HiltViewModel class ExerciseSessionViewModel @Inject constructor(private val store:SessionStore):ViewModel() {
    private val mutable=MutableStateFlow(ExerciseSessionState())
    val state=mutable.asStateFlow()
    private var engine=MovementAssessment(ExerciseRules())
    private var owner=""
    private var startedAt=0L
    private var lastCheckpoint=0L
    private var observeJob:Job?=null
    private var cacheJob:Job?=null
    private val writes=Mutex()
    fun configure(account:String) {
        if(owner==account) return
        interrupt()
        owner=account; engine=MovementAssessment(ExerciseRules()); mutable.value=ExerciseSessionState()
        observeJob?.cancel(); cacheJob?.cancel()
        observeJob=viewModelScope.launch {
            store.recover(account)
            store.dao.observe(account).collect { rows ->
                if(owner==account) mutable.value=mutable.value.copy(history=rows,recoverable=rows.firstOrNull { it.status!="COMPLETED" && it.id!=mutable.value.id })
            }
        }
        cacheJob=viewModelScope.launch { store.dao.prescriptions(account).collect { rows -> if(owner==account) mutable.value=mutable.value.copy(cached=rows) } }
    }
    fun select(kind:ExerciseKind,side:BodySide) {
        if(mutable.value.id!=null || mutable.value.saving) return
        val rules=ExerciseRules(kind=kind,side=side)
        engine=MovementAssessment(rules); mutable.value=mutable.value.copy(rules=rules,metrics=engine.snapshot,saved=false,error=false)
    }
    fun usePrescription(p:CachedPrescription) {
        if(mutable.value.id!=null || p.ownerId!=owner || p.patientId!=owner || p.expiresAt<=System.currentTimeMillis()) return
        val rules=ExerciseJson.rules(p.rulesJson)
        if(rules.demo || rules.prescriptionVersionId!=p.versionId) return
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
        if(!engine.start(SystemClock.uptimeMillis())) return
        if(current.id==null) { startedAt=System.currentTimeMillis(); mutable.value=current.copy(id=UUID.randomUUID().toString(),error=false) }
        mutable.value=mutable.value.copy(metrics=engine.snapshot)
        persist("DRAFT")
    }
    fun interrupt() {
        val metrics=engine.pause(SystemClock.uptimeMillis())
        mutable.value=mutable.value.copy(metrics=metrics)
        if(mutable.value.id!=null && !mutable.value.saved && !mutable.value.saving) persist("INTERRUPTED")
    }
    fun finish() {
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
                if(owner==account && mutable.value.id==id && status=="COMPLETED") mutable.value=mutable.value.copy(saving=false,saved=true,error=false)
            } catch(e: CancellationException) { throw e }
            catch(e: Exception) { if(owner==account && mutable.value.id==id) mutable.value=mutable.value.copy(saving=false,error=true) }
        }
    }
    fun restore() {
        val row=mutable.value.recoverable ?: return
        if(row.ownerId!=owner) return
        val rules=ExerciseJson.rules(row.rulesJson)
        if(!rules.demo && mutable.value.cached.none { it.versionId==rules.prescriptionVersionId && it.expiresAt>System.currentTimeMillis() }) return
        engine=MovementAssessment(rules,ExerciseJson.snapshot(row.snapshotJson)); startedAt=row.startedAt
        mutable.value=mutable.value.copy(id=row.id,rules=rules,metrics=engine.snapshot,saved=false,error=false,recoverable=null)
    }
    fun newSession() {
        if(mutable.value.saving) return
        interrupt(); engine=MovementAssessment(ExerciseRules())
        mutable.value=mutable.value.copy(id=null,rules=ExerciseRules(),metrics=engine.snapshot,saved=false,error=false)
    }
}
