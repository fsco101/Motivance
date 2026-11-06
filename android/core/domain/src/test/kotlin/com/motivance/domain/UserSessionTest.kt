package com.motivance.domain

import org.junit.Assert.*
import org.junit.Test

class UserSessionTest {
    private fun session(vararg roles:UserRole)=UserSession("account",roles.toSet())

    @Test fun eachAccountLandsOnItsOwnRole() {
        assertEquals(UserRole.PATIENT,session(UserRole.PATIENT).primaryRole)
        assertEquals(UserRole.THERAPIST,session(UserRole.THERAPIST).primaryRole)
        assertEquals(UserRole.ADMIN,session(UserRole.ADMIN).primaryRole)
        assertEquals(UserRole.SCHEDULER,session(UserRole.SCHEDULER).primaryRole)
    }

    /** Mirrors the order on the web: Admin, Scheduler, Therapist, Patient. */
    @Test fun aSchedulerRanksBetweenAnAdministratorAndATherapist() {
        assertEquals(UserRole.SCHEDULER,session(UserRole.THERAPIST,UserRole.SCHEDULER).primaryRole)
        assertEquals(UserRole.ADMIN,session(UserRole.SCHEDULER,UserRole.ADMIN).primaryRole)
    }

    @Test fun aRoleThisBuildDoesNotKnowIsIgnored() {
        assertEquals(UserRole.SCHEDULER,UserRole.of("scheduler"))
        assertEquals(UserRole.ADMIN,UserRole.of("ADMIN"))
        assertNull(UserRole.of("clerk"))
    }

    /** Every account starts as a patient, and the order roles arrive in is not guaranteed. */
    @Test fun staffWhoAreAlsoPatientsLandOnTheirStaffRoleInAnyOrder() {
        assertEquals(UserRole.THERAPIST,UserSession("account",linkedSetOf(UserRole.PATIENT,UserRole.THERAPIST)).primaryRole)
        assertEquals(UserRole.THERAPIST,UserSession("account",linkedSetOf(UserRole.THERAPIST,UserRole.PATIENT)).primaryRole)
        assertEquals(UserRole.ADMIN,UserSession("account",linkedSetOf(UserRole.PATIENT,UserRole.THERAPIST,UserRole.ADMIN)).primaryRole)
    }

    @Test fun aWorkspaceChosenOnTheProfilePageIsKept() {
        assertEquals(UserRole.PATIENT,session(UserRole.PATIENT,UserRole.THERAPIST).workspace(UserRole.PATIENT))
    }

    @Test fun aRoleTheAccountDoesNotHoldIsNeverShown() {
        assertEquals(UserRole.PATIENT,session(UserRole.PATIENT).workspace(UserRole.ADMIN))
        assertEquals(UserRole.THERAPIST,session(UserRole.PATIENT,UserRole.THERAPIST).workspace(null))
    }
}
