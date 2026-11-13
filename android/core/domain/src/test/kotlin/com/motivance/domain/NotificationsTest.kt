package com.motivance.domain

import org.junit.Assert.*
import org.junit.Test

class NotificationsTest {
    private fun note(kind:NotificationKind,subject:String?=null)=AppNotification("n1",kind,subjectId=subject)

    @Test fun everyKindTheServerSendsIsKnown() {
        val server=listOf("confirmed","rejected","cancelled","rescheduled","therapist_changed","returned_to_pending","session_assigned","session_moved","session_cancelled",
            "session_removed","request_received","patient_cancelled","needs_therapist","reminder","session_reminder","place_open","patient_rescheduled","series_booked",
            "series_assigned","series_cancelled","session_series_cancelled","plan_updated","session_finished","practice_reminder","patient_inactive","care_linked",
            "care_unlinked","patient_linked","patient_unlinked")
        assertEquals(server.toSet(),NotificationKind.entries.map {it.key}.toSet())
        assertNull(NotificationKind.of("from_a_newer_server"))
    }

    @Test fun eachKindAnswersToTheSameSwitchAsOnTheServer() {
        assertEquals(NotificationGroup.BOOKINGS,NotificationKind.CONFIRMED.group)
        assertEquals(NotificationGroup.BOOKINGS,NotificationKind.SESSION_REMINDER.group)
        assertEquals(NotificationGroup.EXERCISE_PLAN,NotificationKind.PLAN_UPDATED.group)
        assertEquals(NotificationGroup.SESSION_RESULTS,NotificationKind.SESSION_FINISHED.group)
        assertEquals(NotificationGroup.INACTIVITY,NotificationKind.PATIENT_INACTIVE.group)
        assertEquals(NotificationGroup.PRACTICE,NotificationKind.PRACTICE_REMINDER.group)
        listOf(NotificationKind.CARE_LINKED,NotificationKind.CARE_UNLINKED,NotificationKind.PATIENT_LINKED,NotificationKind.PATIENT_UNLINKED).forEach {
            assertEquals(NotificationGroup.CARE_TEAM,it.group)
        }
    }

    @Test fun exerciseNewsOpensThePlanAndCareNewsOpensHomeForAPatient() {
        assertEquals(NotificationDestination.Exercises,note(NotificationKind.PLAN_UPDATED,"t1").destination(UserRole.PATIENT))
        assertEquals(NotificationDestination.Exercises,note(NotificationKind.PRACTICE_REMINDER).destination(UserRole.PATIENT))
        assertEquals(NotificationDestination.Home,note(NotificationKind.CARE_LINKED,"t1").destination(UserRole.PATIENT))
        assertEquals(NotificationDestination.Home,note(NotificationKind.CARE_UNLINKED,"t1").destination(UserRole.PATIENT))
    }

    @Test fun aTherapistOpensThePatientItIsAbout() {
        assertEquals(NotificationDestination.Patient("p1"),note(NotificationKind.SESSION_FINISHED,"p1").destination(UserRole.THERAPIST))
        assertEquals(NotificationDestination.Patient("p1"),note(NotificationKind.PATIENT_INACTIVE,"p1").destination(UserRole.THERAPIST))
        assertEquals(NotificationDestination.Patient("p1"),note(NotificationKind.PATIENT_LINKED,"p1").destination(UserRole.THERAPIST))
        assertEquals("With nobody to open, the list",NotificationDestination.Patients,note(NotificationKind.SESSION_FINISHED).destination(UserRole.THERAPIST))
        assertEquals("A patient no longer linked cannot be opened",NotificationDestination.Patients,note(NotificationKind.PATIENT_UNLINKED,"p1").destination(UserRole.THERAPIST))
    }

    @Test fun bookingNewsGoesWhereBookingsAreSeen() {
        assertEquals(NotificationDestination.Bookings,note(NotificationKind.RESCHEDULED,"t1").destination(UserRole.PATIENT))
        assertEquals(NotificationDestination.Schedule,note(NotificationKind.SESSION_ASSIGNED,"p1").destination(UserRole.THERAPIST))
        assertEquals("A Scheduler's requests are on the web",NotificationDestination.Stay,note(NotificationKind.REQUEST_RECEIVED,"p1").destination(UserRole.SCHEDULER))
    }

    @Test fun everySwitchStartsOnAndThereIsNoReminderUntilChosen() {
        val settings=NotificationSettings()
        NotificationGroup.entries.filter {it!=NotificationGroup.PRACTICE}.forEach {assertTrue(it.name,settings.allows(it))}
        assertFalse(settings.allows(NotificationGroup.PRACTICE))
    }

    @Test fun turningTheReminderOnChoosesSixInTheEveningAndOffForgetsTheTime() {
        val on=NotificationSettings().with(NotificationGroup.PRACTICE,true)
        assertEquals("18:00",on.reminderTime)
        assertEquals("A chosen time is kept when it is on already","07:30",on.copy(reminderTime="07:30").with(NotificationGroup.PRACTICE,true).reminderTime)
        assertNull(on.with(NotificationGroup.PRACTICE,false).reminderTime)
    }

    @Test fun eachSwitchChangesOnlyItself() {
        NotificationGroup.entries.filter {it!=NotificationGroup.PRACTICE}.forEach {group ->
            val off=NotificationSettings().with(group,false)
            assertFalse(group.name,off.allows(group))
            NotificationGroup.entries.filter {it!=group && it!=NotificationGroup.PRACTICE}.forEach {assertTrue("${group.name} left ${it.name} alone",off.allows(it))}
        }
    }

    @Test fun aReminderTimeIsHoursAndMinutes() {
        listOf("00:00","07:30","18:00","23:59").forEach {assertTrue(it,NotificationSettings.validTime(it))}
        listOf("24:00","7:30","07:30:00","18:60","soon","").forEach {assertFalse(it,NotificationSettings.validTime(it))}
    }

    @Test fun eachRoleSeesTheSwitchesThatMeanSomethingToIt() {
        assertEquals(listOf(NotificationGroup.BOOKINGS,NotificationGroup.EXERCISE_PLAN,NotificationGroup.PRACTICE,NotificationGroup.CARE_TEAM),
            notificationGroupsFor(setOf(UserRole.PATIENT)))
        assertEquals("A therapist also holds the patient role, and hears about their patients",
            listOf(NotificationGroup.BOOKINGS,NotificationGroup.SESSION_RESULTS,NotificationGroup.INACTIVITY,NotificationGroup.CARE_TEAM),
            notificationGroupsFor(setOf(UserRole.PATIENT,UserRole.THERAPIST)))
        assertEquals(listOf(NotificationGroup.BOOKINGS),notificationGroupsFor(setOf(UserRole.PATIENT,UserRole.SCHEDULER)))
        assertEquals("An administrator alone has no bell",emptyList<NotificationGroup>(),notificationGroupsFor(setOf(UserRole.PATIENT,UserRole.ADMIN)))
    }
}
