package com.motivance.data.remote

import com.motivance.domain.*
import org.json.JSONArray
import org.json.JSONObject

/** Reads the booking functions' JSON. Mirrors web/src/data/booking.ts. */
object BookingJson {
    private fun JSONObject.text(key:String):String?=if(!has(key) || isNull(key)) null else getString(key)
    private fun JSONArray.objects()=(0 until length()).map {getJSONObject(it)}

    fun availability(json:JSONObject)=BookingAvailability(json.getJSONArray("days").objects().map {day ->
        BookingDay(day.getString("date"),BookingDayStatus.of(day.getString("status")),day.text("holiday"),
            day.getJSONArray("slots").objects().map {BookingSlot(it.getString("starts_at"),it.getString("ends_at"),it.getInt("remaining"),it.optBoolean("mine"),it.optBoolean("waiting"))})
    })

    fun booking(json:JSONObject)=Booking(json.getString("id"),json.getString("reference_no"),BookingStatus.of(json.getString("status")) ?: BookingStatus.PENDING,json.text("status_reason"),
        json.getString("starts_at"),json.getString("ends_at"),json.text("previous_starts_at"),json.text("therapist_name"),
        json.text("location").orEmpty(),json.text("cancel_until"),json.optBoolean("can_cancel"),json.text("reschedule_until"),json.optBoolean("can_reschedule"),json.optInt("reschedules_left"),
        json.text("therapist_photo"))

    fun bookings(json:JSONArray)=json.objects().map {booking(it)}

    /** A kind this version does not know is left out, so a newer server never shows a blank row. */
    fun waitlist(json:JSONArray)=json.objects().map {WaitlistEntry(it.getString("id"),it.getString("starts_at"),it.getString("ends_at"),it.getBoolean("open"))}

    private fun JSONObject.number(key:String):Int?=if(!has(key) || isNull(key)) null else getInt(key)

    /** Only booking kinds have a session time, so every fact is optional here. */
    fun inbox(json:JSONObject)=NotificationInbox(json.getInt("unread"),json.getJSONArray("rows").objects().mapNotNull {row ->
        NotificationKind.of(row.getString("kind"))?.let {kind ->
            val data=row.getJSONObject("data")
            AppNotification(row.getString("id"),kind,data.text("reference_no").orEmpty(),data.text("starts_at"),data.text("ends_at"),data.text("previous_starts_at"),
                data.text("patient_name"),data.text("therapist_name"),data.text("reason"),row.text("read_at"),row.getString("created_at"),data.optInt("sessions"),data.text("last_starts_at"),
                row.text("subject_id"),row.text("subject_name"),row.text("subject_photo"),data.number("completed"),data.number("target"),data.number("days"))
        }
    })

    /** A switch the server left out stays on, as it is for someone who never chose. */
    fun settings(json:JSONObject)=NotificationSettings(json.optBoolean("bookings",true),json.optBoolean("exercise_plan",true),json.optBoolean("session_results",true),
        json.optBoolean("inactivity",true),json.optBoolean("care_team",true),json.text("reminder_time"))

    fun settingsBody(settings:NotificationSettings):JSONObject=JSONObject().put("p_bookings",settings.bookings).put("p_exercise_plan",settings.exercisePlan)
        .put("p_session_results",settings.sessionResults).put("p_inactivity",settings.inactivity).put("p_care_team",settings.careTeam)
        .put("p_reminder_time",settings.reminderTime ?: JSONObject.NULL)

    private fun session(json:JSONObject)=ScheduleSession(json.getString("id"),json.getString("reference_no"),BookingStatus.of(json.getString("status")) ?: BookingStatus.CONFIRMED,
        json.getString("starts_at"),json.getString("ends_at"),json.text("location").orEmpty(),json.text("therapist_name"),json.text("patient_id"),json.text("patient_name"),json.optBoolean("linked"),
        json.text("attendance"),json.optBoolean("started"),json.text("therapist_photo"),json.text("patient_photo"))

    fun schedule(json:JSONObject)=Schedule(json.getJSONArray("days").objects().map {day ->
        ScheduleDay(day.getString("date"),BookingDayStatus.of(day.getString("status")),day.text("holiday"),day.getJSONArray("rows").objects().map {row ->
            ScheduleRow(row.getString("starts_at"),row.getString("ends_at"),if(row.isNull("session")) null else session(row.getJSONObject("session")),row.optBoolean("on_leave"))
        },day.optBoolean("on_leave"))
    })
}
