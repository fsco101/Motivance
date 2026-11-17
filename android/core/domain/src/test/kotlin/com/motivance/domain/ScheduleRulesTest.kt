package com.motivance.domain

import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate

/** The same day rules as the server and the web app (web/src/data/exerciseSchedule.test.ts), case for case. */
class ScheduleRulesTest {
    private fun day(text:String)=LocalDate.parse(text)
    private fun plan(start:String="2026-11-18",end:String="2026-12-01",weekdays:Set<Int> = emptySet(),dates:List<String> = emptyList())=
        ScheduleDraft("a","p",day(start),day(end),weekdays,dates.map(::day))

    @Test fun countsBothEndsOfARange() {
        assertEquals(1,ScheduleRules.daysBetween(day("2026-11-18"),day("2026-11-18")))
        assertEquals(14,ScheduleRules.daysBetween(day("2026-11-18"),day("2026-12-01")))
        assertEquals(2,ScheduleRules.daysBetween(day("2026-12-31"),day("2027-01-01")))
    }

    @Test fun restsOnRestWeekdaysAndDatesOnlyInsideTheRange() {
        val schedule=plan(weekdays=setOf(7),dates=listOf("2026-11-20"))
        fun exercise(date:String)=ScheduleRules.isExerciseDay(schedule.startsOn,schedule.endsOn,schedule.restWeekdays,schedule.restDates,day(date))
        assertFalse(exercise("2026-11-17"))
        assertTrue(exercise("2026-11-18"))
        assertFalse(exercise("2026-11-20"))
        assertFalse(exercise("2026-11-22"))
        assertTrue(exercise("2026-12-01"))
        assertFalse(exercise("2026-12-02"))
    }

    @Test fun sumsExerciseAndRestDaysForTheSummary() {
        assertEquals(DayCounts(14,11,3),ScheduleRules.counts(plan(weekdays=setOf(7),dates=listOf("2026-11-20","2027-01-05"))))
        assertEquals(DayCounts(0,0,0),ScheduleRules.counts(plan(end="2026-11-17")))
    }

    @Test fun saysWhatTheServerWouldRefuse() {
        val today=day("2026-11-18")
        assertNull(ScheduleRules.problem(plan(),today))
        assertEquals(ScheduleProblem.DATES,ScheduleRules.problem(plan(end="2026-11-17"),today))
        assertNull(ScheduleRules.problem(plan(end="2027-11-18"),today))
        assertEquals(ScheduleProblem.TOO_LONG,ScheduleRules.problem(plan(end="2027-11-19"),today))
        assertEquals(ScheduleProblem.PAST_START,ScheduleRules.problem(plan(start="2026-11-17"),today))
        assertEquals(ScheduleProblem.ALL_REST,ScheduleRules.problem(plan(weekdays=(1..7).toSet()),today))
        assertEquals(ScheduleProblem.NO_DAY,ScheduleRules.problem(plan(end="2026-11-18",dates=listOf("2026-11-18")),today))
    }

    @Test fun aStartedScheduleKeepsItsStartButCannotEndInThePast() {
        val started=plan(start="2026-11-10")
        val today=day("2026-11-18")
        assertNull(ScheduleRules.problem(started,today,day("2026-11-10")))
        assertEquals(ScheduleProblem.PAST_END,ScheduleRules.problem(started.copy(endsOn=day("2026-11-17")),today,day("2026-11-10")))
        // Only the days from today on count towards "at least one exercise day".
        assertEquals(ScheduleProblem.NO_DAY,ScheduleRules.problem(started.copy(endsOn=today,restDates=listOf(today)),today,day("2026-11-10")))
    }
}
