package com.motivance.domain

import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate

/** A patient's list for today (#127), the same cases as planForToday in web/src/data/exerciseSchedule.test.ts. */
class TodayPlannerTest {
    private fun day(text:String)=LocalDate.parse(text)
    private val today=day("2026-11-18")
    // Monday 16 to Sunday 29 November, resting on Sundays and on Friday the 20th.
    private val window=ScheduleWindow("s1",day("2026-11-16"),day("2026-11-29"),setOf(7),listOf(day("2026-11-20")))

    @Test fun listsOnlyWhatIsDueAndNotYetDone() {
        val plan=TodayPlanner.plan(listOf(TodayItem("a1",window,done=true),TodayItem("a2",window,done=false),
            TodayItem("a3",window.copy(id="s2",startsOn=day("2026-11-25")),done=false)),today)
        assertEquals(listOf("a2"),plan.todo)
        assertEquals(1,plan.done); assertEquals(2,plan.due)
        assertEquals(TodayState.EXERCISE,plan.state)
    }

    @Test fun saysAllDoneAndNamesTheNextExerciseDay() {
        val plan=TodayPlanner.plan(listOf(TodayItem("a1",window,true),TodayItem("a2",window,true)),today)
        assertEquals(TodayState.DONE,plan.state)
        assertEquals(day("2026-11-19"),plan.nextDay)
    }

    @Test fun skipsRestDaysWhenNamingTheNextOne() {
        assertEquals(day("2026-11-21"),window.nextDay(day("2026-11-19")))
        assertEquals(day("2026-11-23"),window.nextDay(day("2026-11-21")))
        assertNull(window.nextDay(day("2026-11-28")))
    }

    @Test fun bringsAnEveryDayExerciseBackTomorrow() {
        val plan=TodayPlanner.plan(listOf(TodayItem("a1",null,true)),today)
        assertEquals(TodayState.DONE,plan.state)
        assertEquals(day("2026-11-19"),plan.nextDay)
    }

    @Test fun tellsARestDayFromOneNotStartedAndOneOver() {
        assertEquals(TodayState.REST,TodayPlanner.plan(listOf(TodayItem("a1",window,false)),day("2026-11-20")).state)
        assertEquals(day("2026-11-21"),TodayPlanner.plan(listOf(TodayItem("a1",window,false)),day("2026-11-20")).nextDay)
        val later=TodayPlanner.plan(listOf(TodayItem("a1",window.copy(startsOn=day("2026-11-25")),false)),today)
        assertEquals(TodayState.UPCOMING,later.state); assertEquals(day("2026-11-25"),later.startsOn)
        val over=TodayPlanner.plan(listOf(TodayItem("a1",window,false)),day("2026-12-01"))
        assertEquals(TodayState.FINISHED,over.state); assertNull(over.nextDay)
        assertEquals(TodayState.NONE,TodayPlanner.plan(emptyList<TodayItem<String>>(),today).state)
    }
}
