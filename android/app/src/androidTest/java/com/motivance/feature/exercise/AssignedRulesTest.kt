package com.motivance.feature.exercise

import android.content.Context
import android.os.SystemClock
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.lifecycle.HasDefaultViewModelProviderFactory
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.LocalViewModelStoreOwner
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import com.motivance.R
import com.motivance.data.local.*
import com.motivance.designsystem.MotivanceTheme
import com.motivance.domain.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.junit.*
import org.junit.Assert.*
import java.util.UUID

/** A patient holding a valid assignment is measured against it, never against the demo thresholds. */
class AssignedRulesTest {
    @get:Rule val compose=createComposeRule()
    private val context:Context=ApplicationProvider.getApplicationContext()
    private val db=Room.inMemoryDatabaseBuilder(context,SessionDatabase::class.java).build()
    private val store=SessionStore(db)
    private val vm=ExerciseSessionViewModel(store,context)
    private val owner=UUID.randomUUID().toString()
    private val main=InstrumentationRegistry.getInstrumentation()

    @After fun cleanup()=runBlocking {
        vm.viewModelScope.coroutineContext[Job]?.cancelAndJoin()
        db.close()
    }

    private fun assignment(lifetimeMs:Long=60_000,kind:ExerciseKind=ExerciseKind.SHOULDER_ABDUCTION):CachedPrescription {
        val id=UUID.randomUUID().toString()
        val rules=ExerciseRules(kind=kind,side=BodySide.RIGHT,lowDegrees=30.0,highDegrees=70.0,targetRepetitions=8,demo=false,prescriptionVersionId=id,version="exercise-v2")
        val now=System.currentTimeMillis()
        return CachedPrescription(owner,id,"assignment-$id",owner,ExerciseJson.rules(rules),"Fixture instructions",now+lifetimeMs,now)
    }
    private suspend fun download(vararg rows:CachedPrescription) {
        rows.forEach {store.cache(it)}
        withTimeout(10_000) {vm.state.first {it.cached.size==rows.size}}
    }
    private fun configure() {main.runOnMainSync {vm.configure(owner)}}
    private fun assertUsing(p:CachedPrescription) {
        val rules=vm.state.value.rules
        assertFalse("The camera fell back to demo rules",rules.demo)
        assertEquals(p.versionId,rules.prescriptionVersionId)
    }

    @Test fun aValidAssignmentReplacesTheDemoRulesWhenTheCameraIsOpenedDirectly()=runBlocking {
        configure()
        val assigned=assignment()
        download(assigned)
        assertUsing(assigned)
    }

    @Test fun aNewSessionStaysOnTheAssignmentThatWasRunning()=runBlocking {
        configure()
        val first=assignment(); val second=assignment()
        download(first,second)
        main.runOnMainSync {vm.usePrescription(second);vm.newSession()}
        assertUsing(second)
        assertNull(vm.state.value.id)
    }

    @Test fun repeatingAFinishedAssignmentStartsAFreshPrescribedSession()=runBlocking {
        configure()
        val assigned=assignment()
        download(assigned)
        val pose=MutableList(33) {Landmark(.5f,.5f,1f)}
        pose[12]=Landmark(.5f,.2f,1f);pose[14]=Landmark(.5f,.4f,1f);pose[16]=Landmark(.5f,.6f,1f);pose[24]=Landmark(.5f,.8f,1f)
        main.runOnMainSync {
            vm.usePrescription(assigned)
            val now=SystemClock.uptimeMillis()
            repeat(6) {vm.frame(listOf(pose),640,480,now-6+it)}
            vm.start(true)
        }
        withTimeout(10_000) {vm.state.first {it.id!=null && !it.saving}}
        main.runOnMainSync {vm.finish()}
        withTimeout(10_000) {vm.state.first {it.saved}}
        main.runOnMainSync {vm.newSession()}
        val state=vm.state.value
        assertFalse(state.saved)
        assertNull(state.id)
        assertUsing(assigned)
    }

    @Test fun demoRulesRemainWhenTheOnlyAssignmentHasExpired()=runBlocking {
        configure()
        download(assignment(lifetimeMs=-1_000))
        assertTrue(vm.state.value.rules.demo)
        main.runOnMainSync {vm.newSession()}
        assertTrue(vm.state.value.rules.demo)
        assertNull(vm.state.value.rules.prescriptionVersionId)
    }

    @Test fun anInterruptedDemoSessionIsNotOfferedOverAnAssignment()=runBlocking {
        val leftover=UUID.randomUUID().toString()
        store.save(owner,leftover,ExerciseRules(),AssessmentSnapshot(),System.currentTimeMillis(),"INTERRUPTED")
        configure()
        withTimeout(10_000) {vm.state.first {it.recoverable?.id==leftover}}
        val assigned=assignment()
        download(assigned)
        assertNull(vm.state.value.recoverable)
        assertUsing(assigned)
    }

    @Test fun anInterruptedAssignedSessionIsStillOffered()=runBlocking {
        configure()
        val assigned=assignment()
        download(assigned)
        val grant=store.recordConsent(owner,true)
        val interrupted=UUID.randomUUID().toString()
        store.save(owner,interrupted,ExerciseJson.rules(assigned.rulesJson),AssessmentSnapshot(),grant.occurredAt,"INTERRUPTED")
        withTimeout(10_000) {vm.state.first {it.recoverable?.id==interrupted}}
        main.runOnMainSync {vm.restore()}
        assertEquals(interrupted,vm.state.value.id)
        assertUsing(assigned)
    }

    /** The real camera screen, as the patient reads it, for a patient who opened it without tapping an assignment. */
    @Test fun theCameraScreenShowsTheAssignmentAndNoDemoControls() {
        configure()
        val shoulder=assignment(); val elbow=assignment(kind=ExerciseKind.ELBOW_FLEXION)
        runBlocking {download(shoulder,elbow)}
        val store=object:ViewModelStoreOwner,HasDefaultViewModelProviderFactory {
            override val viewModelStore=ViewModelStore()
            override val defaultViewModelProviderFactory=object:ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST") override fun <T:ViewModel> create(modelClass:Class<T>)=vm as T
            }
        }
        compose.setContent {MotivanceTheme {CompositionLocalProvider(LocalViewModelStoreOwner provides store) {CameraPrototype(owner) {}}}}
        fun text(id:Int)=context.getString(id)
        fun switchLabel(p:CachedPrescription)=context.getString(R.string.use_cached_prescription,
            text(if(ExerciseJson.rules(p.rulesJson).kind==ExerciseKind.ELBOW_FLEXION) R.string.elbow_flexion else R.string.shoulder_abduction),text(R.string.right_side))

        compose.onNodeWithText(text(R.string.calc_source_prescribed_short)).assertExists()
        compose.onNodeWithText(text(R.string.prescribed_assessment_notice)).assertExists()
        compose.onNodeWithText(text(R.string.calc_source_demo_short)).assertDoesNotExist()
        compose.onNodeWithText(text(R.string.demo_assessment_notice)).assertDoesNotExist()
        compose.onNodeWithText(text(R.string.left_side)).assertDoesNotExist() // The demo side chips.

        // Only the other assignment is offered, named so the two can be told apart.
        val active=vm.state.value.rules.prescriptionVersionId
        val other=if(active==shoulder.versionId) elbow else shoulder
        val current=if(active==shoulder.versionId) shoulder else elbow
        compose.onNodeWithText(switchLabel(current)).assertDoesNotExist()
        compose.onNodeWithText(switchLabel(other)).performClick()
        compose.waitUntil(5_000) {vm.state.value.rules.prescriptionVersionId==other.versionId}
        compose.onNodeWithText(switchLabel(current)).assertExists()
    }
}
