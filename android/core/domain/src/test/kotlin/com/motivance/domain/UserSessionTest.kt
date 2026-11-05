package com.motivance.domain

import org.junit.Assert.*
import org.junit.Test

class UserSessionTest {
    private fun session(vararg roles:UserRole)=UserSession("account",roles.toSet())

    @Test fun eachAccountLandsOnItsOwnRole() {
        assertEquals(UserRole.PATIENT,session(UserRole.PATIENT).primaryRole)
        assertEquals(UserRole.THERAPIST,session(UserRole.THERAPIST).primaryRole)
        assertEquals(UserRole.ADMIN,session(UserRole.ADMIN).primaryRole)
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
