package com.motivance.data.local

import android.content.Context
import androidx.room.Room
import androidx.room.withTransaction
import com.motivance.domain.*
import dagger.hilt.android.qualifiers.ApplicationContext
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton
import org.json.JSONObject

@Singleton class SessionStore internal constructor(val database:SessionDatabase) {
    @Inject constructor(@ApplicationContext context:Context):this(Room.databaseBuilder(context,SessionDatabase::class.java,"motivance-sessions.db").build())
    val dao=database.sessions()
    suspend fun recover(owner:String)=dao.interruptDrafts(owner,System.currentTimeMillis())
    suspend fun save(owner:String,id:String,rules:ExerciseRules,snapshot:AssessmentSnapshot,startedAt:Long,status:String) {
        require(owner.isNotBlank()); UUID.fromString(id)
        require(status in setOf("DRAFT","INTERRUPTED","COMPLETED"))
        require(snapshot.completed>=0 && snapshot.incomplete>=0 && snapshot.durationMs>=0)
        database.withTransaction {
            val old=dao.get(owner,id)
            if(old?.status=="COMPLETED") return@withTransaction
            check(old==null || (old.rulesJson==ExerciseJson.rules(rules) && old.startedAt==startedAt)) { "Session prescription is immutable" }
            // IDs are global: never overwrite another account's record on collision.
            val conflict=database.openHelper.readableDatabase.query("SELECT ownerId FROM local_sessions WHERE id=?",arrayOf(id)).use { it.moveToFirst() && it.getString(0)!=owner }
            check(!conflict)
            val now=System.currentTimeMillis()
            val row=LocalSession(id,owner,ExerciseJson.rules(rules),ExerciseJson.snapshot(snapshot),status,startedAt,now,if(status=="COMPLETED") now else null)
            dao.put(row)
            if(status=="COMPLETED") {
                val payload=JSONObject().put("sessionId",id).put("ownerId",owner).put("rules",JSONObject(row.rulesJson)).put("metrics",JSONObject(row.snapshotJson)).put("startedAt",startedAt).put("endedAt",now).toString()
                dao.enqueue(OutboxEntry(id,owner,if(rules.demo) "LOCAL_ONLY" else "PENDING",payload))
            }
        }
    }
    suspend fun cache(p:CachedPrescription) {
        require(p.ownerId.isNotBlank() && p.patientId==p.ownerId)
        val rules=ExerciseJson.rules(p.rulesJson)
        require(!rules.demo && rules.prescriptionVersionId==p.versionId && p.instructions.isNotBlank())
        dao.cache(p)
    }
    suspend fun replaceCache(owner:String,prescriptions:List<CachedPrescription>) {
        require(prescriptions.all {it.ownerId==owner})
        database.withTransaction { dao.clearPrescriptions(owner); prescriptions.forEach {cache(it)} }
    }
    suspend fun clearCacheOnLogout(owner:String) { database.withTransaction { dao.clearPrescriptions(owner); dao.interruptDrafts(owner,System.currentTimeMillis()) } }
}
