package com.motivance.data.remote

import com.motivance.domain.BodySide
import com.motivance.domain.PrescriptionDraft
import com.motivance.domain.RemoteFailure
import com.motivance.domain.ScheduleDraft
import com.motivance.domain.ScheduleState
import kotlinx.coroutines.runBlocking
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate

/** Exercise schedules (#126) as Android sends and reads them: the same calls and fields as the web app. */
class ScheduleRepositoryTest {
    /** What exercise_day returns, as recorded from the local backend. */
    private val day="""{"day":"2026-11-18","exercises":[
        {"assignment_id":"a1","schedule_id":"s1","therapist_id":"t1","due":true,"done":true},
        {"assignment_id":"a2","schedule_id":null,"therapist_id":"t1","due":true,"done":false}],
      "schedules":[{"id":"s1","patient_id":"p1","therapist_id":"t1","therapist_name":"Dana Reyes","starts_on":"2026-11-16","ends_on":"2026-11-29",
        "rest_weekdays":[7],"rest_dates":["2026-11-20"],"exercise_days":11,"rest_days":3,"exercise_count":1,"state":"exercise","days_left":9,"next_day":"2026-11-19"}]}"""

    private class Stack(private val answer:(String,JSONObject)->Pair<Int,String>) {
        val sent=mutableListOf<Pair<String,JSONObject>>()
        val repo=SupabaseAuthRepository(OkHttpClient.Builder().addInterceptor {chain ->
            val request=chain.request();val path=request.url.encodedPath
            val (code,body)=when {
                path.endsWith("user_roles") -> 200 to """[{"role":"therapist"}]"""
                path.contains("/rpc/") -> {
                    val buffer=okio.Buffer();request.body!!.writeTo(buffer)
                    val json=JSONObject(buffer.readUtf8()); val name=path.substringAfterLast('/')
                    sent+=name to json; answer(name,json)
                }
                else -> 200 to """{"access_token":"fixture-access","refresh_token":"fixture-refresh","user":{"id":"fixture-owner"}}"""
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code).message("fixture").body(body.toResponseBody("application/json".toMediaType())).build()
        }.build(),"https://fixture.invalid","public-fixture")
    }

    @Test fun readsTheDayAsTheServerWritesIt() {
        val read=ScheduleJson.day(JSONObject(day))
        assertEquals(LocalDate.parse("2026-11-18"),read.day)
        assertEquals(listOf(true,false),read.exercises.map {it.done})
        assertNull(read.exercises[1].scheduleId)
        val schedule=read.schedules.single()
        assertEquals(setOf(7),schedule.restWeekdays)
        assertEquals(listOf(LocalDate.parse("2026-11-20")),schedule.restDates)
        assertEquals(ScheduleState.EXERCISE,schedule.state)
        assertEquals(LocalDate.parse("2026-11-19"),schedule.nextDay)
        assertEquals("Dana Reyes",schedule.therapistName)
        assertEquals(9,schedule.daysLeft)
    }

    @Test fun savesWeekdaysAndDatesSortedAndOnce()=runBlocking {
        val stack=Stack {_,_ -> 200 to JSONObject(day).getJSONArray("schedules").getJSONObject(0).toString()}
        stack.repo.signIn("fixture@example.test","fixture-password")
        val saved=stack.repo.saveSchedule(ScheduleDraft("s1","p1",LocalDate.parse("2026-11-16"),LocalDate.parse("2026-11-29"),setOf(7,1),
            listOf(LocalDate.parse("2026-11-25"),LocalDate.parse("2026-11-20"),LocalDate.parse("2026-11-25"))))
        val (name,body)=stack.sent.single()
        assertEquals("save_exercise_schedule",name)
        assertEquals("[1,7]",body.getJSONArray("p_rest_weekdays").toString())
        assertEquals("""["2026-11-20","2026-11-25"]""",body.getJSONArray("p_rest_dates").toString())
        assertEquals("2026-11-16",body.getString("p_starts_on"))
        assertEquals("s1",saved.id)
    }

    @Test fun aNewExerciseInAScheduleGoesThroughTheScheduledFunction()=runBlocking {
        val stack=Stack {_,_ -> 200 to "\"version\""}
        stack.repo.signIn("fixture@example.test","fixture-password")
        val draft=PrescriptionDraft("assignment","version","patient","exercise",BodySide.LEFT,20.0,90.0,5)
        stack.repo.publishPrescription(draft.copy(scheduleId="s1"))
        stack.repo.publishPrescription(draft.copy(requestId="edit"))
        assertEquals(listOf("publish_scheduled_prescription","publish_prescription"),stack.sent.map {it.first})
        assertEquals("s1",stack.sent[0].second.getString("p_schedule"))
        assertFalse(stack.sent[1].second.has("p_schedule"))
    }

    @Test fun endsRemovesAndReadsTheDayForOnePatient()=runBlocking {
        val stack=Stack {name,_ -> 200 to if(name=="exercise_day") day else "null"}
        stack.repo.signIn("fixture@example.test","fixture-password")
        stack.repo.endSchedule("s1")
        stack.repo.stopExercise("a1")
        assertEquals(1,stack.repo.loadExerciseDay("p1").schedules.size)
        assertEquals(listOf("end_exercise_schedule" to "s1","stop_exercise" to "a1","exercise_day" to "p1"),
            stack.sent.map {(name,body) -> name to (body.optString("p_schedule").ifEmpty {body.optString("p_assignment").ifEmpty {body.getString("p_patient")}})})
    }

    @Test fun namedScheduleRefusalsReachTheScreenAndOtherMessagesDoNot()=runBlocking {
        val stack=Stack {name,_ -> 400 to if(name=="save_exercise_schedule") """{"code":"P0001","message":"schedule_no_day"}""" else """{"code":"P0001","message":"relation exercise_schedules does not exist"}"""}
        stack.repo.signIn("fixture@example.test","fixture-password")
        val draft=ScheduleDraft("s1","p1",LocalDate.parse("2026-11-16"),LocalDate.parse("2026-11-16"))
        val named=runCatching {stack.repo.saveSchedule(draft)}.exceptionOrNull() as RemoteFailure
        assertEquals("schedule_no_day",named.code)
        val hidden=runCatching {stack.repo.endSchedule("s1")}.exceptionOrNull() as RemoteFailure
        assertNull(hidden.code)
    }
}
