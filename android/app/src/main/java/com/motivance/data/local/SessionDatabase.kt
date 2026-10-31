package com.motivance.data.local

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Entity(tableName="local_sessions",indices=[Index("ownerId")])
data class LocalSession(@PrimaryKey val id:String,val ownerId:String,val rulesJson:String,val snapshotJson:String,val status:String,val startedAt:Long,val updatedAt:Long,val endedAt:Long?=null)
@Entity(tableName="sync_outbox",foreignKeys=[ForeignKey(entity=LocalSession::class,parentColumns=["id"],childColumns=["sessionId"],onDelete=ForeignKey.CASCADE)],indices=[Index("ownerId")])
data class OutboxEntry(@PrimaryKey val sessionId:String,val ownerId:String,val state:String,val payloadJson:String)
@Entity(tableName="cached_prescriptions",primaryKeys=["ownerId","versionId"])
data class CachedPrescription(val ownerId:String,val versionId:String,val assignmentId:String,val patientId:String,val rulesJson:String,val instructions:String,val expiresAt:Long)

@Dao interface SessionDao {
    @Insert(onConflict=OnConflictStrategy.REPLACE) suspend fun put(session:LocalSession)
    @Insert(onConflict=OnConflictStrategy.ABORT) suspend fun enqueue(entry:OutboxEntry)
    @Insert(onConflict=OnConflictStrategy.REPLACE) suspend fun cache(prescription:CachedPrescription)
    @Query("SELECT * FROM local_sessions WHERE ownerId=:owner ORDER BY updatedAt DESC") fun observe(owner:String):Flow<List<LocalSession>>
    @Query("SELECT * FROM cached_prescriptions WHERE ownerId=:owner") fun prescriptions(owner:String):Flow<List<CachedPrescription>>
    @Query("SELECT * FROM local_sessions WHERE ownerId=:owner AND id=:id") suspend fun get(owner:String,id:String):LocalSession?
    @Query("SELECT * FROM cached_prescriptions WHERE ownerId=:owner AND versionId=:version") suspend fun cached(owner:String,version:String):CachedPrescription?
    @Query("SELECT * FROM sync_outbox WHERE ownerId=:owner") suspend fun outbox(owner:String):List<OutboxEntry>
    @Query("UPDATE local_sessions SET status='INTERRUPTED',updatedAt=:time WHERE ownerId=:owner AND status='DRAFT'") suspend fun interruptDrafts(owner:String,time:Long)
    @Query("DELETE FROM cached_prescriptions WHERE ownerId=:owner") suspend fun clearPrescriptions(owner:String)
}
@Database(entities=[LocalSession::class,OutboxEntry::class,CachedPrescription::class],version=1,exportSchema=true)
abstract class SessionDatabase:RoomDatabase() { abstract fun sessions():SessionDao }
