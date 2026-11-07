package com.motivance.domain

import org.junit.Assert.*
import org.junit.Test

class AdministrationTest {
    private val patient=AdminAccount("p","Pat",true,setOf("patient"))
    private val therapist=AdminAccount("t","Thea",true,setOf("patient","therapist"))
    private val admin=AdminAccount("a","Ada",true,setOf("admin","patient"))
    private val scheduler=AdminAccount("s","Sol",true,setOf("patient","scheduler"))
    private val disabled=AdminAccount("d","",false,setOf("patient"),email="d@example.test")

    @Test fun primaryRolePrefersTheMostPrivilegedRoleBecauseEveryAccountIsAlsoAPatient() {
        assertEquals("patient",patient.primaryRole)
        assertEquals("therapist",therapist.primaryRole)
        assertEquals("admin",admin.primaryRole)
        assertFalse(patient.staff);assertTrue(therapist.staff);assertTrue(admin.staff);assertTrue(scheduler.staff)
        assertEquals("scheduler",scheduler.primaryRole)
    }
    @Test fun labelFallsBackFromNameToEmailToShortId() {
        assertEquals("Pat",patient.label)
        assertEquals("d@example.test",disabled.label)
        assertEquals("12345678",AdminAccount("1234567890","",true,emptySet()).label)
    }
    @Test fun accountFiltersSeparatePurePatientsFromStaff() {
        val all=listOf(patient,therapist,admin,disabled)
        assertEquals(listOf(patient,disabled),all.filter {AccountFilter.PATIENTS.accepts(it)})
        assertEquals(listOf(therapist),all.filter {AccountFilter.THERAPISTS.accepts(it)})
        assertTrue(AccountFilter.SCHEDULERS.accepts(scheduler));assertFalse(AccountFilter.SCHEDULERS.accepts(therapist))
        assertFalse("A Scheduler is staff, not a patient",AccountFilter.PATIENTS.accepts(scheduler))
        assertEquals(listOf(admin),all.filter {AccountFilter.ADMINS.accepts(it)})
        assertEquals(listOf(disabled),all.filter {AccountFilter.DISABLED.accepts(it)})
        assertEquals(all,all.filter {AccountFilter.ALL.accepts(it)})
    }
    @Test fun linkFiltersSplitActiveAndRevoked() {
        val on=AdminLink("t","p",true);val off=AdminLink("t","q",false)
        assertEquals(listOf(on),listOf(on,off).filter {LinkFilter.ACTIVE.accepts(it)})
        assertEquals(listOf(off),listOf(on,off).filter {LinkFilter.REVOKED.accepts(it)})
        assertEquals(2,listOf(on,off).count {LinkFilter.ALL.accepts(it)})
    }
    @Test fun everyAuditedOperationHasADedicatedKindAndCategory() {
        fun event(type:String,action:String)=AuditEvent(1,action,type,"x","2026-11-04T00:00:00+00:00")
        val cases=mapOf(
            ("profiles" to "enable") to (AuditKind.ACCOUNT_ENABLED to AuditCategory.ACCOUNTS),
            ("profiles" to "disable") to (AuditKind.ACCOUNT_DISABLED to AuditCategory.ACCOUNTS),
            ("user_roles" to "insert") to (AuditKind.ROLE_GRANTED to AuditCategory.ACCOUNTS),
            ("user_roles" to "delete") to (AuditKind.ROLE_REMOVED to AuditCategory.ACCOUNTS),
            ("therapist_patients" to "insert") to (AuditKind.LINK_CREATED to AuditCategory.LINKS),
            ("therapist_patients" to "update") to (AuditKind.LINK_UPDATED to AuditCategory.LINKS),
            ("patient_invitations" to "invite") to (AuditKind.INVITATION_CREATED to AuditCategory.LINKS),
            ("exercises" to "activate") to (AuditKind.EXERCISE_ACTIVATED to AuditCategory.CATALOGUE),
            ("exercises" to "deactivate") to (AuditKind.EXERCISE_DEACTIVATED to AuditCategory.CATALOGUE),
            ("exercise_versions" to "publish") to (AuditKind.VERSION_PUBLISHED to AuditCategory.CATALOGUE),
            ("prescription_versions" to "insert") to (AuditKind.PRESCRIPTION_PUBLISHED to AuditCategory.CLINICAL),
            ("sessions" to "insert") to (AuditKind.SESSION_RECORDED to AuditCategory.CLINICAL),
            ("consents" to "insert") to (AuditKind.CONSENT_RECORDED to AuditCategory.PRIVACY),
            ("data_requests" to "insert") to (AuditKind.REQUEST_CREATED to AuditCategory.PRIVACY),
            ("data_requests" to "update") to (AuditKind.REQUEST_UPDATED to AuditCategory.PRIVACY),
            ("bookings" to "requested") to (AuditKind.BOOKING_REQUESTED to AuditCategory.BOOKINGS),
            ("bookings" to "export") to (AuditKind.BOOKING_EXPORTED to AuditCategory.BOOKINGS),
            ("bookings" to "confirmed") to (AuditKind.BOOKING_CONFIRMED to AuditCategory.BOOKINGS),
            ("bookings" to "rejected") to (AuditKind.BOOKING_REJECTED to AuditCategory.BOOKINGS),
            ("bookings" to "cancelled") to (AuditKind.BOOKING_CANCELLED to AuditCategory.BOOKINGS),
            ("bookings" to "rescheduled") to (AuditKind.BOOKING_RESCHEDULED to AuditCategory.BOOKINGS),
            ("bookings" to "returned_to_pending") to (AuditKind.BOOKING_RETURNED to AuditCategory.BOOKINGS),
            ("bookings" to "therapist_changed") to (AuditKind.BOOKING_THERAPIST to AuditCategory.BOOKINGS),
            ("bookings" to "attendance_marked") to (AuditKind.BOOKING_ATTENDANCE to AuditCategory.BOOKINGS),
            ("bookings" to "series_booked") to (AuditKind.BOOKING_SERIES to AuditCategory.BOOKINGS),
        )
        cases.forEach {(input,expected) ->
            val e=event(input.first,input.second)
            assertEquals(input.toString(),expected,e.kind() to e.category())
        }
        assertEquals(AuditKind.OTHER,event("future_table","insert").kind())
    }
    @Test fun eventsWithoutAnActorAreSystemEvents() {
        assertTrue(AuditEvent(1,"insert","user_roles","u","t").system)
        assertFalse(AuditEvent(1,"insert","user_roles","u","t",actorId="admin").system)
    }
}
