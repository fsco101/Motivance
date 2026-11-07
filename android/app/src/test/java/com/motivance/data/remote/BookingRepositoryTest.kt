package com.motivance.data.remote

import com.motivance.domain.*
import kotlinx.coroutines.runBlocking
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class BookingRepositoryTest {
    private val bodies=mutableMapOf<String,JSONObject>()
    private var refusal:String?=null
    private val booking="""{"id":"b1","reference_no":"BK-2026-000001","status":"confirmed","status_reason":null,"starts_at":"2026-12-07T01:00:00+00:00","ends_at":"2026-12-07T02:00:00+00:00",
        "previous_starts_at":null,"therapist_id":"t","therapist_name":"Dana Reyes","attendance":null,"created_at":"2026-11-06T01:00:00+00:00","location":"Quezon City","cancel_until":"2026-12-06T01:00:00+00:00","can_cancel":true}"""
    private fun repository():SupabaseAuthRepository {
        val client=OkHttpClient.Builder().addInterceptor {chain ->
            val request=chain.request();val path=request.url.encodedPath
            request.body?.let {val b=okio.Buffer();it.writeTo(b);val text=b.readUtf8();if(text.startsWith("{")) bodies[path]=JSONObject(text)}
            val refused=refusal?.takeIf {path.startsWith("/rest/v1/rpc/")}
            val body=when {
                refused!=null -> """{"code":"P0001","details":null,"hint":null,"message":"$refused"}"""
                path=="/rest/v1/user_roles" -> """[{"role":"patient"}]"""
                path=="/rest/v1/rpc/booking_availability" -> """{"time_zone":"Asia/Manila","slot_minutes":60,"days":[
                    {"date":"2026-12-07","status":"open","holiday":null,"slots":[{"starts_at":"2026-12-07T01:00:00+00:00","ends_at":"2026-12-07T02:00:00+00:00","remaining":2,"mine":true}]},
                    {"date":"2026-12-08","status":"holiday","holiday":"Feast","slots":[]},{"date":"2026-12-09","status":"too_soon","holiday":null,"slots":[]}]}"""
                path=="/rest/v1/rpc/my_bookings" -> "[$booking]"
                path=="/rest/v1/rpc/my_waitlist" -> """[{"id":"w1","starts_at":"2026-12-09T02:00:00+00:00","ends_at":"2026-12-09T03:00:00+00:00","open":true}]"""
                path=="/rest/v1/rpc/join_waitlist" -> """{"id":"w1","starts_at":"2026-12-09T02:00:00+00:00","ends_at":"2026-12-09T03:00:00+00:00"}"""
                path=="/rest/v1/rpc/leave_waitlist" -> ""
                path=="/rest/v1/rpc/reschedule_my_booking" -> booking
                path=="/rest/v1/rpc/mark_attendance" -> """{"id":"b1","attendance":"no_show"}"""
                path=="/rest/v1/rpc/my_notifications" -> """{"unread":1,"rows":[
                    {"id":"n1","kind":"rescheduled","booking_id":"b1","read_at":null,"created_at":"2026-12-01T02:00:00+00:00","data":{"reference_no":"BK-2026-000001","starts_at":"2026-12-14T02:00:00+00:00",
                     "ends_at":"2026-12-14T03:00:00+00:00","previous_starts_at":"2026-12-07T02:00:00+00:00","patient_name":"Ana","therapist_name":"Dana","reason":"Training"}},
                    {"id":"n4","kind":"reminder","booking_id":"b1","read_at":"2026-12-01T02:00:00+00:00","created_at":"2026-12-01T02:00:00+00:00","data":{"reference_no":"BK-2026-000001","starts_at":"2026-12-14T02:00:00+00:00",
                     "ends_at":"2026-12-14T03:00:00+00:00","patient_name":"Ana","therapist_name":"Dana","window":"24h"}},
                    {"id":"n2","kind":"from_a_newer_server","booking_id":null,"read_at":null,"created_at":"2026-12-01T02:00:00+00:00","data":{}},
                    {"id":"n3","kind":"confirmed","booking_id":"b1","read_at":"2026-12-02T02:00:00+00:00","created_at":"2026-11-30T02:00:00+00:00","data":{"reference_no":"BK-2026-000001","starts_at":"2026-12-14T02:00:00+00:00",
                     "ends_at":"2026-12-14T03:00:00+00:00","previous_starts_at":null,"patient_name":"Ana","therapist_name":null,"reason":null}}]}"""
                path=="/rest/v1/rpc/mark_notifications_read" -> "0"
                path=="/rest/v1/rpc/set_my_language" -> ""
                path=="/rest/v1/rpc/my_schedule" -> """{"time_zone":"Asia/Manila","days":[{"date":"2026-12-07","status":"open","holiday":null,"rows":[
                    {"starts_at":"2026-12-07T00:00:00+00:00","ends_at":"2026-12-07T01:00:00+00:00","session":null},
                    {"starts_at":"2026-12-07T01:00:00+00:00","ends_at":"2026-12-07T02:00:00+00:00","session":$booking}]},
                    {"date":"2026-12-08","status":"holiday","holiday":"Feast","rows":[]}]}"""
                path=="/rest/v1/rpc/therapist_schedule" -> """{"time_zone":"Asia/Manila","days":[{"date":"2026-12-07","status":"open","holiday":null,"on_leave":true,"rows":[
                    {"starts_at":"2026-12-07T00:00:00+00:00","ends_at":"2026-12-07T01:00:00+00:00","session":null,"on_leave":true},
                    {"starts_at":"2026-12-07T01:00:00+00:00","ends_at":"2026-12-07T02:00:00+00:00","session":{"id":"b1","reference_no":"BK-2026-000001","status":"rescheduled",
                    "starts_at":"2026-12-07T01:00:00+00:00","ends_at":"2026-12-07T02:00:00+00:00","attendance":null,"location":"","patient_id":"p1","patient_name":"Ana Dela Cruz","linked":false}}]}]}"""
                path=="/rest/v1/rpc/request_booking" -> booking
                path=="/rest/v1/rpc/cancel_my_booking" -> booking
                else -> """{"access_token":"fixture-access","refresh_token":"fixture-refresh","user":{"id":"fixture-patient"}}"""
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(if(refused!=null) 400 else 200).message("fixture").body(body.toResponseBody("application/json".toMediaType())).build()
        }.build()
        return SupabaseAuthRepository(client,"https://fixture.invalid","public-fixture").also {runBlocking {it.signIn("fixture@example.test","fixture-password")}}
    }

    @Test fun aPatientsScheduleKeepsEachHourAndWhoTheyWillSee()=runBlocking {
        val result=repository().loadSchedule("2026-12-01","2026-12-31",false)
        assertEquals("2026-12-31",bodies["/rest/v1/rpc/my_schedule"]!!.getString("p_to"))
        val day=result.days[0]
        assertNull("An empty hour stays empty",day.rows[0].session)
        val session=day.rows[1].session!!
        assertEquals("2026-12-07T01:00:00+00:00",session.startsAt)
        assertEquals("2026-12-07T02:00:00+00:00",session.endsAt)
        assertEquals("Dana Reyes",session.therapist)
        assertEquals("Quezon City",session.location)
        assertNull(session.patient)
        assertEquals(listOf(session),day.sessions)
        assertEquals(BookingDayStatus.HOLIDAY,result.days[1].status)
        assertEquals("Feast",result.days[1].holiday)
    }

    @Test fun aTherapistsScheduleNamesThePatientAndSaysWhetherTheyAreLinked()=runBlocking {
        val session=repository().loadSchedule("2026-12-01","2026-12-31",true).days[0].sessions.single()
        assertTrue("/rest/v1/rpc/therapist_schedule" in bodies)
        assertFalse("/rest/v1/rpc/my_schedule" in bodies)
        assertEquals(BookingStatus.RESCHEDULED,session.status)
        assertEquals("Ana Dela Cruz",session.patient)
        assertEquals("p1",session.patientId)
        assertFalse(session.linked)
        assertNull(session.therapist)
    }

    @Test fun aTherapistsScheduleKeepsTheirLeaveOnTheDayAndTheHour()=runBlocking {
        val day=repository().loadSchedule("2026-12-01","2026-12-31",true).days[0]
        assertTrue(day.onLeave)
        assertEquals(listOf(true,false),day.rows.map {it.onLeave})
        assertFalse("A patient's schedule has none",repository().loadSchedule("2026-12-01","2026-12-31",false).days[0].onLeave)
    }

    @Test fun anInboxKeepsTheFactsTheTextIsWrittenFrom()=runBlocking {
        val inbox=repository().loadNotifications()
        assertEquals(1,inbox.unread)
        val note=inbox.items.first()
        assertEquals(NotificationKind.RESCHEDULED,note.kind)
        assertEquals("2026-12-14T02:00:00+00:00",note.startsAt)
        assertEquals("2026-12-07T02:00:00+00:00",note.previousStartsAt)
        assertEquals("Dana",note.therapist)
        assertEquals("Training",note.reason)
        assertTrue(note.unread)
        assertFalse(inbox.items.last().unread)
        assertNull(inbox.items.last().therapist)
    }

    @Test fun theReadersLanguageIsSent()=runBlocking {
        repository().saveLanguage("fil")
        assertEquals("fil",bodies["/rest/v1/rpc/set_my_language"]!!.getString("p_language"))
    }

    @Test fun markingSendsTheSessionAndTheMark()=runBlocking {
        repository().markAttendance("b1","no_show")
        val body=bodies["/rest/v1/rpc/mark_attendance"]
        assertEquals("b1",body?.getString("p_booking"))
        assertEquals("no_show",body?.getString("p_attendance"))
    }
    @Test fun aSessionSaysWhetherItHasStartedAndWhatWasMarked() {
        val days="""{"days":[{"date":"2026-11-02","status":"open","holiday":null,"rows":[{"starts_at":"2026-11-02T01:00:00+00:00","ends_at":"2026-11-02T02:00:00+00:00","session":
            {"id":"b1","reference_no":"BK-2026-000001","status":"confirmed","starts_at":"2026-11-02T01:00:00+00:00","ends_at":"2026-11-02T02:00:00+00:00","location":"","attendance":"attended","started":true,"patient_name":"Ana"}}]}]}"""
        val session=BookingJson.schedule(JSONObject(days)).days.single().sessions.single()
        assertEquals("attended",session.attendance)
        assertTrue(session.started)
    }
    @Test fun movingSendsTheSessionAndTheTime()=runBlocking {
        repository().rescheduleBooking("b1","2026-12-09T02:00:00+00:00")
        val body=bodies["/rest/v1/rpc/reschedule_my_booking"]
        assertEquals("b1",body?.getString("p_booking"))
        assertEquals("2026-12-09T02:00:00+00:00",body?.getString("p_starts"))
    }
    @Test fun aBookingSaysWhetherItCanBeMoved() {
        val moved=BookingJson.booking(JSONObject(booking).put("can_reschedule",true).put("reschedule_until","2026-12-06T01:00:00+00:00").put("reschedules_left",1))
        assertTrue(moved.canReschedule)
        assertEquals("2026-12-06T01:00:00+00:00",moved.rescheduleUntil)
        assertEquals(1,moved.reschedulesLeft)
        assertFalse("An older server says nothing, and nothing moves",BookingJson.booking(JSONObject(booking)).canReschedule)
    }
    @Test fun aPatientsMoveIsRead() {
        val note=BookingJson.inbox(JSONObject("""{"unread":1,"rows":[{"id":"n8","kind":"patient_rescheduled","booking_id":"b1","read_at":null,"created_at":"2026-12-01T02:00:00+00:00",
            "data":{"reference_no":"BK-2026-000001","starts_at":"2026-12-09T02:00:00+00:00","ends_at":"2026-12-09T03:00:00+00:00","patient_name":"Ana"}}]}""")).items.single()
        assertEquals(NotificationKind.PATIENT_RESCHEDULED,note.kind)
        assertEquals("Ana",note.patient)
    }
    @Test fun aPlaceOnTheWaitlistIsRead()=runBlocking {
        assertEquals(listOf(WaitlistEntry("w1","2026-12-09T02:00:00+00:00","2026-12-09T03:00:00+00:00",open=true)),repository().loadWaitlist())
    }
    @Test fun joiningAndLeavingSendTheTime()=runBlocking {
        val repository=repository()
        repository.joinWaitlist("2026-12-09T02:00:00+00:00")
        assertEquals("2026-12-09T02:00:00+00:00",bodies["/rest/v1/rpc/join_waitlist"]?.getString("p_starts"))
        repository.leaveWaitlist("2026-12-09T02:00:00+00:00")
        assertEquals("2026-12-09T02:00:00+00:00",bodies["/rest/v1/rpc/leave_waitlist"]?.getString("p_starts"))
    }
    /** A place is a time, not yet a session, so it has no reference, and that must not lose the rest of the inbox. */
    @Test fun aPlaceOpeningHasNoReference()=runBlocking {
        val note=BookingJson.inbox(JSONObject("""{"unread":1,"rows":[{"id":"n9","kind":"place_open","booking_id":null,"read_at":null,"created_at":"2026-12-01T02:00:00+00:00",
            "data":{"starts_at":"2026-12-09T02:00:00+00:00","ends_at":"2026-12-09T03:00:00+00:00"}}]}""")).items.single()
        assertEquals(NotificationKind.PLACE_OPEN,note.kind)
        assertEquals("",note.reference)
        assertEquals("2026-12-09T02:00:00+00:00",note.startsAt)
    }
    @Test fun aReminderIsRead()=runBlocking {
        assertEquals(NotificationKind.REMINDER,repository().loadNotifications().items.first {it.id=="n4"}.kind)
    }

    @Test fun aKindFromANewerServerIsLeftOut()=runBlocking {
        assertEquals(listOf("n1","n4","n3"),repository().loadNotifications().items.map {it.id})
    }

    @Test fun markingSendsTheIdsOrNoneForEverything()=runBlocking {
        val remote=repository()
        assertEquals(0,remote.markNotificationsRead(listOf("n1")))
        assertEquals("n1",bodies["/rest/v1/rpc/mark_notifications_read"]!!.getJSONArray("p_ids").getString(0))
        remote.markNotificationsRead(null)
        assertTrue(bodies["/rest/v1/rpc/mark_notifications_read"]!!.isNull("p_ids"))
    }

    @Test fun availabilityKeepsEachDateAndItsSpecificTimes()=runBlocking {
        val result=repository().loadAvailability("2026-12-01","2026-12-31")
        assertEquals("2026-12-01",bodies["/rest/v1/rpc/booking_availability"]!!.getString("p_from"))
        assertEquals(BookingDayStatus.OPEN,result.days[0].status)
        assertEquals(BookingSlot("2026-12-07T01:00:00+00:00","2026-12-07T02:00:00+00:00",2,true),result.days[0].slots.single())
        assertEquals("Feast",result.days[1].holiday)
        assertEquals(BookingDayStatus.TOO_SOON,result.days[2].status)
        assertNull("JSON null must not become the text \"null\"",result.days[0].holiday)
    }

    @Test fun aRequestSendsItsIdAndTheChosenTime()=runBlocking {
        val booking=repository().requestBooking("request-id","2026-12-07T01:00:00+00:00")
        val sent=bodies["/rest/v1/rpc/request_booking"]!!
        assertEquals("request-id",sent.getString("p_request"))
        assertEquals("2026-12-07T01:00:00+00:00",sent.getString("p_starts"))
        assertEquals("BK-2026-000001",booking.reference)
    }

    @Test fun bookingsCarryWhatThePatientNeeds()=runBlocking {
        val booking=repository().loadMyBookings().single()
        assertEquals(BookingStatus.CONFIRMED,booking.status)
        assertEquals("Dana Reyes",booking.therapist)
        assertEquals("Quezon City",booking.location)
        assertTrue(booking.canCancel)
        assertNull(booking.reason)
    }

    @Test fun aServerRefusalReachesTheAppAsItsStableCode()=runBlocking {
        val repo=repository();refusal="booking_full"
        val failure=runCatching {repo.requestBooking("id","2026-12-07T01:00:00+00:00")}.exceptionOrNull() as RemoteFailure
        assertEquals("booking_full",failure.code)
        assertEquals(400,failure.status)
    }

    /** The server's other messages can name tables and columns, so only booking codes pass through. */
    @Test fun anyOtherMessageIsDiscarded()=runBlocking {
        val repo=repository();refusal="relation public.bookings does not exist"
        val failure=runCatching {repo.loadMyBookings()}.exceptionOrNull() as RemoteFailure
        assertNull(failure.code)
    }

    @Test fun cancellingNamesTheBooking()=runBlocking {
        repository().cancelBooking("b1")
        assertEquals("b1",bodies["/rest/v1/rpc/cancel_my_booking"]!!.getString("p_booking"))
    }
}
