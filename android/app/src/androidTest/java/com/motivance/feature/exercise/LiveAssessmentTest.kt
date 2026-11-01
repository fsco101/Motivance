package com.motivance.feature.exercise

import android.content.Context
import android.os.SystemClock
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewModelScope
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import com.motivance.R
import com.motivance.data.local.*
import com.motivance.designsystem.MotivanceTheme
import com.motivance.domain.*
import kotlinx.coroutines.*
import org.junit.*
import org.junit.Assert.*
import java.util.UUID
import kotlin.math.*

/** Real ViewModel/Room/UI flow with timed synthetic landmarks, not camera accuracy validation. */
class LiveAssessmentTest {
    @get:Rule val compose=createComposeRule()
    private val context:Context=ApplicationProvider.getApplicationContext()
    private val name="live-assessment-${UUID.randomUUID()}.db"
    private val db=Room.databaseBuilder(context,SessionDatabase::class.java,name).build()
    private val store=SessionStore(db)
    private val vm=ExerciseSessionViewModel(store,context)
    private val owner="synthetic-assessment-owner" // No real account/background network work.
    @After fun cleanup()=runBlocking {
        vm.viewModelScope.coroutineContext[Job]?.cancelAndJoin()
        db.close();context.deleteDatabase(name)
        Unit
    }
    private fun text(id:Int)=context.getString(id)
    private fun pose(angle:Double):List<Landmark> = MutableList(33) {Landmark(.5f,.5f,1f)}.apply {
        this[11]=Landmark(.5f,.3f,1f);this[23]=Landmark(.5f,.8f,1f);this[13]=Landmark(.5f,.5f,1f)
        this[15]=Landmark((.5+sin(Math.toRadians(angle))*.15).toFloat(),(.5+cos(Math.toRadians(angle))*.15).toFloat(),1f)
    }
    private fun frame(angle:Double) {compose.runOnIdle {vm.frame(listOf(pose(angle)),1000,1000,SystemClock.uptimeMillis())}}
    private fun cycle() {listOf(10.0,10.0,40.0,60.0,100.0,100.0,100.0,70.0,40.0,10.0,10.0).forEach {Thread.sleep(110);frame(it)}}
    private fun display(prescribed:Boolean) {
        val cached=if(prescribed) {
            val id=UUID.randomUUID().toString();val rules=ExerciseRules(demo=false,prescriptionVersionId=id)
            CachedPrescription(owner,id,"assignment",owner,ExerciseJson.rules(rules),"Synthetic instructions",System.currentTimeMillis()+60_000,System.currentTimeMillis()).also {runBlocking {store.cache(it)}}
        } else null
        InstrumentationRegistry.getInstrumentation().runOnMainSync {vm.configure(owner)}
        compose.setContent {MotivanceTheme {Surface {Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
            val state by vm.state.collectAsState();var consent by remember {mutableStateOf(false)}
            MeasurementControls(state,consent,false,true,{consent=it},{vm.start(consent || state.id!=null)},{vm.interrupt()})
            Text(stringResource(R.string.completed_reps,state.metrics.completed,state.rules.targetRepetitions))
        }}}}
        if(cached!=null) {
            compose.waitUntil(5000) {vm.state.value.cached.isNotEmpty()}
            compose.runOnIdle {vm.usePrescription(cached)}
        }
        repeat(6) {Thread.sleep(30);frame(10.0)}
    }
    private fun verifyFlow(prescribed:Boolean) {
        display(prescribed)
        cycle() // A visible, moving preview must not silently collect/count.
        assertEquals(0,vm.state.value.metrics.completed)
        compose.onNodeWithText(text(R.string.measurement_preview)).assertExists()
        val label=text(if(prescribed) R.string.sync_metrics_consent else R.string.local_metrics_consent)
        compose.onNodeWithContentDescription(label).performClick()
        frame(10.0)
        compose.onNodeWithText(text(R.string.start_measurement)).performClick()
        compose.waitUntil(5000) {vm.state.value.metrics.running && !vm.state.value.saving}
        compose.onNodeWithText(text(R.string.measurement_recording)).assertExists()
        cycle()
        compose.onNodeWithText(context.getString(R.string.completed_reps,1,5)).assertExists()
        compose.onNodeWithText(text(R.string.pause_measurement)).performClick()
        assertFalse(vm.state.value.metrics.running)
        cycle();assertEquals(1,vm.state.value.metrics.completed)
        compose.onNodeWithText(text(R.string.measurement_paused)).assertExists()
        compose.runOnIdle {vm.finish()}
        compose.waitUntil(5000) {vm.state.value.saved}
        runBlocking {
            val row=store.dao.get(owner,vm.state.value.id!!)!!
            assertEquals(1,ExerciseJson.snapshot(row.snapshotJson).completed)
            assertEquals(if(prescribed) "PENDING" else "LOCAL_ONLY",store.dao.outbox(owner).single().state)
        }
    }
    @Test fun debugDemoCountsAfterConsentAndStartAndStaysLocal() {verifyFlow(false)}
    @Test fun prescribedExerciseUsesTheSameCounterAndQueuesAResult() {verifyFlow(true)}
    @Test fun releaseDemoRestrictionHasAnExplanation() {
        compose.setContent {MotivanceTheme {MeasurementControls(ExerciseSessionState(metrics=AssessmentSnapshot(quality=TrackingQuality.READY)),true,false,false,{}, {}, {})}}
        compose.onNodeWithText(text(R.string.measurement_demo_unavailable)).assertExists()
        compose.onNodeWithText(text(R.string.start_measurement)).assertIsNotEnabled()
    }
}
