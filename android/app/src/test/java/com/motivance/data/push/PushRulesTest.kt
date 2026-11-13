package com.motivance.data.push

import com.motivance.R
import java.time.Instant
import org.junit.Assert.*
import org.junit.Test

class PushRulesTest {
    @Test fun eachSwitchHasItsOwnChannelAndBookingsKeepTheOneTheyShippedWith() {
        assertEquals("booking_updates" to R.string.push_channel,pushChannel("confirmed"))
        assertEquals("booking_updates",pushChannel("session_reminder").first)
        assertEquals("exercise_plan" to R.string.push_channel_exercise_plan,pushChannel("plan_updated"))
        assertEquals("session_results",pushChannel("session_finished").first)
        assertEquals("inactivity",pushChannel("patient_inactive").first)
        assertEquals("practice_reminders",pushChannel("practice_reminder").first)
        listOf("care_linked","care_unlinked","patient_linked","patient_unlinked").forEach {assertEquals(it,"care_team",pushChannel(it).first)}
    }

    @Test fun aKindThisVersionDoesNotKnowStillArrivesOnTheBookingChannel() {
        assertEquals("booking_updates",pushChannel("from_a_newer_server").first)
        assertEquals("booking_updates",pushChannel(null).first)
    }

    @Test fun aPracticeReminderIsDroppedOnceTodaysSessionIsOnThePhone() {
        val reminder=mapOf("kind" to "practice_reminder","user_id" to "p1")
        assertTrue(skipPush(reminder) {it=="p1"})
        assertFalse(skipPush(reminder) {false})
    }

    @Test fun onlyThePersonItWasSentToCounts() {
        val asked=mutableListOf<String>()
        skipPush(mapOf("kind" to "practice_reminder","user_id" to "p1")) {asked+=it;false}
        assertEquals(listOf("p1"),asked)
    }

    @Test fun nothingElseIsDroppedAndThePhoneIsNotAsked() {
        var asked=false
        assertFalse(skipPush(mapOf("kind" to "plan_updated","user_id" to "p1")) {asked=true;true})
        assertFalse(skipPush(mapOf("kind" to "confirmed")) {asked=true;true})
        assertFalse(asked)
    }

    @Test fun aReminderWithNoReaderIsShown() {
        assertFalse(skipPush(mapOf("kind" to "practice_reminder","user_id" to "")) {true})
        assertFalse(skipPush(mapOf("kind" to "practice_reminder")) {true})
    }

    @Test fun todayStartsAtMidnightAtTheCenterNotOnThePhone() {
        // 23:30 UTC on 1 December is 07:30 on 2 December in Manila, so the center's day began at 16:00 UTC on 1 December.
        assertEquals(Instant.parse("2026-12-01T16:00:00Z").toEpochMilli(),centerDayStart(Instant.parse("2026-12-01T23:30:00Z")))
        assertEquals(Instant.parse("2026-11-30T16:00:00Z").toEpochMilli(),centerDayStart(Instant.parse("2026-12-01T15:59:00Z")))
    }
}
