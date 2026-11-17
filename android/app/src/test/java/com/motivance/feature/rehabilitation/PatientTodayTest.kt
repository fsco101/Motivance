package com.motivance.feature.rehabilitation

import com.motivance.data.local.CachedPrescription
import com.motivance.data.local.ExerciseJson
import com.motivance.data.local.LocalSession
import com.motivance.data.remote.PrescriptionCache
import com.motivance.domain.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate
import java.time.ZonedDateTime

/** Today's list on the phone (#127): the cached schedule, sessions finished here, and what the server says. */
class PatientTodayTest {
    private val today=LocalDate.parse("2026-11-18")
    private val schedule="""{"id":"s1","starts_on":"2026-11-16","ends_on":"2026-11-29","rest_weekdays":[7],"rest_dates":["2026-11-20"],"cancelled_at":null}"""
    private fun plan(id:String,bilateral:Boolean=false,scheduleJson:String?=schedule)=CachedPrescription("patient","v-$id","a-$id","patient",
        ExerciseJson.rules(ExerciseRules(prescriptionVersionId="v-$id",demo=false,bilateral=bilateral)),"Instructions",Long.MAX_VALUE,0,scheduleJson)
    /** A session this phone finished, at a time of day in Manila. */
    private fun finished(version:String,at:String,side:BodySide=BodySide.LEFT,status:String="COMPLETED")=LocalSession("session-$version-$at-$side","patient",
        ExerciseJson.rules(ExerciseRules(prescriptionVersionId=version,demo=false,side=side)),"{}",status,ZonedDateTime.parse(at).toInstant().toEpochMilli(),0)

    @Test fun aSessionFinishedHereTodayTakesTheExerciseOffTheList() {
        val result=patientToday(listOf(plan("1"),plan("2")),listOf(finished("v-1","2026-11-18T07:30+08:00[Asia/Manila]")),null,today)
        assertEquals(listOf("a-2"),result.todo.map {it.assignmentId})
        assertEquals(1,result.done)
    }

    @Test fun yesterdaysSessionOrAnInterruptedOneDoesNotCount() {
        val result=patientToday(listOf(plan("1")),listOf(finished("v-1","2026-11-17T23:59+08:00[Asia/Manila]"),finished("v-1","2026-11-18T08:00+08:00[Asia/Manila]",status="INTERRUPTED")),null,today)
        assertEquals(TodayState.EXERCISE,result.state)
    }

    @Test fun theDayTurnsAtMidnightInManilaWhateverThePhoneSays() {
        // 16:30 in London on the 17th is half past midnight on the 18th in Manila.
        assertEquals(today,centerDate(ZonedDateTime.parse("2026-11-17T16:30Z").toInstant().toEpochMilli()))
        val result=patientToday(listOf(plan("1")),listOf(finished("v-1","2026-11-17T16:30Z")),null,today)
        assertEquals(TodayState.DONE,result.state)
    }

    @Test fun aBothSidesExerciseNeedsBothSides() {
        val left=finished("v-1","2026-11-18T07:30+08:00[Asia/Manila]",BodySide.LEFT)
        assertEquals(1,patientToday(listOf(plan("1",bilateral=true)),listOf(left),null,today).todo.size)
        val right=finished("v-1","2026-11-18T07:40+08:00[Asia/Manila]",BodySide.RIGHT)
        assertEquals(TodayState.DONE,patientToday(listOf(plan("1",bilateral=true)),listOf(left,right),null,today).state)
    }

    @Test fun theServerCountsSessionsFromOtherPhones() {
        val server=ExerciseDay(today,listOf(DayExercise("a-1","s1","t",due=true,done=true)))
        assertEquals(listOf("a-2"),patientToday(listOf(plan("1"),plan("2")),emptyList(),server,today).todo.map {it.assignmentId})
        // An answer for another day is ignored.
        assertEquals(2,patientToday(listOf(plan("1"),plan("2")),emptyList(),server.copy(day=today.minusDays(1)),today).todo.size)
    }

    @Test fun aRestDayListsNothingAndAnEveryDayExerciseIsAlwaysDue() {
        val rest=LocalDate.parse("2026-11-20")
        assertEquals(TodayState.REST,patientToday(listOf(plan("1")),emptyList(),null,rest).state)
        assertEquals(listOf("a-2"),patientToday(listOf(plan("1"),plan("2",scheduleJson=null)),emptyList(),null,rest).todo.map {it.assignmentId})
    }

    @Test fun theDownloadCachesEachExercisesScheduleButNotACancelledOne() {
        val row={id:String,embedded:String -> JSONObject("""{"id":"$id","patient_id":"patient","exercise_schedules":$embedded,"prescription_versions":[{"id":"v-$id","version":1,"side":"left","minimum_degrees":20,"maximum_degrees":90,"target_repetitions":5,"exercise_versions":{"id":"e","algorithm_key":"elbow-flexion-v1","definition":{"measurement_convention":"2d_flexion_degrees","instructions_en":"Fixture"}}}]}""")}
        val rows=JSONArray().put(row("a1",schedule)).put(row("a2","null")).put(row("a3",schedule.replace("\"cancelled_at\":null","\"cancelled_at\":\"2026-11-17T01:00:00Z\"")))
        val cached=PrescriptionCache.decode("patient",rows,0).associateBy {it.assignmentId}
        assertEquals("s1",JSONObject(cached.getValue("a1").scheduleJson!!).getString("id"))
        assertNull(cached.getValue("a2").scheduleJson)
        assertNull(cached.getValue("a3").scheduleJson)
    }
}
