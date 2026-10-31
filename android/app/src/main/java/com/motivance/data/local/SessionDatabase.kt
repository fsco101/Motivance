package com.motivance.data.local

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Entity(tableName="local_sessions",indices=[Index("ownerId")])
data class LocalSession(@PrimaryKey val id:String,val ownerId:String,val rulesJson:String,val snapshotJson:String,val status:String,val startedAt:Long,val updatedAt:Long,val endedAt:Long?=null,@ColumnInfo(defaultValue="NULL") val consentId:String?=null)
@Entity(tableName="sync_outbox",foreignKeys=[ForeignKey(entity=LocalSession::class,parentColumns=["id"],childColumns=["sessionId"],onDelete=ForeignKey.CASCADE)],indices=[Index("ownerId")])
data class OutboxEntry(@PrimaryKey val sessionId:String,val ownerId:String,val state:String,val payloadJson:String,@ColumnInfo(defaultValue="0") val attempts:Int=0,@ColumnInfo(defaultValue="NULL") val lastError:String?=null)
@Entity(tableName="cached_prescriptions",primaryKeys=["ownerId","versionId"])
data class CachedPrescription(val ownerId:String,val versionId:String,val assignmentId:String,val patientId:String,val rulesJson:String,val instructions:String,val expiresAt:Long,@ColumnInfo(defaultValue="0") val cachedAt:Long=0)

@Entity(tableName="consent_events",indices=[Index("ownerId")])
data class LocalConsent(@PrimaryKey val id:String,val ownerId:String,val event:String,val version:String,val occurredAt:Long,val state:String="PENDING",val attempts:Int=0,val lastError:String?=null)

@Dao interface SessionDao {
    @Insert(onConflict=OnConflictStrategy.REPLACE) suspend fun put(session:LocalSession)
    @Insert(onConflict=OnConflictStrategy.ABORT) suspend fun enqueue(entry:OutboxEntry)
    @Insert(onConflict=OnConflictStrategy.REPLACE) suspend fun cache(prescription:CachedPrescription)
    @Insert(onConflict=OnConflictStrategy.ABORT) suspend fun consent(event:LocalConsent)
    @Query("SELECT * FROM local_sessions WHERE ownerId=:owner ORDER BY updatedAt DESC") fun observe(owner:String):Flow<List<LocalSession>>
    @Query("SELECT * FROM cached_prescriptions WHERE ownerId=:owner") fun prescriptions(owner:String):Flow<List<CachedPrescription>>
    @Query("SELECT * FROM local_sessions WHERE ownerId=:owner AND id=:id") suspend fun get(owner:String,id:String):LocalSession?
    @Query("SELECT * FROM cached_prescriptions WHERE ownerId=:owner AND versionId=:version") suspend fun cached(owner:String,version:String):CachedPrescription?
    @Query("SELECT * FROM sync_outbox WHERE ownerId=:owner") suspend fun outbox(owner:String):List<OutboxEntry>
    @Query("SELECT * FROM sync_outbox WHERE ownerId=:owner") fun observeOutbox(owner:String):Flow<List<OutboxEntry>>
    @Query("UPDATE sync_outbox SET state=:state,attempts=:attempts,lastError=:error WHERE ownerId=:owner AND sessionId=:id") suspend fun outboxState(owner:String,id:String,state:String,attempts:Int,error:String?)
    @Query("UPDATE sync_outbox SET state='PENDING',attempts=0,lastError=NULL WHERE ownerId=:owner AND state IN ('FAILED','WAITING_AUTH')") suspend fun retryFailed(owner:String)
    @Query("SELECT * FROM consent_events WHERE ownerId=:owner ORDER BY occurredAt DESC,rowid DESC LIMIT 1") suspend fun latestConsent(owner:String):LocalConsent?
    @Query("SELECT * FROM consent_events WHERE ownerId=:owner AND id=:id") suspend fun getConsent(owner:String,id:String):LocalConsent?
    @Query("SELECT * FROM consent_events WHERE ownerId=:owner AND state IN ('PENDING','RETRY','WAITING_AUTH') ORDER BY occurredAt") suspend fun pendingConsents(owner:String):List<LocalConsent>
    @Query("SELECT * FROM consent_events WHERE ownerId=:owner ORDER BY occurredAt DESC") fun observeConsents(owner:String):Flow<List<LocalConsent>>
    @Query("UPDATE consent_events SET state=:state,attempts=:attempts,lastError=:error WHERE ownerId=:owner AND id=:id") suspend fun consentState(owner:String,id:String,state:String,attempts:Int,error:String?)
    @Query("UPDATE consent_events SET state='PENDING',attempts=0,lastError=NULL WHERE ownerId=:owner AND state IN ('FAILED','WAITING_AUTH')") suspend fun retryConsents(owner:String)
    @Query("UPDATE local_sessions SET status='INTERRUPTED',updatedAt=:time WHERE ownerId=:owner AND status='DRAFT'") suspend fun interruptDrafts(owner:String,time:Long)
    @Query("DELETE FROM cached_prescriptions WHERE ownerId=:owner") suspend fun clearPrescriptions(owner:String)
}
@Database(entities=[LocalSession::class,OutboxEntry::class,CachedPrescription::class,LocalConsent::class],version=2,exportSchema=true)
abstract class SessionDatabase:RoomDatabase() { abstract fun sessions():SessionDao }
