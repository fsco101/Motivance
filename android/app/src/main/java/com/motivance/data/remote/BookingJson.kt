package com.motivance.data.remote

import com.motivance.domain.*
import org.json.JSONArray
import org.json.JSONObject

/** Reads the booking functions' JSON. Mirrors web/src/data/booking.ts. */
object BookingJson {
    private fun JSONObject.text(key:String):String?=if(isNull(key)) null else getString(key)
    private fun JSONArray.objects()=(0 until length()).map {getJSONObject(it)}

    fun availability(json:JSONObject)=BookingAvailability(json.getJSONArray("days").objects().map {day ->
        BookingDay(day.getString("date"),BookingDayStatus.of(day.getString("status")),day.text("holiday"),
            day.getJSONArray("slots").objects().map {BookingSlot(it.getString("starts_at"),it.getString("ends_at"),it.getInt("remaining"),it.optBoolean("mine"),it.optBoolean("waiting"))})
    })

    fun booking(json:JSONObject)=Booking(json.getString("id"),json.getString("reference_no"),BookingStatus.of(json.getString("status")) ?: BookingStatus.PENDING,json.text("status_reason"),
        json.getString("starts_at"),json.getString("ends_at"),json.text("previous_starts_at"),json.text("therapist_name"),
        json.text("location").orEmpty(),json.text("cancel_until"),json.optBoolean("can_cancel"),json.text("reschedule_until"),json.optBoolean("can_reschedule"),json.optInt("reschedules_left"))

    fun bookings(json:JSONArray)=json.objects().map {booking(it)}

    /** A kind this version does not know is left out, so a newer server never shows a blank row. */
    fun waitlist(json:JSONArray)=json.objects().map {WaitlistEntry(it.getString("id"),it.getString("starts_at"),it.getString("ends_at"),it.getBoolean("open"))}

    fun inbox(json:JSONObject)=NotificationInbox(json.getInt("unread"),json.getJSONArray("rows").objects().mapNotNull {row ->
        NotificationKind.of(row.getString("kind"))?.let {kind ->
            val data=row.getJSONObject("data")
            AppNotification(row.getString("id"),kind,data.text("reference_no").orEmpty(),data.getString("starts_at"),data.getString("ends_at"),data.text("previous_starts_at"),
                data.text("patient_name"),data.text("therapist_name"),data.text("reason"),row.text("read_at"),row.getString("created_at"))
        }
    })

    private fun session(json:JSONObject)=ScheduleSession(json.getString("id"),json.getString("reference_no"),BookingStatus.of(json.getString("status")) ?: BookingStatus.CONFIRMED,
        json.getString("starts_at"),json.getString("ends_at"),json.text("location").orEmpty(),json.text("therapist_name"),json.text("patient_id"),json.text("patient_name"),json.optBoolean("linked"),
        json.text("attendance"),json.optBoolean("started"))

    fun schedule(json:JSONObject)=Schedule(json.getJSONArray("days").objects().map {day ->
        ScheduleDay(day.getString("date"),BookingDayStatus.of(day.getString("status")),day.text("holiday"),day.getJSONArray("rows").objects().map {row ->
            ScheduleRow(row.getString("starts_at"),row.getString("ends_at"),if(row.isNull("session")) null else session(row.getJSONObject("session")),row.optBoolean("on_leave"))
        },day.optBoolean("on_leave"))
    })
}
