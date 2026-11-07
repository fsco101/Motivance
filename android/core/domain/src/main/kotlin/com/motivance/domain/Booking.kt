package com.motivance.domain

import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.YearMonth
import java.time.ZoneId

/** Session times read in the center's zone, so a phone set to another zone still shows the real time. */
const val CENTER_ZONE="Asia/Manila"

enum class BookingDayStatus { OPEN, CLOSED, HOLIDAY, CLOSURE, PAST, TOO_SOON, TOO_FAR;
    companion object {fun of(value:String)=entries.firstOrNull {it.name.equals(value,ignoreCase=true)} ?: CLOSED}
}
data class BookingSlot(val startsAt:String,val endsAt:String,val remaining:Int,val mine:Boolean=false,val waiting:Boolean=false) {
    val bookable get()=remaining>0 && !mine
    /** A full time can still be waited for, by anyone without a session in it. */
    val joinable get()=remaining==0 && !mine
}
/** A place in the line for a full time. Open means a place is free now, and the first to book gets it. */
data class WaitlistEntry(val id:String,val startsAt:String,val endsAt:String,val open:Boolean)
data class BookingDay(val date:String,val status:BookingDayStatus,val holiday:String?=null,val slots:List<BookingSlot> = emptyList()) {
    val hasPlaces get()=status==BookingDayStatus.OPEN && slots.any {it.bookable}
}
data class BookingAvailability(val days:List<BookingDay> = emptyList()) {
    fun day(date:String)=days.firstOrNull {it.date==date}
}

enum class BookingStatus { PENDING, CONFIRMED, REJECTED, CANCELLED, RESCHEDULED;
    val active get()=this==PENDING || this==CONFIRMED || this==RESCHEDULED
    companion object {fun of(value:String)=entries.firstOrNull {it.name.equals(value,ignoreCase=true)}}
}
data class Booking(
    val id:String,val reference:String,val status:BookingStatus,val reason:String?,val startsAt:String,val endsAt:String,val previousStartsAt:String?,
    val therapist:String?,val location:String="",val cancelUntil:String?=null,val canCancel:Boolean=false,
    val rescheduleUntil:String?=null,val canReschedule:Boolean=false,val reschedulesLeft:Int=0,
) {
    fun upcoming(now:Instant)=status.active && bookingInstant(endsAt).isAfter(now)
}

/** A session a Scheduler has confirmed. A patient's names the therapist. A therapist's names the patient, and says whether their record can be opened. */
data class ScheduleSession(
    val id:String,val reference:String,val status:BookingStatus,val startsAt:String,val endsAt:String,val location:String="",
    val therapist:String?=null,val patientId:String?=null,val patient:String?=null,val linked:Boolean=false,
)
data class ScheduleRow(val startsAt:String,val endsAt:String,val session:ScheduleSession?=null,val onLeave:Boolean=false)
data class ScheduleDay(val date:String,val status:BookingDayStatus,val holiday:String?=null,val rows:List<ScheduleRow> = emptyList(),val onLeave:Boolean=false) {
    val sessions get()=rows.mapNotNull {it.session}
}
data class Schedule(val days:List<ScheduleDay> = emptyList()) {
    fun day(date:String)=days.firstOrNull {it.date==date}
    /** Where a month opens: the next date with a session, or today when nothing is ahead. A month with neither waits for a choice. */
    fun openingDate(today:LocalDate):String? {
        val date=today.toString()
        return days.firstOrNull {it.date>=date && it.sessions.isNotEmpty()}?.date ?: days.firstOrNull {it.date==date}?.date
    }
}

/** PostgreSQL writes an offset such as +00:00, which Instant.parse does not accept on every Android version. */
fun bookingInstant(value:String):Instant=OffsetDateTime.parse(value).toInstant()

/** Today at the center, which is not always today on the phone. */
fun centerToday(now:Instant=Instant.now()):LocalDate=now.atZone(ZoneId.of(CENTER_ZONE)).toLocalDate()

/** The soonest session still to come, whatever order the bookings arrive in. */
fun List<Booking>.nextSession(now:Instant=Instant.now())=filter {it.upcoming(now)}.minByOrNull {bookingInstant(it.startsAt)}

/** The dates of a month in Monday-first weeks, with null for the blanks around it. */
fun YearMonth.calendarWeeks():List<List<LocalDate?>> {
    val lead=atDay(1).dayOfWeek.value-1
    val cells=List<LocalDate?>(lead) {null}+(1..lengthOfMonth()).map {atDay(it)}
    return cells.chunked(7).map {week -> week+List(7-week.size) {null}}
}

interface BookingRepository {
    suspend fun loadAvailability(from:String,to:String):BookingAvailability
    /** [requestId] is chosen once per attempt, so retrying after a lost response returns the same booking. */
    suspend fun requestBooking(requestId:String,startsAt:String):Booking
    suspend fun loadMyBookings():List<Booking>
    suspend fun cancelBooking(id:String)
    suspend fun rescheduleBooking(id:String,startsAt:String)
    suspend fun loadWaitlist():List<WaitlistEntry>
    suspend fun joinWaitlist(startsAt:String)
    suspend fun leaveWaitlist(startsAt:String)
    /** [therapist] reads the sessions assigned to this person instead of their own as a patient. */
    suspend fun loadSchedule(from:String,to:String,therapist:Boolean):Schedule
}
