package com.motivance.domain

import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * Exercise schedules (#124): a start date, an end date and rest days for some of a patient's exercises. Dates are calendar days at
 * the center. The rules mirror the server's schedule_has_day and web/src/data/exerciseSchedule.ts, so all three agree on every day.
 */
enum class ScheduleState {UPCOMING,EXERCISE,REST,ENDED}

data class ExerciseSchedule(
    val id:String,val patientId:String,val therapistId:String,val therapistName:String,val startsOn:LocalDate,val endsOn:LocalDate,
    /** ISO weekdays: 1 is Monday and 7 is Sunday. */
    val restWeekdays:Set<Int> = emptySet(),val restDates:List<LocalDate> = emptyList(),
    val exerciseDays:Int=0,val restDays:Int=0,val exerciseCount:Int=0,
    /** Where the schedule stands on the day it was read for, with the exercise days left from then and the next one after it. */
    val state:ScheduleState=ScheduleState.UPCOMING,val daysLeft:Int=0,val nextDay:LocalDate?=null)

/** One active exercise on one day. An exercise without a schedule is due every day. */
data class DayExercise(val assignmentId:String,val scheduleId:String?,val therapistId:String,val due:Boolean,val done:Boolean)

/** A finished exercise day with something left undone (#128). */
data class MissedDay(val day:LocalDate,val therapistId:String,val due:Int,val done:Int)

data class ExerciseDay(val day:LocalDate,val exercises:List<DayExercise> = emptyList(),val schedules:List<ExerciseSchedule> = emptyList(),
    /** The last 30 days' missed exercise days, newest first. */
    val missed:List<MissedDay> = emptyList())

data class ScheduleDraft(val id:String,val patientId:String,val startsOn:LocalDate,val endsOn:LocalDate,val restWeekdays:Set<Int> = emptySet(),val restDates:List<LocalDate> = emptyList())

data class DayCounts(val total:Int,val exercise:Int,val rest:Int)

enum class ScheduleProblem {DATES,TOO_LONG,PAST_START,PAST_END,ALL_REST,NO_DAY}

object ScheduleRules {
    /** A schedule is at most this many days long, first and last included. */
    const val MAX_DAYS=366

    fun isExerciseDay(startsOn:LocalDate,endsOn:LocalDate,restWeekdays:Set<Int>,restDates:Collection<LocalDate>,day:LocalDate)=
        !day.isBefore(startsOn) && !day.isAfter(endsOn) && day.dayOfWeek.value !in restWeekdays && day !in restDates

    fun isExerciseDay(schedule:ExerciseSchedule,day:LocalDate)=isExerciseDay(schedule.startsOn,schedule.endsOn,schedule.restWeekdays,schedule.restDates,day)

    /** Days in a range, first and last included; zero when the end is before the start. */
    fun daysBetween(startsOn:LocalDate,endsOn:LocalDate)=ChronoUnit.DAYS.between(startsOn,endsOn).toInt()+1

    /** Exercise and rest days in a draft, for the summary before saving. */
    fun counts(draft:ScheduleDraft,from:LocalDate=draft.startsOn):DayCounts {
        val first=if(from.isAfter(draft.startsOn)) from else draft.startsOn
        val total=maxOf(0,daysBetween(first,draft.endsOn))
        val exercise=(0 until minOf(total,MAX_DAYS)).count {isExerciseDay(draft.startsOn,draft.endsOn,draft.restWeekdays,draft.restDates,first.plusDays(it.toLong()))}
        return DayCounts(total,exercise,total-exercise)
    }

    /**
     * What the server would refuse, so the form can say so before saving. [startedOn] is the saved start date when editing: once a
     * schedule has started, its start date is fixed and the rule about starting today or later no longer applies.
     */
    fun problem(draft:ScheduleDraft,today:LocalDate,startedOn:LocalDate?=null):ScheduleProblem? {
        if(draft.endsOn.isBefore(draft.startsOn)) return ScheduleProblem.DATES
        if(daysBetween(draft.startsOn,draft.endsOn)>MAX_DAYS) return ScheduleProblem.TOO_LONG
        val started=startedOn!=null && !startedOn.isAfter(today)
        if(!started && draft.startsOn.isBefore(today)) return ScheduleProblem.PAST_START
        if(draft.endsOn.isBefore(today)) return ScheduleProblem.PAST_END
        if(draft.restWeekdays.size>=7) return ScheduleProblem.ALL_REST
        return if(counts(draft,today).exercise==0) ScheduleProblem.NO_DAY else null
    }
}

/** A schedule's dates and rest days, as cached with each exercise on the phone so today's list works offline. */
data class ScheduleWindow(val id:String,val startsOn:LocalDate,val endsOn:LocalDate,val restWeekdays:Set<Int> = emptySet(),val restDates:List<LocalDate> = emptyList()) {
    fun isExerciseDay(day:LocalDate)=ScheduleRules.isExerciseDay(startsOn,endsOn,restWeekdays,restDates,day)
    /** The first exercise day after [day], or null when none is left. */
    fun nextDay(day:LocalDate):LocalDate?=generateSequence(maxOf(day.plusDays(1),startsOn)) {it.plusDays(1)}.takeWhile {!it.isAfter(endsOn)}.firstOrNull(::isExerciseDay)
}

/** One exercise for today's list: its schedule (null for every day) and whether it was finished today. */
data class TodayItem<T>(val item:T,val window:ScheduleWindow?,val done:Boolean)

enum class TodayState {EXERCISE,DONE,REST,UPCOMING,FINISHED,NONE}

/** What a patient has to do today. Mirrors planForToday (TodayPlan) in web/src/data/exerciseSchedule.ts. */
data class DailyPlan<T>(val todo:List<T>,val done:Int,val due:Int,val state:TodayState,val nextDay:LocalDate?,val startsOn:LocalDate?)

object TodayPlanner {
    /**
     * Only the exercises due today and not yet done are listed: one finished today is gone until its next exercise day, and a
     * missed day is never carried over. The next day is the soonest of each schedule's next exercise day, or tomorrow while an
     * every-day exercise is on the plan.
     */
    fun <T> plan(items:List<TodayItem<T>>,today:LocalDate):DailyPlan<T> {
        val due=items.filter {it.window?.isExerciseDay(today) ?: true}
        val todo=due.filterNot {it.done}
        val windows=items.mapNotNull {it.window}.distinctBy {it.id}
        val nextDay=(windows.mapNotNull {it.nextDay(today)}+listOfNotNull(today.plusDays(1).takeIf {items.any {it.window==null}})).minOrNull()
        val startsOn=windows.filter {today.isBefore(it.startsOn)}.minOfOrNull {it.startsOn}
        val resting=windows.any {!today.isBefore(it.startsOn) && !today.isAfter(it.endsOn) && !it.isExerciseDay(today)}
        val state=when {
            items.isEmpty() -> TodayState.NONE
            todo.isNotEmpty() -> TodayState.EXERCISE
            due.isNotEmpty() -> TodayState.DONE
            resting -> TodayState.REST
            startsOn!=null -> TodayState.UPCOMING
            else -> TodayState.FINISHED
        }
        return DailyPlan(todo.map {it.item},due.size-todo.size,due.size,state,nextDay,startsOn)
    }
}
