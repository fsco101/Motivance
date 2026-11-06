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
            day.getJSONArray("slots").objects().map {BookingSlot(it.getString("starts_at"),it.getString("ends_at"),it.getInt("remaining"),it.optBoolean("mine"))})
    })

    fun booking(json:JSONObject)=Booking(json.getString("id"),json.getString("reference_no"),BookingStatus.of(json.getString("status")) ?: BookingStatus.PENDING,json.text("status_reason"),
        json.getString("starts_at"),json.getString("ends_at"),json.text("previous_starts_at"),json.text("therapist_name"),
        json.text("location").orEmpty(),json.text("cancel_until"),json.optBoolean("can_cancel"))

    fun bookings(json:JSONArray)=json.objects().map {booking(it)}
}
