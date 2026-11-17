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

data class ExerciseDay(val day:LocalDate,val exercises:List<DayExercise> = emptyList(),val schedules:List<ExerciseSchedule> = emptyList())

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
