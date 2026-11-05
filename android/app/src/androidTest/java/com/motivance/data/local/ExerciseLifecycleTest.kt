package com.motivance.data.local

import androidx.room.Room
import androidx.room.withTransaction
import androidx.lifecycle.viewModelScope
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import com.motivance.domain.Landmark
import com.motivance.feature.exercise.ExerciseSessionViewModel
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.junit.*
import org.junit.Assert.*
import java.util.UUID

class ExerciseLifecycleTest {
    @Test fun aPrescribedSessionReportsStartPauseAndPendingUpload()=runBlocking {
        val context:android.content.Context=ApplicationProvider.getApplicationContext()
        val db=Room.inMemoryDatabaseBuilder(context,SessionDatabase::class.java).build()
        val store=SessionStore(db)
        val toasts=com.motivance.designsystem.Toaster()
        val vm=ExerciseSessionViewModel(store,context,toasts)
        suspend fun toasted(message:Int)=withTimeout(10_000) {toasts.current.first {it?.message==message}}!!
        try {
            val owner=UUID.randomUUID().toString()
            val main=InstrumentationRegistry.getInstrumentation()
            main.runOnMainSync {vm.configure(owner)}
            val rules=com.motivance.domain.ExerciseRules(demo=false,prescriptionVersionId=UUID.randomUUID().toString())
            val cached=CachedPrescription(owner,rules.prescriptionVersionId!!,"assignment",owner,ExerciseJson.rules(rules),"Fixture",System.currentTimeMillis()+60000,System.currentTimeMillis())
            store.cache(cached)
            withTimeout(10_000) {vm.state.first {it.cached.isNotEmpty()}}
            val p=MutableList(33) {Landmark(.5f,.5f,1f)}
            p[11]=Landmark(.5f,.2f,1f);p[13]=Landmark(.5f,.4f,1f);p[15]=Landmark(.5f,.6f,1f);p[23]=Landmark(.5f,.8f,1f)
            main.runOnMainSync {
                vm.usePrescription(cached)
                val now=android.os.SystemClock.uptimeMillis()
                repeat(6) {vm.frame(listOf(p),640,480,now-6+it)}
                vm.start(true)
            }
            toasted(com.motivance.R.string.toast_session_started)
            withTimeout(10_000) {vm.state.first {it.id!=null && !it.saving}}
            main.runOnMainSync {vm.pause()}
            toasted(com.motivance.R.string.toast_session_paused)
            delay(200)
            main.runOnMainSync {vm.finish()}
            assertEquals(com.motivance.designsystem.ToastTone.PENDING,toasted(com.motivance.R.string.toast_session_saved_pending).tone)
        } finally {main().runOnMainSync {vm.viewModelScope.cancel()};db.close()}
    }
    private fun main()=InstrumentationRegistry.getInstrumentation()
    @Test fun backgroundWhileConsentWriteIsPendingCannotStartMeasurementLater()=runBlocking {
        val context:android.content.Context=ApplicationProvider.getApplicationContext()
        val name="lifecycle-${UUID.randomUUID()}.db"
        val db=Room.databaseBuilder(context,SessionDatabase::class.java,name).addMigrations(SessionMigrations.FROM_1_TO_2).build()
        val store=SessionStore(db)
        val vm=ExerciseSessionViewModel(store,context)
        try {
            val owner=UUID.randomUUID().toString()
            val main=InstrumentationRegistry.getInstrumentation()
            main.runOnMainSync {vm.configure(owner)}
            delay(200)
            val rules=com.motivance.domain.ExerciseRules(demo=false,prescriptionVersionId=UUID.randomUUID().toString())
            val cached=CachedPrescription(owner,rules.prescriptionVersionId!!,"assignment",owner,ExerciseJson.rules(rules),"Fixture",System.currentTimeMillis()+60000,System.currentTimeMillis())
            store.cache(cached);delay(200)
            val p=MutableList(33) {Landmark(.5f,.5f,1f)}
            p[11]=Landmark(.5f,.2f,1f);p[13]=Landmark(.5f,.4f,1f);p[15]=Landmark(.5f,.6f,1f);p[23]=Landmark(.5f,.8f,1f)
            main.runOnMainSync {
                vm.usePrescription(cached)
                val now=android.os.SystemClock.uptimeMillis()
                repeat(6) {vm.frame(listOf(p),640,480,now-6+it)}
            }
            val locked=CompletableDeferred<Unit>();val release=CompletableDeferred<Unit>()
            val transaction=launch(Dispatchers.IO) {db.withTransaction {locked.complete(Unit);release.await()}}
            locked.await()
            main.runOnMainSync {vm.start(true)}
            main.runOnMainSync {vm.interrupt()}
            release.complete(Unit);transaction.join()
            withTimeout(10000) {while(vm.state.value.saving) delay(20)}
            assertFalse(vm.state.value.metrics.running)
            assertNull(vm.state.value.id)
        } finally {
            vm.viewModelScope.coroutineContext[Job]?.cancelAndJoin()
            db.close();context.deleteDatabase(name)
        }
    }
}
