package com.motivance.feature.booking

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.motivance.R
import com.motivance.designsystem.*
import com.motivance.domain.*
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth

/** Patients can turn the calendar this far ahead. The server still decides what is bookable. */
private const val MONTHS_AHEAD=3L

@Composable internal fun rememberSessionFormat():SessionFormat {
    val locale=LocalConfiguration.current.locales[0]
    return remember(locale) {SessionFormat(locale)}
}

internal fun BookingStatus.label()=when(this) {
    BookingStatus.PENDING -> R.string.booking_status_pending
    BookingStatus.CONFIRMED -> R.string.booking_status_confirmed
    BookingStatus.REJECTED -> R.string.booking_status_rejected
    BookingStatus.CANCELLED -> R.string.booking_status_cancelled
    BookingStatus.RESCHEDULED -> R.string.booking_status_rescheduled
}
internal fun BookingStatus.tone()=when(this) {
    BookingStatus.CONFIRMED -> PillTone.POSITIVE
    BookingStatus.RESCHEDULED -> PillTone.PRIMARY
    BookingStatus.REJECTED -> PillTone.ATTENTION
    // Waiting is not a problem, so it does not look like one.
    BookingStatus.PENDING,BookingStatus.CANCELLED -> PillTone.NEUTRAL
}

/** A month of dates, Monday first. Used for booking now, and for My Schedule. */
@Composable internal fun MonthCalendar(month:YearMonth,selected:String?,today:LocalDate,canGoBack:Boolean,canGoForward:Boolean,
    onMonth:(YearMonth)->Unit,enabled:(LocalDate)->Boolean,marked:(LocalDate)->Boolean,quiet:(LocalDate)->Boolean={false},note:@Composable (LocalDate)->String?,onSelect:(LocalDate)->Unit) {
    val format=rememberSessionFormat()
    Column(verticalArrangement=Arrangement.spacedBy(4.dp)) {
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
            IconButton({onMonth(month.minusMonths(1))},enabled=canGoBack) {Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft,stringResource(R.string.booking_previous_month))}
            Text(format.month(month),Modifier.weight(1f).semantics {heading();liveRegion=LiveRegionMode.Polite},style=MaterialTheme.typography.titleMedium,textAlign=TextAlign.Center)
            IconButton({onMonth(month.plusMonths(1))},enabled=canGoForward) {Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight,stringResource(R.string.booking_next_month))}
        }
        Row(Modifier.fillMaxWidth()) {
            format.weekdays.forEach {Text(it,Modifier.weight(1f),style=MaterialTheme.typography.labelMedium,textAlign=TextAlign.Center,color=MaterialTheme.colorScheme.onSurfaceVariant)}
        }
        month.calendarWeeks().forEach {week ->
            Row(Modifier.fillMaxWidth()) {
                week.forEach {date ->
                    if(date==null) Spacer(Modifier.weight(1f).heightIn(min=48.dp))
                    else DayCell(date,date.toString()==selected,date==today,enabled(date),marked(date),quiet(date),format.calendarDay(date),note(date),Modifier.weight(1f)) {onSelect(date)}
                }
            }
        }
    }
}

/** A quiet day can be chosen but draws no eye, as on a schedule where only some dates hold anything. */
@Composable private fun DayCell(date:LocalDate,chosen:Boolean,today:Boolean,enabled:Boolean,marked:Boolean,quiet:Boolean,name:String,note:String?,modifier:Modifier,onClick:()->Unit) {
    val scheme=MaterialTheme.colorScheme
    val spoken=listOfNotNull(name,note).joinToString(", ")
    Box(modifier.heightIn(min=48.dp).padding(2.dp).clip(MaterialTheme.shapes.small)
        .background(if(chosen) scheme.primary else if(enabled && !quiet) scheme.primaryContainer else Color.Transparent)
        .clickable(enabled=enabled,onClick=onClick).semantics {contentDescription=spoken;selected=chosen},contentAlignment=Alignment.Center) {
        Text(date.dayOfMonth.toString(),style=MaterialTheme.typography.bodyMedium,fontWeight=if(chosen || today) FontWeight.Bold else FontWeight.Normal,
            color=if(chosen) scheme.onPrimary else if(quiet) scheme.onSurface else if(enabled) scheme.onPrimaryContainer else scheme.onSurfaceVariant)
        if(marked) Box(Modifier.align(Alignment.BottomCenter).padding(bottom=5.dp).size(4.dp).clip(MaterialTheme.shapes.extraSmall).background(if(chosen) scheme.onPrimary else scheme.primary))
    }
}

@Composable private fun dayMessage(day:BookingDay)=dayMessage(day.status,day.holiday)
@Composable internal fun dayMessage(day:ScheduleDay)=dayMessage(day.status,day.holiday)
@Composable private fun dayMessage(status:BookingDayStatus,holiday:String?)=when(status) {
    BookingDayStatus.HOLIDAY -> stringResource(R.string.booking_day_holiday,holiday.orEmpty())
    BookingDayStatus.PAST -> stringResource(R.string.booking_day_past)
    BookingDayStatus.TOO_SOON -> stringResource(R.string.booking_day_too_soon)
    BookingDayStatus.TOO_FAR -> stringResource(R.string.booking_day_too_far)
    else -> stringResource(R.string.booking_day_closed)
}

@Composable private fun SlotRow(slot:BookingSlot,chosen:Boolean,select:()->Unit) {
    val format=rememberSessionFormat()
    val scheme=MaterialTheme.colorScheme
    val note=when {
        slot.mine -> stringResource(R.string.booking_mine)
        slot.remaining==0 -> stringResource(R.string.booking_full)
        else -> stringResource(R.string.booking_places_left,slot.remaining)
    }
    Surface(select,Modifier.fillMaxWidth().semantics {selected=chosen},enabled=slot.bookable,shape=MaterialTheme.shapes.medium,
        color=if(chosen) scheme.primary else scheme.surface,contentColor=if(chosen) scheme.onPrimary else scheme.onSurface,
        border=BorderStroke(1.dp,if(chosen) scheme.primary else scheme.outlineVariant)) {
        Row(Modifier.heightIn(min=56.dp).padding(horizontal=16.dp,vertical=10.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
            Text(format.range(slot.startsAt,slot.endsAt),Modifier.weight(1f),style=MaterialTheme.typography.titleSmall,color=if(slot.bookable || chosen) LocalContentColor.current else scheme.onSurfaceVariant)
            Text(note,style=MaterialTheme.typography.bodySmall,textAlign=TextAlign.End,color=if(chosen) scheme.onPrimary else scheme.onSurfaceVariant)
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable fun ColumnScope.BookSession(state:BookingState,vm:BookingViewModel,done:()->Unit) {
    val format=rememberSessionFormat()
    // The times can fill the screen, so choosing one brings the next step into view rather than leaving it below the fold.
    val choice=remember {BringIntoViewRequester()}
    LaunchedEffect(state.slot) {if(state.slot!=null) choice.bringIntoView()}
    val today=remember {centerToday()}
    val first=remember(today) {YearMonth.from(today)}
    val open=stringResource(R.string.booking_day_open);val closed=stringResource(R.string.booking_day_closed_short)
    MonthCalendar(state.month,state.date,today,state.month>first,state.month<first.plusMonths(MONTHS_AHEAD),{vm.showMonth(it)},
        enabled={state.availability.day(it.toString())?.status==BookingDayStatus.OPEN},
        marked={state.availability.day(it.toString())?.hasPlaces==true},
        note={date -> state.availability.day(date.toString())?.let {if(it.status==BookingDayStatus.OPEN) open else closed}}) {vm.selectDate(it.toString())}
    if(BookingAction.MONTH in state.loading) LoadingNotice(R.string.booking_loading)
    if(state.failed && state.availability.days.isEmpty()) FeedbackNotice(R.string.booking_load_failed,error=true) {vm.openBooking()}
    val day=state.date?.let {state.availability.day(it)}
    when {
        day==null -> Text(stringResource(R.string.booking_no_date),style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
        day.status!=BookingDayStatus.OPEN -> Text(dayMessage(day),style=MaterialTheme.typography.bodyMedium)
        else -> {
            Text(format.calendarDay(LocalDate.parse(day.date)),style=MaterialTheme.typography.titleMedium,modifier=Modifier.semantics {heading()})
            day.slots.forEach {slot -> key(slot.startsAt) {SlotRow(slot,state.slot?.startsAt==slot.startsAt) {vm.selectSlot(slot)}}}
        }
    }
    state.slot?.let {slot ->
        ClinicalCard(Modifier.bringIntoViewRequester(choice),accent=MaterialTheme.colorScheme.primary) {
            DetailRow(stringResource(R.string.booking_your_choice),format.whenAt(slot.startsAt,slot.endsAt))
            ActionButton(R.string.booking_request,{vm.request(done)},busy=state.activeAction==BookingAction.REQUEST,busyLabel=R.string.booking_requesting)
        }
    }
}

@Composable private fun BookingCard(booking:Booking,enabled:Boolean,now:Instant,cancel:()->Unit) {
    val format=rememberSessionFormat()
    ClinicalCard {
        Row(verticalAlignment=Alignment.Top,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(2.dp)) {
                Text(format.day(booking.startsAt),style=MaterialTheme.typography.titleMedium)
                Text(format.range(booking.startsAt,booking.endsAt),style=MaterialTheme.typography.titleSmall,color=MaterialTheme.colorScheme.primary)
            }
            StatusPill(stringResource(booking.status.label()),booking.status.tone())
        }
        if(booking.therapist!=null || booking.status.active) DetailRow(stringResource(R.string.booking_therapist),booking.therapist ?: stringResource(R.string.booking_no_therapist))
        if(booking.location.isNotBlank()) DetailRow(stringResource(R.string.booking_location),booking.location)
        DetailRow(stringResource(R.string.booking_reference),booking.reference)
        booking.previousStartsAt?.let {Text(stringResource(R.string.booking_moved_from,format.day(it)),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
        booking.reason?.let {DetailRow(stringResource(R.string.booking_reason),if(it=="therapist_unavailable") stringResource(R.string.booking_reason_therapist) else it)}
        if(booking.upcoming(now)) {
            if(booking.canCancel) {
                ActionButton(R.string.booking_cancel,cancel,outlined=true,enabled=enabled)
                booking.cancelUntil?.let {Text(stringResource(R.string.booking_cancel_until,"${format.day(it)}, ${format.time(it)}"),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
            } else Text(stringResource(R.string.booking_cancel_closed),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable fun ColumnScope.MyBookings(state:BookingState,vm:BookingViewModel,schedule:()->Unit,book:()->Unit) {
    val format=rememberSessionFormat()
    val now=remember(state.bookings) {Instant.now()}
    var confirming by remember {mutableStateOf<Booking?>(null)}
    ActionButton(R.string.booking_title,book)
    ActionButton(R.string.schedule_title,schedule,outlined=true)
    if(BookingAction.LOAD in state.loading) LoadingNotice(R.string.booking_loading)
    if(state.failed && state.bookings.isEmpty()) FeedbackNotice(R.string.booking_load_failed,error=true) {vm.refresh()}
    if(state.loaded && state.bookings.isEmpty()) EmptyState(R.string.booking_empty_title,R.string.booking_empty_detail)
    val (upcoming,earlier)=state.bookings.partition {it.upcoming(now)}
    if(upcoming.isNotEmpty()) SectionHeading(R.string.booking_upcoming)
    upcoming.sortedBy {bookingInstant(it.startsAt)}.forEach {booking -> key(booking.id) {BookingCard(booking,!state.busy,now) {confirming=booking}}}
    if(earlier.isNotEmpty()) SectionHeading(R.string.booking_earlier)
    earlier.forEach {booking -> key(booking.id) {BookingCard(booking,!state.busy,now) {confirming=booking}}}
    confirming?.let {booking ->
        AlertDialog({confirming=null},title={Text(stringResource(R.string.booking_cancel))},text={Text(stringResource(R.string.booking_cancel_message,format.whenAt(booking.startsAt,booking.endsAt)))},
            confirmButton={TextButton({confirming=null;vm.cancel(booking)},colors=ButtonDefaults.textButtonColors(contentColor=MaterialTheme.colorScheme.error)) {Text(stringResource(R.string.booking_cancel))}},
            dismissButton={TextButton({confirming=null}) {Text(stringResource(R.string.booking_keep))}})
    }
}

/** The patient's next session on Home, or the way to book one. */
@Composable fun NextSessionCard(booking:Booking?,open:()->Unit,book:()->Unit) {
    val format=rememberSessionFormat()
    ClinicalCard {
        Text(stringResource(R.string.booking_next_session),style=MaterialTheme.typography.titleLarge,modifier=Modifier.semantics {heading()})
        if(booking==null) {
            Text(stringResource(R.string.booking_none_next),style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
            ActionButton(R.string.booking_title,book,outlined=true)
        } else {
            Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                Text(format.day(booking.startsAt),Modifier.weight(1f),style=MaterialTheme.typography.titleSmall)
                StatusPill(stringResource(booking.status.label()),booking.status.tone())
            }
            Text(format.range(booking.startsAt,booking.endsAt),style=MaterialTheme.typography.titleMedium,color=MaterialTheme.colorScheme.primary)
            Text(booking.therapist ?: stringResource(R.string.booking_no_therapist),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton(open,Modifier.heightIn(min=48.dp)) {Text(stringResource(R.string.booking_view_all))}
        }
    }
}
