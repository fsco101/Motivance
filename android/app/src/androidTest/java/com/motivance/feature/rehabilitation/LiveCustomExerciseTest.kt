package com.motivance.feature.rehabilitation

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.motivance.BuildConfig
import com.motivance.data.local.ExerciseJson
import com.motivance.data.local.SessionDatabase
import com.motivance.data.local.SessionStore
import com.motivance.data.remote.SupabaseAuthRepository
import com.motivance.data.sync.SessionSync
import com.motivance.domain.*
import java.util.UUID
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * A custom exercise from the therapist's form to an uploaded session, through the app's real repository, cache and
 * upload code against the local backend. Skipped unless scripts/test_custom_exercises.py passes disposable accounts.
 */
@RunWith(AndroidJUnit4::class)
class LiveCustomExerciseTest {
    private val context:Context=ApplicationProvider.getApplicationContext()
    private val args=InstrumentationRegistry.getArguments()
    private lateinit var db:SessionDatabase
    private lateinit var store:SessionStore

    @Before fun setup() {
        assumeTrue(args.getString("patientId")!=null)
        db=Room.inMemoryDatabaseBuilder(context,SessionDatabase::class.java).build();store=SessionStore(db)
    }
    @After fun cleanup() {if(::db.isInitialized) db.close()}

    @Test fun aCustomExerciseReachesThePatientAndItsResultReachesTheTherapist()=runBlocking {
        val patientId=args.getString("patientId")!!
        val patient=SupabaseAuthRepository(OkHttpClient(),BuildConfig.SUPABASE_URL,BuildConfig.SUPABASE_PUBLISHABLE_KEY,true,store,null)
        val therapist=SupabaseAuthRepository(OkHttpClient(),BuildConfig.SUPABASE_URL,BuildConfig.SUPABASE_PUBLISHABLE_KEY,true)
        patient.signIn(args.getString("patientEmail")!!,args.getString("patientPassword")!!)
        therapist.signIn(args.getString("therapistEmail")!!,args.getString("therapistPassword")!!)

        val draft=CustomExerciseDraft(UUID.randomUUID().toString()," Seated knee extension ",BodyJoint.KNEE,"Sit tall and straighten the knee.","Umupo nang tuwid at ituwid ang tuhod.")
        val version=therapist.createCustomExercise(draft)
        assertEquals("A retry returns the same exercise",version,therapist.createCustomExercise(draft))
        val listed=therapist.loadWorkspace().catalogue.single {it.id==version}
        assertTrue(listed.custom && listed.selectable)
        assertEquals(BodyJoint.KNEE,listed.joint)
        assertEquals("Seated knee extension",listed.name)

        therapist.publishPrescription(PrescriptionDraft(UUID.randomUUID().toString(),UUID.randomUUID().toString(),patientId,version,BodySide.RIGHT,15.0,80.0,6))
        patient.loadWorkspace()
        val cached=store.dao.prescriptions(patientId).first().single()
        val rules=ExerciseJson.rules(cached.rulesJson)
        assertEquals(ExerciseKind.CUSTOM,rules.kind)
        assertEquals(BodyJoint.KNEE,rules.measuredJoint)
        assertEquals("Seated knee extension",rules.exerciseName)
        assertTrue(cached.instructions.contains("Umupo nang tuwid"))

        val grant=store.recordConsent(patientId,true)
        val session=UUID.randomUUID().toString()
        store.save(patientId,session,rules,AssessmentSnapshot(minimumDegrees=10.0,maximumDegrees=85.0,completed=6,durationMs=1000,validFrames=40),grant.occurredAt,"COMPLETED")
        SessionSync(store,patient).drain(patientId)
        assertEquals("SYNCED",store.dao.outbox(patientId).single {it.sessionId==session}.state)

        val page=therapist.loadHistory(HistoryQuery(patientId))
        assertEquals("Seated knee extension",page.sessions.single().prescription?.exerciseName)

        // Retiring it stops new assignments only: the name stays on the plan and the patient keeps the exercise.
        therapist.archiveCustomExercise(listed.exerciseId)
        assertFalse(therapist.loadWorkspace().catalogue.single {it.id==version}.selectable)
        patient.loadWorkspace()
        assertEquals(cached.versionId,store.dao.prescriptions(patientId).first().single().versionId)
    }
}
