package com.motivance.navigation

import org.junit.Assert.assertEquals
import org.junit.Test

class WorkspaceNavigationTest {
    @Test fun detailBackReturnsToItsOwningWorkspace() {
        assertEquals("PATIENT_DETAIL",parentRoute("ASSIGN",true))
        assertEquals("PATIENTS",parentRoute("PATIENT_DETAIL",true))
        assertEquals("PROFILE",parentRoute("LOCAL_HISTORY",true))
        assertEquals("CHECK_COMPLETE",parentRoute("LOCAL_HISTORY",false))
        assertEquals("LANDING",parentRoute("SETUP",false))
        assertEquals("HOME",parentRoute("SETUP",true))
    }

    @Test fun backFromNotificationsGoesHome() {
        assertEquals("HOME",parentRoute("NOTIFICATIONS",true))
    }

    /** A patient reaches My Schedule from their bookings. A therapist has it as a tab of its own. */
    @Test fun backFromTheScheduleDependsOnWhoseItIs() {
        assertEquals("BOOKINGS",parentRoute("SCHEDULE",true))
        assertEquals("HOME",parentRoute("SCHEDULE",true,therapist=true))
    }
}
