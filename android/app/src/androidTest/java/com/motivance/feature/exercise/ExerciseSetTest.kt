package com.motivance.feature.exercise

import android.os.SystemClock
import androidx.lifecycle.viewModelScope
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import com.motivance.data.local.*
import com.motivance.domain.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.junit.*
import org.junit.Assert.*
import java.util.Collections
import java.util.UUID

/**
 * A both-sides prescription with a time per side, run through the real ViewModel and Room store: the left side ends on time,
 * the phone announces the right side and counts down, then measures it as a second session under the same consent.
 */
class ExerciseSetTest {
    private val context:android.content.Context=ApplicationProvider.getApplicationContext()
    private val main=InstrumentationRegistry.getInstrumentation()
    private val db=Room.inMemoryDatabaseBuilder(context,SessionDatabase::class.java).build()
    private val store=SessionStore(db)
    private val vm=ExerciseSessionViewModel(store,context)
    private val owner=UUID.randomUUID().toString()
    private val cues=Collections.synchronizedList(mutableListOf<SetCue>())
    private val listening=CoroutineScope(Dispatchers.Default)
    // Both arms upright and fully visible, so either side tracks as ready.
    private val pose=MutableList(33) {Landmark(.5f,.5f,1f)}.apply {
        this[11]=Landmark(.45f,.2f,1f);this[13]=Landmark(.45f,.4f,1f);this[15]=Landmark(.45f,.6f,1f);this[23]=Landmark(.45f,.8f,1f)
        this[12]=Landmark(.55f,.2f,1f);this[14]=Landmark(.55f,.4f,1f);this[16]=Landmark(.55f,.6f,1f);this[24]=Landmark(.55f,.8f,1f)
    }
    private lateinit var cached:CachedPrescription

    @Before fun setUp()=runBlocking {
        main.runOnMainSync {vm.configure(owner)}
        val rules=ExerciseRules(demo=false,prescriptionVersionId=UUID.randomUUID().toString(),bilateral=true,sideSeconds=15)
        cached=CachedPrescription(owner,rules.prescriptionVersionId!!,"assignment",owner,ExerciseJson.rules(rules),"Fixture",System.currentTimeMillis()+600_000,System.currentTimeMillis())
        store.cache(cached)
        withTimeout(10_000) {vm.state.first {it.cached.isNotEmpty()}}
        listening.launch {vm.cues.collect {cues+=it}}
        Unit
    }
    @After fun tearDown() {listening.cancel(); main.runOnMainSync {vm.viewModelScope.cancel()}; db.close()}

    private fun frame()=main.runOnMainSync {vm.frame(listOf(pose),640,480,SystemClock.uptimeMillis())}
    /** Feeds camera frames until [done] holds, as the camera would. */
    private suspend fun feedUntil(timeoutMs:Long,done:(ExerciseSessionState)->Boolean):ExerciseSessionState {
        val end=SystemClock.uptimeMillis()+timeoutMs
        while(!done(vm.state.value)) {
            check(SystemClock.uptimeMillis()<end) {"Timed out in state ${vm.state.value.switching} id=${vm.state.value.id}"}
            frame(); delay(50)
        }
        return vm.state.value
    }
    private suspend fun feedFor(ms:Long) {val end=SystemClock.uptimeMillis()+ms; while(SystemClock.uptimeMillis()<end) {frame(); delay(50)}}
    private suspend fun startLeft() {
        main.runOnMainSync {vm.usePrescription(cached)}
        repeat(8) {frame(); delay(30)}
        main.runOnMainSync {vm.start(true)}
        feedUntil(10_000) {it.id!=null && it.metrics.running && !it.saving}
    }
    private suspend fun completed()=store.dao.observe(owner).first().filter {it.status=="COMPLETED"}

    @Test fun aTimedBothSetRunsLeftThenRight()=runBlocking {
        startLeft()
        val switching=feedUntil(25_000) {it.switching!=null}
        assertEquals(SideSwitch(BodySide.RIGHT,SwitchStage.ANNOUNCING),switching.switching)
        assertNull(switching.id)
        val left=withTimeout(10_000) {while(completed().isEmpty()) delay(50); completed()}.single()
        assertEquals(BodySide.LEFT,ExerciseJson.rules(left.rulesJson).side)
        assertTrue(ExerciseJson.rules(left.rulesJson).bilateral)
        main.runOnMainSync {vm.announced()}
        assertEquals(SwitchStage.COUNTING,vm.state.value.switching?.stage)
        val right=feedUntil(12_000) {it.switching==null && it.id!=null}
        assertEquals(BodySide.RIGHT,right.rules.side)
        val done=feedUntil(25_000) {it.saved}
        assertEquals(listOf(BodySide.LEFT,BodySide.RIGHT),done.sides.map {it.side})
        val rows=withTimeout(10_000) {while(completed().size<2) delay(50); completed()}
        assertEquals(1,rows.map {ExerciseJson.rules(it.rulesJson).prescriptionVersionId}.toSet().size)
        assertEquals(1,rows.map {it.consentId}.toSet().size)
        assertNotNull(rows.first().consentId)
        delay(300)
        val heard=synchronized(cues) {cues.toList()}
        val countdown=listOf(SetCue.SideDone(BodySide.LEFT,BodySide.RIGHT))+(5 downTo 1).map {SetCue.Count(it)}+SetCue.Go
        assertEquals(countdown,heard.filter {it !is SetCue.TargetReached && it!=SetCue.Complete})
        assertEquals(SetCue.Complete,heard.last())
    }

    @Test fun pauseHoldsTheCountdownUntilStart()=runBlocking {
        startLeft()
        feedUntil(25_000) {it.switching?.stage==SwitchStage.ANNOUNCING}
        main.runOnMainSync {vm.announced(); vm.pauseSwitch()}
        val held=vm.state.value.switching!!
        assertEquals(SwitchStage.PAUSED,held.stage)
        feedFor(2_000)
        assertEquals(held,vm.state.value.switching)
        assertNull(vm.state.value.id)
        main.runOnMainSync {vm.startNextSide()}
        val right=feedUntil(10_000) {it.id!=null}
        assertEquals(BodySide.RIGHT,right.rules.side)
        assertNull(right.switching)
    }

    @Test fun theCountdownStartsWithoutTheVoiceAfterSixSeconds()=runBlocking {
        startLeft()
        feedUntil(25_000) {it.switching?.stage==SwitchStage.ANNOUNCING}
        feedFor(SideSet.ANNOUNCEMENT_LIMIT_MS+500)
        assertEquals(SwitchStage.COUNTING,vm.state.value.switching?.stage)
    }

    @Test fun withdrawnConsentStopsTheNextSide()=runBlocking {
        startLeft()
        feedUntil(25_000) {it.switching?.stage==SwitchStage.ANNOUNCING}
        store.recordConsent(owner,false)
        main.runOnMainSync {vm.announced()}
        feedUntil(10_000) {it.switching==null}
        feedFor(500)
        assertNull(vm.state.value.id)
        assertEquals("withdrawn",store.dao.latestConsent(owner)?.event)
    }

    @Test fun cuesAreNotReplayedToANewListener()=runBlocking {
        startLeft()
        feedUntil(25_000) {it.switching!=null}
        withTimeout(5_000) {while(SetCue.SideDone(BodySide.LEFT,BodySide.RIGHT) !in synchronized(cues) {cues.toList()}) delay(20)}
        assertTrue(vm.cues.replayCache.isEmpty())
    }

    @Test fun finishDuringTheCountdownEndsTheSet()=runBlocking {
        startLeft()
        feedUntil(25_000) {it.switching?.stage==SwitchStage.ANNOUNCING}
        main.runOnMainSync {vm.announced(); vm.finish()}
        val done=feedUntil(10_000) {it.saved}
        assertNull(done.switching)
        assertEquals(listOf(BodySide.LEFT),done.sides.map {it.side})
        assertEquals(BodySide.LEFT,done.rules.side)
        feedFor(6_500)
        assertNull(vm.state.value.id)
        assertEquals(1,completed().size)
    }
}
