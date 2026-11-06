package com.motivance.domain

import org.junit.Assert.*
import org.junit.Test

class ServerConsentTest {
    private val withdrawn=ServerConsent("id","withdrawn",2_000)

    /** The case that loses a session: the phone would reuse this grant, and the server would reject the upload. */
    @Test fun aWithdrawalOnTheWebCancelsAnOlderGrantOnThePhone() {
        assertTrue(withdrawn.withdrawsLocalGrant("granted",1_000))
        assertTrue("Equal times count, so a withdrawal is never lost",withdrawn.withdrawsLocalGrant("granted",2_000))
    }

    @Test fun aGrantMadeOnThePhoneAfterwardsStands() {
        assertFalse(withdrawn.withdrawsLocalGrant("granted",3_000))
    }

    @Test fun nothingChangesWhenThePhoneAlreadyKnows() {
        assertFalse(withdrawn.withdrawsLocalGrant("withdrawn",2_000))
    }

    @Test fun nothingChangesWithoutALocalGrant() {
        assertFalse(withdrawn.withdrawsLocalGrant(null,null))
    }

    @Test fun aServerGrantNeverWithdrawsAnything() {
        assertFalse(ServerConsent("id","granted",2_000).withdrawsLocalGrant("granted",1_000))
    }
}
