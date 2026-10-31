package com.motivance.data.local

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.motivance.domain.*
import com.motivance.assessment.MovementAssessment
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.first
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class SessionStoreTest {
    private lateinit var context:Context
    private lateinit var db:SessionDatabase
    private lateinit var store:SessionStore
    private val databaseName="sprint2-test-${UUID.randomUUID()}.db"
    private val owner="test-account-a"
    private val rules=ExerciseRules()
    private val metrics=AssessmentSnapshot(completed=3,incomplete=1,minimumDegrees=10.0,maximumDegrees=100.0,durationMs=4000,validFrames=50)
    @Before fun setup() { context=ApplicationProvider.getApplicationContext(); open() }
    private fun open() { db=Room.databaseBuilder(context,SessionDatabase::class.java,databaseName).build(); store=SessionStore(db) }
    @After fun cleanup() { db.close(); context.deleteDatabase(databaseName) }

    @Test fun completionAndOutboxAreAtomicAndRetrySafe()=runBlocking {
        val id=UUID.randomUUID().toString()
        store.save(owner,id,rules,metrics,100,"COMPLETED")
        store.save(owner,id,rules,metrics,100,"COMPLETED")
        assertEquals("COMPLETED",store.dao.get(owner,id)!!.status)
        assertEquals(1,store.dao.outbox(owner).size)
        assertEquals("LOCAL_ONLY",store.dao.outbox(owner).single().state)
        assertEquals(id,store.dao.outbox(owner).single().sessionId)
    }
    @Test fun failedOutboxInsertionRollsBackSession()=runBlocking {
        db.openHelper.writableDatabase.execSQL("CREATE TRIGGER fail_outbox BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(ABORT,'injected test failure'); END")
        val id=UUID.randomUUID().toString()
        assertTrue(runCatching {store.save(owner,id,rules,metrics,100,"COMPLETED")}.isFailure)
        assertNull(store.dao.get(owner,id)); assertTrue(store.dao.outbox(owner).isEmpty())
    }
    @Test fun sessionsAndOutboxAreIsolatedByAccount()=runBlocking {
        val id=UUID.randomUUID().toString()
        store.save(owner,id,rules,metrics,100,"COMPLETED")
        assertNull(store.dao.get("test-account-b",id)); assertTrue(store.dao.outbox("test-account-b").isEmpty())
        assertTrue(store.dao.observe("test-account-b").first().isEmpty())
        assertTrue(runCatching {store.save("test-account-b",id,rules,metrics,100,"DRAFT")}.isFailure)
    }
    @Test fun reopenedDatabaseRecoversDraftAsInterrupted()=runBlocking {
        val id=UUID.randomUUID().toString()
        store.save(owner,id,rules,metrics,100,"DRAFT")
        db.close(); open(); store.recover(owner)
        val recovered=store.dao.get(owner,id)!!
        assertEquals("INTERRUPTED",recovered.status)
        val engine=MovementAssessment(ExerciseJson.rules(recovered.rulesJson),ExerciseJson.snapshot(recovered.snapshotJson))
        assertFalse(engine.snapshot.running); assertEquals(3,engine.snapshot.completed)
        assertEquals(MovementPhase.SEEKING_START,engine.snapshot.phase)
        assertTrue(store.dao.outbox(owner).isEmpty())
    }
    @Test fun cachedInstructionsSurviveReopenAndLogoutKeepsPendingResults()=runBlocking {
        val prescribed=rules.copy(demo=false,prescriptionVersionId="prescription-v1")
        store.cache(CachedPrescription(owner,"prescription-v1","assignment",owner,ExerciseJson.rules(prescribed),"Test-only instruction",Long.MAX_VALUE))
        val id=UUID.randomUUID().toString()
        val grant=store.recordConsent(owner,true)
        store.save(owner,id,prescribed,metrics,grant.occurredAt,"COMPLETED")
        db.close(); open()
        assertEquals("Test-only instruction",store.dao.cached(owner,"prescription-v1")!!.instructions)
        assertNull(store.dao.cached("test-account-b","prescription-v1"))
        store.clearCacheOnLogout(owner)
        assertNull(store.dao.cached(owner,"prescription-v1"))
        assertEquals("PENDING",store.dao.outbox(owner).single().state)
        assertNotNull(store.dao.get(owner,id))
    }
    @Test fun activeSessionRulesCannotBeChanged()=runBlocking {
        val id=UUID.randomUUID().toString()
        store.save(owner,id,rules,metrics,100,"DRAFT")
        assertTrue(runCatching {store.save(owner,id,rules.copy(targetRepetitions=10),metrics,100,"DRAFT")}.isFailure)
        assertEquals(5,ExerciseJson.rules(store.dao.get(owner,id)!!.rulesJson).targetRepetitions)
    }
}
