package com.motivance.domain

/** Which push switch a kind answers to. Mirrors notification_group() on the server. */
enum class NotificationGroup { BOOKINGS, EXERCISE_PLAN, SESSION_RESULTS, INACTIVITY, CARE_TEAM, PRACTICE, MESSAGES, MISSED_DAYS }

enum class NotificationKind(val key:String,val group:NotificationGroup=NotificationGroup.BOOKINGS) {
    CONFIRMED("confirmed"),REJECTED("rejected"),CANCELLED("cancelled"),RESCHEDULED("rescheduled"),THERAPIST_CHANGED("therapist_changed"),RETURNED_TO_PENDING("returned_to_pending"),
    SESSION_ASSIGNED("session_assigned"),SESSION_MOVED("session_moved"),SESSION_CANCELLED("session_cancelled"),SESSION_REMOVED("session_removed"),
    REQUEST_RECEIVED("request_received"),PATIENT_CANCELLED("patient_cancelled"),NEEDS_THERAPIST("needs_therapist"),REMINDER("reminder"),SESSION_REMINDER("session_reminder"),PLACE_OPEN("place_open"),PATIENT_RESCHEDULED("patient_rescheduled"),
    SERIES_BOOKED("series_booked"),SERIES_ASSIGNED("series_assigned"),SERIES_CANCELLED("series_cancelled"),SESSION_SERIES_CANCELLED("session_series_cancelled"),
    PLAN_UPDATED("plan_updated",NotificationGroup.EXERCISE_PLAN),SESSION_FINISHED("session_finished",NotificationGroup.SESSION_RESULTS),
    PRACTICE_REMINDER("practice_reminder",NotificationGroup.PRACTICE),PATIENT_INACTIVE("patient_inactive",NotificationGroup.INACTIVITY),
    CARE_LINKED("care_linked",NotificationGroup.CARE_TEAM),CARE_UNLINKED("care_unlinked",NotificationGroup.CARE_TEAM),
    PATIENT_LINKED("patient_linked",NotificationGroup.CARE_TEAM),PATIENT_UNLINKED("patient_unlinked",NotificationGroup.CARE_TEAM),
    CHAT_MESSAGE("chat_message",NotificationGroup.MESSAGES),EXERCISE_MISSED("exercise_missed",NotificationGroup.MISSED_DAYS);
    /** A kind this version does not know is left out, so a newer server never shows a blank row. */
    companion object {fun of(value:String)=entries.firstOrNull {it.key==value}}
}

/**
 * Facts rather than sentences: the app writes the text, so it follows the reader's language. Booking kinds have a session time,
 * and the others do not. The subject is the other person it is about, read when the bell is.
 */
data class AppNotification(
    val id:String,val kind:NotificationKind,val reference:String="",val startsAt:String?=null,val endsAt:String?=null,val previousStartsAt:String?=null,
    val patient:String?=null,val therapist:String?=null,val reason:String?=null,val readAt:String?=null,val createdAt:String="",
    /** A weekly course is one notification, so it says how many sessions and when the last one is. */
    val sessions:Int=0,val lastStartsAt:String?=null,
    val subjectId:String?=null,val subjectName:String?=null,val subjectPhoto:String?=null,
    /** A finished session's repetitions, and how many days an inactive patient has been quiet. */
    val completed:Int?=null,val target:Int?=null,val days:Int?=null,
    /** For a new message: which conversation, and who wrote. Never the words. */
    val conversationId:String?=null,val sender:String?=null,
    /** A missed exercise day (#128): the calendar day, and how many of the exercises due were done. */
    val day:String?=null,val due:Int?=null,val done:Int?=null,
) {
    val unread get()=readAt==null
}
data class NotificationInbox(val unread:Int=0,val items:List<AppNotification> = emptyList())

/** Where opening a notification goes. Mirrors notificationTarget() on the web. */
sealed interface NotificationDestination {
    data object Bookings:NotificationDestination
    data object Schedule:NotificationDestination
    data object Exercises:NotificationDestination
    data object Home:NotificationDestination
    data object Patients:NotificationDestination
    data class Patient(val id:String):NotificationDestination
    /** A conversation, or the list of them when the notification does not say which. */
    data class Conversation(val id:String?):NotificationDestination
    /** A Scheduler's requests are on the web, so opening one only marks it read. */
    data object Stay:NotificationDestination
}

fun AppNotification.destination(workspace:UserRole?):NotificationDestination=when(kind) {
    NotificationKind.PLAN_UPDATED,NotificationKind.PRACTICE_REMINDER -> NotificationDestination.Exercises
    NotificationKind.CARE_LINKED,NotificationKind.CARE_UNLINKED -> NotificationDestination.Home
    NotificationKind.SESSION_FINISHED,NotificationKind.PATIENT_INACTIVE,NotificationKind.PATIENT_LINKED,NotificationKind.EXERCISE_MISSED ->
        subjectId?.let {NotificationDestination.Patient(it)} ?: NotificationDestination.Patients
    NotificationKind.PATIENT_UNLINKED -> NotificationDestination.Patients
    NotificationKind.CHAT_MESSAGE -> NotificationDestination.Conversation(conversationId)
    else -> when(workspace) {
        UserRole.PATIENT -> NotificationDestination.Bookings
        UserRole.THERAPIST -> NotificationDestination.Schedule
        else -> NotificationDestination.Stay
    }
}

/** What reaches this phone. The bell always shows everything; these only decide what is pushed. */
data class NotificationSettings(
    val bookings:Boolean=true,val exercisePlan:Boolean=true,val sessionResults:Boolean=true,val inactivity:Boolean=true,val careTeam:Boolean=true,
    /** "HH:MM" on a 24-hour clock in the center's time zone, or null for no daily reminder. */
    val reminderTime:String?=null,
    val messages:Boolean=true,
    val missedDays:Boolean=true,
) {
    fun allows(group:NotificationGroup)=when(group) {
        NotificationGroup.BOOKINGS -> bookings
        NotificationGroup.EXERCISE_PLAN -> exercisePlan
        NotificationGroup.SESSION_RESULTS -> sessionResults
        NotificationGroup.INACTIVITY -> inactivity
        NotificationGroup.CARE_TEAM -> careTeam
        NotificationGroup.PRACTICE -> reminderTime!=null
        NotificationGroup.MESSAGES -> messages
        NotificationGroup.MISSED_DAYS -> missedDays
    }
    fun with(group:NotificationGroup,on:Boolean)=when(group) {
        NotificationGroup.BOOKINGS -> copy(bookings=on)
        NotificationGroup.EXERCISE_PLAN -> copy(exercisePlan=on)
        NotificationGroup.SESSION_RESULTS -> copy(sessionResults=on)
        NotificationGroup.INACTIVITY -> copy(inactivity=on)
        NotificationGroup.CARE_TEAM -> copy(careTeam=on)
        NotificationGroup.PRACTICE -> copy(reminderTime=if(on) reminderTime ?: DEFAULT_REMINDER else null)
        NotificationGroup.MESSAGES -> copy(messages=on)
        NotificationGroup.MISSED_DAYS -> copy(missedDays=on)
    }
    companion object {
        const val DEFAULT_REMINDER="18:00"
        private val TIME=Regex("^([01][0-9]|2[0-3]):[0-5][0-9]$")
        fun validTime(value:String)=TIME.matches(value)
    }
}

/**
 * The switches that mean something for an account, in the order they are shown. A patient hears about their plan and practice,
 * a therapist about their patients, and everyone who books or is booked about bookings. An administrator alone has no bell.
 */
fun notificationGroupsFor(roles:Set<UserRole>):List<NotificationGroup> {
    val patient=UserRole.PATIENT in roles && roles.none {it==UserRole.THERAPIST || it==UserRole.SCHEDULER || it==UserRole.ADMIN}
    val therapist=UserRole.THERAPIST in roles
    val scheduler=UserRole.SCHEDULER in roles
    return buildList {
        if(patient || therapist || scheduler) add(NotificationGroup.BOOKINGS)
        if(patient) {add(NotificationGroup.EXERCISE_PLAN);add(NotificationGroup.PRACTICE)}
        if(therapist) {add(NotificationGroup.SESSION_RESULTS);add(NotificationGroup.INACTIVITY);add(NotificationGroup.MISSED_DAYS)}
        if(patient || therapist) add(NotificationGroup.CARE_TEAM)
        // Only a patient and their therapist talk.
        if(patient || therapist) add(NotificationGroup.MESSAGES)
    }
}

interface NotificationRepository {
    suspend fun loadNotifications():NotificationInbox
    /** With no list, everything. The server only ever touches the caller's own. Returns how many stay unread. */
    suspend fun markNotificationsRead(ids:List<String>?):Int
    /** Email has no app to choose its language, so the server is told the reader's. */
    suspend fun saveLanguage(language:String)
    /** Tells the server this phone can be reached. Only the app knows about Firebase, so all this takes is the token. */
    suspend fun registerDevice(token:String)
    suspend fun unregisterDevice(token:String)
    suspend fun loadNotificationSettings():NotificationSettings {throw UnsupportedOperationException()}
    /** Returns what the server saved, which is what the switches should then show. */
    suspend fun saveNotificationSettings(settings:NotificationSettings):NotificationSettings {throw UnsupportedOperationException()}
}

/** Whether this phone hears push notifications for the signed-in account. Off by default, so nothing here needs Firebase. */
interface PushDevices {
    suspend fun register() {}
    suspend fun unregister() {}
    object None:PushDevices
}
