package com.motivance.domain

enum class NotificationKind(val key:String) {
    CONFIRMED("confirmed"),REJECTED("rejected"),CANCELLED("cancelled"),RESCHEDULED("rescheduled"),THERAPIST_CHANGED("therapist_changed"),RETURNED_TO_PENDING("returned_to_pending"),
    SESSION_ASSIGNED("session_assigned"),SESSION_MOVED("session_moved"),SESSION_CANCELLED("session_cancelled"),SESSION_REMOVED("session_removed"),
    REQUEST_RECEIVED("request_received"),PATIENT_CANCELLED("patient_cancelled"),NEEDS_THERAPIST("needs_therapist"),REMINDER("reminder"),SESSION_REMINDER("session_reminder"),PLACE_OPEN("place_open"),PATIENT_RESCHEDULED("patient_rescheduled"),
    SERIES_BOOKED("series_booked"),SERIES_ASSIGNED("series_assigned"),SERIES_CANCELLED("series_cancelled"),SESSION_SERIES_CANCELLED("session_series_cancelled");
    /** A kind this version does not know is left out, so a newer server never shows a blank row. */
    companion object {fun of(value:String)=entries.firstOrNull {it.key==value}}
}

/** Facts rather than sentences: the app writes the text, so it follows the reader's language. */
data class AppNotification(
    val id:String,val kind:NotificationKind,val reference:String,val startsAt:String,val endsAt:String,val previousStartsAt:String?=null,
    val patient:String?=null,val therapist:String?=null,val reason:String?=null,val readAt:String?=null,val createdAt:String="",
    /** A weekly course is one notification, so it says how many sessions and when the last one is. */
    val sessions:Int=0,val lastStartsAt:String?=null,
) {
    val unread get()=readAt==null
}
data class NotificationInbox(val unread:Int=0,val items:List<AppNotification> = emptyList())

interface NotificationRepository {
    suspend fun loadNotifications():NotificationInbox
    /** With no list, everything. The server only ever touches the caller's own. Returns how many stay unread. */
    suspend fun markNotificationsRead(ids:List<String>?):Int
    /** Email has no app to choose its language, so the server is told the reader's. */
    suspend fun saveLanguage(language:String)
}
