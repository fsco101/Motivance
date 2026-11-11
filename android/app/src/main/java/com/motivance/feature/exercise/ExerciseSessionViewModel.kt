package com.motivance.feature.exercise

import android.os.SystemClock
import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.motivance.BuildConfig
import com.motivance.R
import com.motivance.assessment.MovementAssessment
import com.motivance.assessment.RepOutcome
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
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** One repetition result. [sequence] grows with every result, so two alike still read as two. */
data class RepResult(val outcome:RepOutcome,val sequence:Int)
data class ExerciseSessionState(
    val rules:ExerciseRules=ExerciseRules(), val metrics:AssessmentSnapshot=AssessmentSnapshot(),
    val id:String?=null,val saving:Boolean=false,val saved:Boolean=false,val error:Boolean=false,
    val recoverable:LocalSession?=null,val history:List<LocalSession> = emptyList(),val cached:List<CachedPrescription> = emptyList(),
    /** The latest result of active measurement; the engine's own feedback lasts a single frame. */
    val result:RepResult?=null,
    /** Start was pressed but tracking was lost before measurement could begin. */
    val startRefused:Boolean=false,
    /** Between two sides of a set: the finished side is saved and the next has not started. */
    val switching:SideSwitch?=null,
    /** Sides finished in this run, in order, for the completion screen. */
    val sides:List<SideResult> = emptyList(),
)
@HiltViewModel class ExerciseSessionViewModel @Inject constructor(private val store:SessionStore,@ApplicationContext private val context:Context,private val toasts:Toaster=Toaster()):ViewModel() {
    private val mutable=MutableStateFlow(ExerciseSessionState())
    val state=mutable.asStateFlow()
    // One event per result for the voice. Nothing is replayed to a new listener, so a rotation never repeats a phrase,
    // and a slow listener hears the latest result rather than a backlog.
    private val announcements=MutableSharedFlow<RepOutcome>(extraBufferCapacity=1,onBufferOverflow=BufferOverflow.DROP_OLDEST)
    val results:SharedFlow<RepOutcome> = announcements.asSharedFlow()
    // The set's own announcements. Also never replayed; a short buffer keeps the countdown in order behind a slow listener.
    private val setCues=MutableSharedFlow<SetCue>(extraBufferCapacity=8,onBufferOverflow=BufferOverflow.DROP_OLDEST)
    val cues:SharedFlow<SetCue> = setCues.asSharedFlow()
    private var engine=MovementAssessment(ExerciseRules())
    private var owner=""
    private var startedAt=0L
    private var lastCheckpoint=0L
    private var observeJob:Job?=null
    private var cacheJob:Job?=null
    /** The announcement fallback or the countdown, whichever is running. */
    private var switchJob:Job?=null
    private var beginning=false
    private var lifecycleRevision=0L
    private var resultSequence=0
    private val writes=Mutex()
    fun configure(account:String) {
        if(owner==account) return
        interrupt()
        switchJob?.cancel()
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
        if(mutable.value.id!=null || mutable.value.saving || mutable.value.switching!=null || !mutable.value.rules.demo) return
        val rules=ExerciseRules(kind=kind,side=side)
        engine=MovementAssessment(rules); mutable.value=mutable.value.copy(rules=rules,metrics=engine.snapshot,saved=false,error=false)
    }
    fun usePrescription(p:CachedPrescription) {
        if(mutable.value.id!=null || mutable.value.switching!=null) return
        val rules=prescribed(p) ?: return
        engine=MovementAssessment(rules); mutable.value=mutable.value.copy(rules=rules,metrics=engine.snapshot,error=false)
    }
    fun frame(people:List<List<Landmark>>,width:Int,height:Int,time:Long) {
        if(owner.isBlank() || mutable.value.saving || mutable.value.saved) return
        val before=engine.snapshot
        val metrics=engine.process(people,width,height,time)
        val outcome=RepOutcome.between(before,metrics)
        mutable.value=mutable.value.copy(metrics=metrics,result=outcome?.let {RepResult(it,++resultSequence)} ?: mutable.value.result)
        outcome?.let(announcements::tryEmit)
        val current=mutable.value
        if(current.switching==null && current.id!=null) when(val event=SideSet.evaluate(current.rules,before,metrics)) {
            SetEvent.TargetReached -> setCues.tryEmit(SetCue.TargetReached)
            is SetEvent.SideEnded -> {endSide(event.next); return}
            SetEvent.SetComplete -> {endSide(null); return}
            null -> {}
        }
        if(current.switching?.stage==SwitchStage.WAITING_FOR_TRACKING && metrics.quality==TrackingQuality.READY) beginNextSide()
        if(metrics.running && time-lastCheckpoint>=500) { lastCheckpoint=time; persist("DRAFT") }
    }
    fun start(consent:Boolean) {
        val current=mutable.value
        if(!consent || current.saving || current.saved || current.switching!=null || owner.isBlank() || (current.rules.demo && !BuildConfig.DEBUG)) return
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
                // Tracking can drop while consent is saved; say so instead of leaving Start looking pressed.
                if(!engine.start(SystemClock.uptimeMillis())) {mutable.value=mutable.value.copy(startRefused=true); return@launch}
                if(current.id==null) {startedAt=maxOf(System.currentTimeMillis(),grant?.occurredAt ?: 0); mutable.value=mutable.value.copy(id=UUID.randomUUID().toString())}
                mutable.value=mutable.value.copy(metrics=engine.snapshot,startRefused=false)
                persist("DRAFT")
                toasts.show(R.string.toast_session_started)
            } catch(e:CancellationException) {throw e}
            catch(_:Exception) {if(owner==account) {mutable.value=mutable.value.copy(error=true); toasts.show(R.string.local_save_failed,ToastTone.ERROR)}}
            finally {if(owner==account) mutable.value=mutable.value.copy(saving=false)}
        }
    }
    /**
     * Ends the side being measured. The last side ends the set like Finish; otherwise the side is saved on its own and the
     * next one is announced, then starts after the countdown. Each side is its own session under the same consent.
     */
    private fun endSide(next:BodySide?) {
        lifecycleRevision++
        val finished=engine.pause(SystemClock.uptimeMillis())
        val current=mutable.value
        val sides=current.sides+SideResult(current.rules.side,current.rules.targetRepetitions,finished)
        if(next==null) {
            mutable.value=current.copy(metrics=finished,sides=sides,saving=true,error=false)
            persist("COMPLETED")
            setCues.tryEmit(SetCue.Complete)
            return
        }
        persist("COMPLETED",current.copy(metrics=finished),quiet=true)
        val rules=current.rules.copy(side=next)
        engine=MovementAssessment(rules)
        mutable.value=current.copy(id=null,rules=rules,metrics=engine.snapshot,result=null,startRefused=false,sides=sides,
            switching=SideSwitch(next,SwitchStage.ANNOUNCING))
        setCues.tryEmit(SetCue.SideDone(current.rules.side,next))
        switchJob?.cancel()
        // Without word from the voice, the countdown starts anyway.
        switchJob=viewModelScope.launch {delay(SideSet.ANNOUNCEMENT_LIMIT_MS); announced()}
    }
    /** The next-side announcement has been spoken, or there is no voice to wait for: start the countdown. */
    fun announced() {
        val switch=mutable.value.switching ?: return
        if(switch.stage!=SwitchStage.ANNOUNCING) return
        mutable.value=mutable.value.copy(switching=switch.copy(stage=SwitchStage.COUNTING))
        switchJob?.cancel()
        switchJob=viewModelScope.launch {
            for(n in SideSet.COUNTDOWN_SECONDS downTo 1) {
                mutable.value.switching?.let {mutable.value=mutable.value.copy(switching=it.copy(secondsLeft=n))}
                setCues.tryEmit(SetCue.Count(n))
                delay(1000)
            }
            setCues.tryEmit(SetCue.Go)
            mutable.value.switching?.let {mutable.value=mutable.value.copy(switching=it.copy(stage=SwitchStage.WAITING_FOR_TRACKING))}
            beginNextSide()
        }
    }
    /** Holds the countdown until the patient presses Start. */
    fun pauseSwitch() {
        val switch=mutable.value.switching ?: return
        switchJob?.cancel()
        mutable.value=mutable.value.copy(switching=switch.copy(stage=SwitchStage.PAUSED))
    }
    fun startNextSide() {
        val switch=mutable.value.switching ?: return
        if(switch.stage!=SwitchStage.PAUSED) return
        mutable.value=mutable.value.copy(switching=switch.copy(stage=SwitchStage.WAITING_FOR_TRACKING))
        beginNextSide()
    }
    /**
     * Starts the next side under the consent the patient gave at the first Start. A withdrawal since then is never overridden:
     * the switch ends and the normal consent and Start controls return. Until tracking is ready, later frames try again.
     */
    private fun beginNextSide() {
        if(beginning) return
        val account=owner; val revision=lifecycleRevision
        beginning=true
        viewModelScope.launch {
            try {
                val consent=store.dao.latestConsent(account)
                if(owner!=account || revision!=lifecycleRevision || mutable.value.switching?.stage!=SwitchStage.WAITING_FOR_TRACKING) return@launch
                if(consent?.event!="granted") {mutable.value=mutable.value.copy(switching=null); return@launch}
                if(!engine.start(SystemClock.uptimeMillis())) return@launch
                startedAt=maxOf(System.currentTimeMillis(),consent.occurredAt)
                mutable.value=mutable.value.copy(id=UUID.randomUUID().toString(),metrics=engine.snapshot,switching=null,startRefused=false)
                persist("DRAFT")
                toasts.show(R.string.toast_session_started)
            } finally {beginning=false}
        }
    }
    fun interrupt() {
        lifecycleRevision++
        // Leaving the app holds a countdown rather than starting a side nobody is watching.
        mutable.value.switching?.takeIf {it.stage!=SwitchStage.PAUSED}?.let {switchJob?.cancel(); mutable.value=mutable.value.copy(switching=it.copy(stage=SwitchStage.PAUSED))}
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
        val current=mutable.value
        // Between sides, the finished side is already saved: the set simply ends there.
        if(current.switching!=null) {
            switchJob?.cancel()
            val last=current.sides.last()
            mutable.value=current.copy(switching=null,saved=true,rules=current.rules.copy(side=last.side),metrics=last.metrics)
            toasts.show(R.string.toast_session_saved_pending,ToastTone.PENDING)
            return
        }
        if(current.id==null || current.saving || current.saved) return
        val metrics=engine.pause(SystemClock.uptimeMillis())
        mutable.value=current.copy(metrics=metrics,saving=true,error=false,sides=current.sides+SideResult(current.rules.side,current.rules.targetRepetitions,metrics))
        persist("COMPLETED")
    }
    /** Saves [captured]. A [quiet] save is a finished side mid-set: it is queued for upload without ending the run. */
    private fun persist(status:String,captured:ExerciseSessionState=mutable.value,quiet:Boolean=false) {
        val id=captured.id ?: return
        val account=owner; val start=startedAt
        viewModelScope.launch {
            try {
                writes.withLock { store.save(account,id,captured.rules,captured.metrics,start,status) }
                if(status=="COMPLETED") {
                    SyncScheduler.schedule(context,account)
                    if(quiet) return@launch
                    if(owner==account && mutable.value.id==id) mutable.value=mutable.value.copy(saving=false,saved=true,error=false)
                    if(captured.rules.demo) toasts.show(R.string.toast_session_saved)
                    else toasts.show(R.string.toast_session_saved_pending,ToastTone.PENDING)
                }
            } catch(e: CancellationException) { throw e }
            catch(e: Exception) {
                if(owner==account && (quiet || mutable.value.id==id)) {
                    // Checkpoints repeat twice a second, so a persistent failure is reported once.
                    if(!mutable.value.error) toasts.show(R.string.local_save_failed,ToastTone.ERROR)
                    mutable.value=if(quiet) mutable.value.copy(error=true) else mutable.value.copy(saving=false,error=true)
                }
            }
        }
    }
    fun restore() {
        val row=mutable.value.recoverable ?: return
        if(row.ownerId!=owner || mutable.value.switching!=null) return
        val rules=ExerciseJson.rules(row.rulesJson)
        if(!rules.demo && mutable.value.cached.none { it.versionId==rules.prescriptionVersionId && it.expiresAt>System.currentTimeMillis() }) return
        engine=MovementAssessment(rules,ExerciseJson.snapshot(row.snapshotJson)); startedAt=row.startedAt
        mutable.value=mutable.value.copy(id=row.id,rules=rules,metrics=engine.snapshot,saved=false,error=false,recoverable=null,sides=emptyList())
        toasts.show(R.string.toast_session_restored,ToastTone.INFO)
    }
    fun newSession() {
        if(mutable.value.saving) return
        interrupt()
        switchJob?.cancel()
        val current=mutable.value
        val rules=assigned(current.cached,current.rules.prescriptionVersionId) ?: ExerciseRules()
        engine=MovementAssessment(rules)
        mutable.value=current.copy(id=null,rules=rules,metrics=engine.snapshot,saved=false,error=false,result=null,startRefused=false,switching=null,sides=emptyList())
    }
}
