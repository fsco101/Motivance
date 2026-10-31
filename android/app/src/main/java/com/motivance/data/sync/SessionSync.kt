package com.motivance.data.sync

import android.content.Context
import androidx.work.*
import com.motivance.data.local.SessionStore
import com.motivance.domain.RehabilitationRepository
import com.motivance.domain.RemoteFailure
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import org.json.JSONObject

data class SyncDecision(val state:String,val retry:Boolean,val code:String)
object SyncFailures {
    const val MAX_ATTEMPTS=8
    fun classify(error:Exception,attempt:Int):SyncDecision=when {
        error is RemoteFailure && error.authenticationRequired -> SyncDecision("WAITING_AUTH",false,"sign_in_required")
        error is RemoteFailure && !error.retryable -> SyncDecision("REJECTED",false,"http_${error.status}")
        error is IOException || error is RemoteFailure -> if(attempt>=MAX_ATTEMPTS) SyncDecision("FAILED",false,"retry_limit") else SyncDecision("RETRY",true,"network_or_service")
        else -> SyncDecision("REJECTED",false,"invalid_payload_or_configuration")
    }
}

/** Stable stored payloads survive lost acknowledgements; only server acknowledgement marks SYNCED. */
class SessionSync(private val store:SessionStore,private val remote:RehabilitationRepository) {
    suspend fun drain(owner:String):Boolean {
        var retry=false
        for(event in store.dao.pendingConsents(owner)) {
            try {
                remote.uploadConsent(owner,event.id,event.event,event.version,event.occurredAt)
                store.dao.consentState(owner,event.id,"SYNCED",event.attempts+1,null)
            } catch(e:CancellationException) {throw e}
            catch(e:Exception) {
                val decision=SyncFailures.classify(e,event.attempts+1)
                store.dao.consentState(owner,event.id,decision.state,event.attempts+1,decision.code)
                retry=retry || decision.retry
                if(decision.state=="WAITING_AUTH" || decision.retry) return retry
            }
        }
        for(item in store.dao.outbox(owner).filter {it.state in setOf("PENDING","RETRY","WAITING_AUTH")}) {
            try {
                val consentId=JSONObject(item.payloadJson).getString("consentId")
                val consent=store.dao.getConsent(owner,consentId)
                if(consent?.state!="SYNCED") {
                    if(consent==null || consent.state in setOf("FAILED","REJECTED")) store.dao.outboxState(owner,item.sessionId,"REJECTED",item.attempts,"consent_unavailable")
                    continue
                }
                remote.uploadSession(owner,item.payloadJson)
                store.dao.outboxState(owner,item.sessionId,"SYNCED",item.attempts+1,null)
            } catch(e:CancellationException) {throw e}
            catch(e:Exception) {
                val decision=SyncFailures.classify(e,item.attempts+1)
                store.dao.outboxState(owner,item.sessionId,decision.state,item.attempts+1,decision.code)
                retry=retry || decision.retry
                if(decision.state=="WAITING_AUTH") break
            }
        }
        return retry
    }
}

@EntryPoint @InstallIn(SingletonComponent::class)
interface SyncServices {fun sessionStore():SessionStore; fun rehabilitationRepository():RehabilitationRepository}

class SessionSyncWorker(context:Context,parameters:WorkerParameters):CoroutineWorker(context,parameters) {
    override suspend fun doWork():Result {
        val owner=inputData.getString("owner") ?: return Result.failure()
        val services=EntryPointAccessors.fromApplication(applicationContext,SyncServices::class.java)
        return try {
            if(SessionSync(services.sessionStore(),services.rehabilitationRepository()).drain(owner)) Result.retry() else Result.success()
        } catch(e:CancellationException) {throw e}
        catch(_:Exception) {if(runAttemptCount<7) Result.retry() else Result.failure()}
    }
}

object SyncScheduler {
    fun schedule(context:Context,owner:String) {
        if(runCatching {UUID.fromString(owner)}.isFailure) return
        val constraints=Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val data=workDataOf("owner" to owner)
        val manager=WorkManager.getInstance(context)
        manager.enqueueUniqueWork("session-sync-$owner",ExistingWorkPolicy.KEEP,
            OneTimeWorkRequestBuilder<SessionSyncWorker>().setInputData(data).setConstraints(constraints).setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.SECONDS).build())
        manager.enqueueUniquePeriodicWork("session-sync-periodic-$owner",ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<SessionSyncWorker>(15,TimeUnit.MINUTES).setInputData(data).setConstraints(constraints).setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.SECONDS).build())
    }
}
