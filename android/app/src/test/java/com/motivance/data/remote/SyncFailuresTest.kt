package com.motivance.data.remote

import com.motivance.data.sync.SyncFailures
import com.motivance.domain.RemoteFailure
import java.io.IOException
import org.junit.Assert.*
import org.junit.Test

class SyncFailuresTest {
    @Test fun authenticationWaitsWithoutRetryStorm() {val d=SyncFailures.classify(RemoteFailure(401),1);assertEquals("WAITING_AUTH",d.state);assertFalse(d.retry)}
    @Test fun transientFailuresAreBoundedAtEightAttempts() {assertTrue(SyncFailures.classify(IOException(),7).retry);assertEquals("FAILED",SyncFailures.classify(IOException(),8).state)}
    @Test fun validationOwnershipAndConflictFailuresArePermanent() {for(code in listOf(400,403,409,422)) {val d=SyncFailures.classify(RemoteFailure(code),1);assertEquals("REJECTED",d.state);assertFalse(d.retry)}}
    @Test fun rateLimitAndServiceFailuresRetry() {for(code in listOf(408,429,500,503)) assertTrue(SyncFailures.classify(RemoteFailure(code),1).retry)}
}
