package com.motivance.feature.rehabilitation

import com.motivance.R
import com.motivance.domain.RemoteFailure
import com.motivance.domain.isOffline
import com.motivance.feature.exercise.videoRefusal
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import org.junit.Assert.*
import org.junit.Test

/** A lost connection says "offline"; a refusal from the server keeps its own message (#162). */
class OfflineMessagesTest {
    @Test fun aNetworkFailureIsOfflineAndAServerRefusalIsNot() {
        for(e in listOf(IOException("down"),UnknownHostException("no dns"),SocketTimeoutException("slow"))) assertTrue(e.isOffline())
        for(status in listOf(401,403,500)) assertFalse(RemoteFailure(status).isOffline())
        assertFalse(IllegalStateException("bad data").isOffline())
    }
    @Test fun scheduleAndVideoActionsSayOfflineOnlyWhenTheServerCannotBeReached() {
        assertEquals(R.string.offline_action,scheduleRefusal(UnknownHostException()))
        assertEquals(R.string.connected_failed,scheduleRefusal(RemoteFailure(403)))
        assertEquals(R.string.connected_failed,scheduleRefusal(RemoteFailure(500)))
        assertEquals(R.string.exercise_schedule_error_gone,scheduleRefusal(RemoteFailure(400,"schedule_gone")))
        assertEquals(R.string.offline_action,videoRefusal(IOException()))
        assertEquals(R.string.connected_failed,videoRefusal(RemoteFailure(500)))
    }
}
