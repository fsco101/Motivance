package com.motivance.data.local

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.motivance.data.sync.*
import com.motivance.domain.*
import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ConnectedPersistenceTest {
    private val context:Context=ApplicationProvider.getApplicationContext()
    private val name="connected-test-${UUID.randomUUID()}.db"
    private val owner=UUID.randomUUID().toString()
    private lateinit var db:SessionDatabase
    private lateinit var store:SessionStore
    private val rules=ExerciseRules(demo=false,prescriptionVersionId=UUID.randomUUID().toString())
    @Before fun setup() {open()}
    private fun open() {db=Room.databaseBuilder(context,SessionDatabase::class.java,name).addMigrations(SessionMigrations.FROM_1_TO_2).build();store=SessionStore(db)}
    @After fun cleanup() {db.close();context.deleteDatabase(name)}
    private suspend fun complete():String {
        val grant=store.recordConsent(owner,true); val id=UUID.randomUUID().toString()
        store.save(owner,id,rules,AssessmentSnapshot(),grant.occurredAt,"COMPLETED")
        return id
    }
    private class Remote:RehabilitationRepository {
        val sessions=mutableSetOf<String>(); val calls=mutableListOf<String>()
        var loseAck=true; var failure:Exception?=null
        override suspend fun uploadConsent(owner:String,id:String,event:String,version:String,occurredAt:Long) {calls+="consent";failure?.let {throw it}}
        override suspend fun uploadSession(owner:String,payload:String) {
            calls+="session";failure?.let {throw it};sessions+=JSONObject(payload).getString("sessionId")
            if(loseAck) {loseAck=false;throw IOException("Injected lost acknowledgement")}
        }
        override suspend fun loadWorkspace()=RehabWorkspace()
        override suspend fun loadHistory(query:HistoryQuery,cursor:HistoryCursor?)=HistoryPage(emptyList(),null)
        override suspend fun invitePatient(email:String)=""
        override suspend fun acceptInvitation(code:String) { }
        override suspend fun revokeLink(patientId:String) { }
        override suspend fun publishPrescription(draft:PrescriptionDraft) { }
        override suspend fun requestPatientData(id:String,kind:String) { }
    }
    @Test fun lostAcknowledgementAndProcessReopenUseExactlyTheStoredPayload()=runBlocking {
        val id=complete(); val payload=store.dao.outbox(owner).single().payloadJson
        val remote=Remote(); assertTrue(SessionSync(store,remote).drain(owner))
        assertEquals(listOf("consent","session"),remote.calls)
        assertEquals("RETRY",store.dao.outbox(owner).single().state)
        db.close();open()
        assertFalse(SessionSync(store,remote).drain(owner))
        val item=store.dao.outbox(owner).single()
        assertEquals("SYNCED",item.state);assertEquals(2,item.attempts);assertEquals(payload,item.payloadJson)
        assertEquals(setOf(id),remote.sessions)
    }
    @Test fun offlineQueueWaitsAndAuthenticationDoesNotDiscardResults()=runBlocking {
        complete(); val remote=Remote().apply {failure=IOException("Injected offline")}
        assertTrue(SessionSync(store,remote).drain(owner)); assertTrue(remote.sessions.isEmpty())
        remote.failure=RemoteFailure(401)
        assertFalse(SessionSync(store,remote).drain(owner))
        assertEquals("WAITING_AUTH",store.dao.pendingConsents(owner).single().state)
        remote.failure=null;remote.loseAck=false
        assertFalse(SessionSync(store,remote).drain(owner)); assertEquals("SYNCED",store.dao.outbox(owner).single().state)
    }
    @Test fun permanentRejectionDoesNotRetryOrAcknowledge()=runBlocking {
        complete(); val remote=Remote().apply {loseAck=false}
        // First acknowledge consent, then reject session ownership/access.
        store.dao.pendingConsents(owner).forEach {store.dao.consentState(owner,it.id,"SYNCED",1,null)}
        remote.failure=RemoteFailure(403)
        assertFalse(SessionSync(store,remote).drain(owner))
        assertEquals("REJECTED",store.dao.outbox(owner).single().state)
        val calls=remote.calls.size; SessionSync(store,remote).drain(owner);assertEquals(calls,remote.calls.size)
    }
    @Test fun recordingRequiresPriorConsentAndWithdrawalCreatesANewEvent()=runBlocking {
        val id=UUID.randomUUID().toString()
        assertTrue(runCatching {store.save(owner,id,rules,AssessmentSnapshot(),System.currentTimeMillis(),"DRAFT")}.isFailure)
        val grant=store.recordConsent(owner,true)
        assertEquals(grant.id,store.recordConsent(owner,true).id)
        val withdrawn=store.recordConsent(owner,false)
        assertNotEquals(grant.id,withdrawn.id);assertTrue(withdrawn.occurredAt>grant.occurredAt)
        assertTrue(runCatching {store.save(owner,id,rules,AssessmentSnapshot(),withdrawn.occurredAt,"DRAFT")}.isFailure)
        assertNull(store.dao.latestConsent("other-owner"))
    }
    @Test fun versionOneMigrationPreservesLegacyRecordsWithoutInventingConsent()=runBlocking {
        db.close();context.deleteDatabase(name)
        context.getDatabasePath(name).parentFile?.mkdirs()
        val assets=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().context.assets
        val schema=JSONObject(assets.open("com.motivance.data.local.SessionDatabase/1.json").bufferedReader().use {it.readText()}).getJSONObject("database")
        SQLiteDatabase.openOrCreateDatabase(context.getDatabasePath(name),null).use {old ->
            val entities=schema.getJSONArray("entities")
            for(i in 0 until entities.length()) {
                val entity=entities.getJSONObject(i);val table=entity.getString("tableName")
                old.execSQL(entity.getString("createSql").replace("\${TABLE_NAME}",table))
                val indexes=entity.optJSONArray("indices") ?: org.json.JSONArray()
                for(j in 0 until indexes.length()) old.execSQL(indexes.getJSONObject(j).getString("createSql").replace("\${TABLE_NAME}",table))
            }
            old.execSQL("INSERT INTO local_sessions(id,ownerId,rulesJson,snapshotJson,status,startedAt,updatedAt) VALUES('legacy',?,'{}','{}','COMPLETED',1,2)",arrayOf(owner))
            old.execSQL("INSERT INTO sync_outbox(sessionId,ownerId,state,payloadJson) VALUES('legacy',?,'PENDING','{}')",arrayOf(owner))
            old.version=1
        }
        open()
        assertEquals("COMPLETED",store.dao.get(owner,"legacy")!!.status)
        val entry=store.dao.outbox(owner).single();assertEquals("REVIEW_REQUIRED",entry.state);assertEquals(0,entry.attempts)
    }
    @Test fun protectedSessionStoreUsesEncryptedBytesAndClearRemovesThem() {
        // Isolated ContextWrapper gives the test its own no-backup file directory.
        val folder=java.io.File(context.cacheDir,"vault-${UUID.randomUUID()}").apply {mkdirs()}
        val isolated=object:android.content.ContextWrapper(context) {override fun getNoBackupFilesDir()=folder}
        val vault=SessionVault(isolated);val secret="synthetic-token-${UUID.randomUUID()}"
        try {
            vault.write(secret);assertEquals(secret,SessionVault(isolated).read())
            assertFalse(String(java.io.File(folder,"auth-session.bin").readBytes(),Charsets.ISO_8859_1).contains(secret))
            vault.clear();assertNull(vault.read())
        } finally {java.io.File(folder,"auth-session.bin").delete();folder.delete()}
    }
}
