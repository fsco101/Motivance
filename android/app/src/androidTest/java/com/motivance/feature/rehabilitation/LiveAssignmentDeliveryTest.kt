package com.motivance.feature.rehabilitation

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.motivance.BuildConfig
import com.motivance.R
import com.motivance.data.local.ExerciseJson
import com.motivance.data.local.SessionDatabase
import com.motivance.data.local.SessionStore
import com.motivance.data.remote.SupabaseAuthRepository
import com.motivance.designsystem.Toaster
import com.motivance.domain.BodySide
import com.motivance.domain.PrescriptionDraft
import java.util.UUID
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Therapist to patient across the real local backend. Skipped unless disposable synthetic accounts are passed as
 * instrumentation arguments (therapistEmail, therapistPassword, patientEmail, patientPassword, patientId).
 */
@RunWith(AndroidJUnit4::class)
class LiveAssignmentDeliveryTest {
    private val context:Context=ApplicationProvider.getApplicationContext()
    private val args=InstrumentationRegistry.getArguments()
    private lateinit var db:SessionDatabase
    private lateinit var store:SessionStore

    @Before fun setup() {
        assumeTrue(args.getString("patientId")!=null)
        db=Room.inMemoryDatabaseBuilder(context,SessionDatabase::class.java).build();store=SessionStore(db)
    }
    @After fun cleanup() {if(::db.isInitialized) db.close()}

    @Test fun whatATherapistPublishesReachesAPatientWhoStayedSignedIn()=runBlocking {
        val patient=args.getString("patientId")!!
        val toasts=Toaster()
        val patientRepository=SupabaseAuthRepository(OkHttpClient(),BuildConfig.SUPABASE_URL,BuildConfig.SUPABASE_PUBLISHABLE_KEY,true,store,null)
        val therapist=SupabaseAuthRepository(OkHttpClient(),BuildConfig.SUPABASE_URL,BuildConfig.SUPABASE_PUBLISHABLE_KEY,true)
        patientRepository.signIn(args.getString("patientEmail")!!,args.getString("patientPassword")!!)
        therapist.signIn(args.getString("therapistEmail")!!,args.getString("therapistPassword")!!)
        val vm=RehabilitationViewModel(patientRepository,store,context,toasts)
        suspend fun <T> step(name:String,wait:suspend ()->T):T=try {withTimeout(20_000) {wait()}}
            catch(e:kotlinx.coroutines.TimeoutCancellationException) {
                throw AssertionError("$name timed out: busy=${vm.state.value.busy} failed=${vm.state.value.failed} toast=${toasts.current.value} rows=${store.dao.prescriptions(patient).first().map {it.assignmentId.take(6) to ExerciseJson.rules(it.rulesJson).highDegrees}}")
            }
        suspend fun rows(name:String,accept:(List<com.motivance.data.local.CachedPrescription>)->Boolean)=step(name) {store.dao.prescriptions(patient).first(accept)}
        // Checks repeatedly like the open app does; a check made while the previous one is finishing is skipped by design.
        suspend fun delivered(name:String,accept:(List<com.motivance.data.local.CachedPrescription>)->Boolean)=step(name) {
            while(!accept(store.dao.prescriptions(patient).first())) {vm.syncAssignments();delay(250)}
            store.dao.prescriptions(patient).first()
        }

        vm.configure(patient)
        step("first load") {vm.state.first {!it.busy}}
        rows("empty list") {it.isEmpty()}

        val catalogue=therapist.loadWorkspace().catalogue
        val elbow=catalogue.first {it.algorithm=="elbow-flexion-v1"}.id
        val shoulder=catalogue.first {it.algorithm=="shoulder-abduction-v1"}.id
        val first=UUID.randomUUID().toString()
        fun draft(assignment:String,exercise:String,high:Double)=PrescriptionDraft(assignment,UUID.randomUUID().toString(),patient,exercise,BodySide.RIGHT,20.0,high,7)

        therapist.publishPrescription(draft(first,elbow,95.0))
        assertEquals(95.0,ExerciseJson.rules(delivered("first exercise") {it.size==1}.single().rulesJson).highDegrees,.001)
        step("new exercise toast") {toasts.current.first {it?.message==R.string.toast_new_assignment}}

        // A second exercise is its own assignment and must sit beside the first, not replace it.
        val second=UUID.randomUUID().toString()
        therapist.publishPrescription(draft(second,shoulder,120.0))
        assertEquals(setOf(first,second),delivered("second exercise") {it.size==2}.map {it.assignmentId}.toSet())

        // An edit is a new version of the same assignment: still two exercises, carrying the new target.
        therapist.publishPrescription(draft(first,elbow,110.0))
        delivered("edit") {list -> list.size==2 && list.any {ExerciseJson.rules(it.rulesJson).highDegrees==110.0}}

        therapist.revokeLink(patient)
        delivered("revoke") {it.isEmpty()};Unit
    }
}
