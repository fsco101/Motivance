package com.motivance.data.remote

import com.motivance.domain.DayExercise
import com.motivance.domain.ExerciseDay
import com.motivance.domain.ExerciseSchedule
import com.motivance.domain.ScheduleDraft
import com.motivance.domain.ScheduleState
import com.motivance.domain.ScheduleWindow
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate

/** Reads exercise_day() and the schedule functions, the same fields web/src/data/exerciseSchedule.ts reads. */
object ScheduleJson {
    private fun JSONObject.text(key:String):String?=if(!has(key) || isNull(key)) null else getString(key)
    private fun <T> JSONArray?.rows(read:(JSONObject)->T):List<T> = if(this==null) emptyList() else (0 until length()).map {read(getJSONObject(it))}
    private fun JSONArray?.ints():Set<Int> = if(this==null) emptySet() else (0 until length()).map {getInt(it)}.filter {it in 1..7}.toSet()
    private fun JSONArray?.dates():List<LocalDate> = if(this==null) emptyList() else (0 until length()).map {LocalDate.parse(getString(it))}

    fun schedule(j:JSONObject)=ExerciseSchedule(
        j.getString("id"),j.getString("patient_id"),j.getString("therapist_id"),j.text("therapist_name").orEmpty(),
        LocalDate.parse(j.getString("starts_on")),LocalDate.parse(j.getString("ends_on")),j.optJSONArray("rest_weekdays").ints(),j.optJSONArray("rest_dates").dates(),
        j.optInt("exercise_days"),j.optInt("rest_days"),j.optInt("exercise_count"),
        when(j.text("state")) {"exercise" -> ScheduleState.EXERCISE; "rest" -> ScheduleState.REST; "ended" -> ScheduleState.ENDED; else -> ScheduleState.UPCOMING},
        j.optInt("days_left"),j.text("next_day")?.let(LocalDate::parse))

    fun day(j:JSONObject)=ExerciseDay(
        LocalDate.parse(j.getString("day")),
        j.optJSONArray("exercises").rows {DayExercise(it.getString("assignment_id"),it.text("schedule_id"),it.getString("therapist_id"),it.getBoolean("due"),it.getBoolean("done"))},
        j.optJSONArray("schedules").rows(::schedule))

    /** The schedule cached with an exercise on the phone: its dates and rest days. */
    fun window(j:JSONObject)=ScheduleWindow(j.getString("id"),LocalDate.parse(j.getString("starts_on")),LocalDate.parse(j.getString("ends_on")),
        j.optJSONArray("rest_weekdays").ints(),j.optJSONArray("rest_dates").dates())

    /** The body save_exercise_schedule takes. Weekdays and dates go sorted and once each, as the web app sends them. */
    fun save(draft:ScheduleDraft):JSONObject=JSONObject().put("p_id",draft.id).put("p_patient",draft.patientId)
        .put("p_starts_on",draft.startsOn.toString()).put("p_ends_on",draft.endsOn.toString())
        .put("p_rest_weekdays",JSONArray(draft.restWeekdays.sorted())).put("p_rest_dates",JSONArray(draft.restDates.distinct().sorted().map {it.toString()}))
}
