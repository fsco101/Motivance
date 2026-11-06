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
                path=="/rest/v1/rpc/request_booking" -> booking
                path=="/rest/v1/rpc/cancel_my_booking" -> booking
                else -> """{"access_token":"fixture-access","refresh_token":"fixture-refresh","user":{"id":"fixture-patient"}}"""
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(if(refused!=null) 400 else 200).message("fixture").body(body.toResponseBody("application/json".toMediaType())).build()
        }.build()
        return SupabaseAuthRepository(client,"https://fixture.invalid","public-fixture").also {runBlocking {it.signIn("fixture@example.test","fixture-password")}}
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
