package com.motivance.feature.booking

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import com.motivance.R
import com.motivance.designsystem.*
import com.motivance.domain.*
import java.time.LocalDate
import java.time.YearMonth

/** How far a schedule can be turned either way. It is a record of confirmed sessions, not a booking limit. */
private const val MONTHS_EITHER_WAY=12L

@Composable private fun EmptyHour(row:ScheduleRow) {
    val format=rememberSessionFormat()
    val muted=MaterialTheme.colorScheme.onSurfaceVariant
    Row(Modifier.fillMaxWidth().heightIn(min=44.dp).semantics(mergeDescendants=true) {},verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
        Text(format.range(row.startsAt,row.endsAt),Modifier.weight(1f),style=MaterialTheme.typography.bodyMedium,color=muted)
        Text(stringResource(if(row.onLeave) R.string.schedule_on_leave else R.string.schedule_free),style=MaterialTheme.typography.bodySmall,color=if(row.onLeave) MaterialTheme.colorScheme.onSurface else muted)
    }
    HorizontalDivider(color=MaterialTheme.colorScheme.outlineVariant)
}

/** A patient reads who they will see and where. A therapist reads who is coming, and a record opens only through a link. */
@Composable private fun SessionCard(session:ScheduleSession,therapist:Boolean,canOpen:Boolean,marking:Boolean,mark:(String)->Unit,open:()->Unit) {
    val format=rememberSessionFormat()
    ClinicalCard(accent=MaterialTheme.colorScheme.primary) {
        Row(verticalAlignment=Alignment.Top,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(2.dp)) {
                Text(format.range(session.startsAt,session.endsAt),style=MaterialTheme.typography.titleSmall,color=MaterialTheme.colorScheme.primary)
                Text(if(therapist) session.patient.orEmpty() else stringResource(R.string.schedule_session),style=MaterialTheme.typography.titleMedium)
            }
            StatusPill(stringResource(session.status.label()),session.status.tone())
        }
        if(!therapist) {
            DetailRow(stringResource(R.string.booking_therapist),session.therapist ?: stringResource(R.string.booking_no_therapist))
            if(session.location.isNotBlank()) DetailRow(stringResource(R.string.booking_location),session.location)
        }
        DetailRow(stringResource(R.string.booking_reference),session.reference)
        if(therapist) {
            if(!session.linked) Text(stringResource(R.string.schedule_not_linked),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            else if(canOpen) ActionButton(R.string.schedule_open_record,open,outlined=true)
            if(session.started) {
                Text(stringResource(R.string.booking_attendance_title),style=MaterialTheme.typography.titleSmall,modifier=Modifier.semantics {heading()})
                Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                    listOf("attended" to R.string.booking_attended,"no_show" to R.string.booking_no_show).forEach {(value,label) ->
                        FilterChip(session.attendance==value,{mark(value)},{Text(stringResource(label))},Modifier.heightIn(min=48.dp),enabled=!marking)
                    }
                }
            }
        }
    }
}

/** A month to find a date, and that date laid out by time. Requests still waiting stay on My bookings. */
@Composable fun ColumnScope.MySchedule(state:ScheduleState,vm:ScheduleViewModel,patients:Set<String>,openPatient:(String)->Unit) {
    val format=rememberSessionFormat()
    val today=remember {centerToday()}
    val first=remember(today) {YearMonth.from(today)}
    val muted=MaterialTheme.colorScheme.onSurfaceVariant
    MonthCalendar(state.month,state.date,today,state.month>first.minusMonths(MONTHS_EITHER_WAY),state.month<first.plusMonths(MONTHS_EITHER_WAY),{vm.showMonth(it)},
        enabled={true},
        marked={state.schedule.day(it.toString())?.sessions?.isNotEmpty()==true},
        quiet={date -> state.schedule.day(date.toString()).let {it?.sessions.isNullOrEmpty() && it?.onLeave!=true}},
        note={date -> state.schedule.day(date.toString())?.let {day -> listOfNotNull(
            day.sessions.size.takeIf {it>0}?.let {stringResource(R.string.schedule_count,it)},
            if(day.onLeave) stringResource(R.string.schedule_on_leave) else null,
        ).joinToString(", ").ifBlank {null}}}) {vm.selectDate(it.toString())}
    if(state.loading) LoadingNotice(R.string.booking_loading)
    if(state.failed && !state.loaded) FeedbackNotice(R.string.booking_load_failed,error=true) {vm.open()}
    if(state.loaded && state.schedule.days.all {it.sessions.isEmpty()}) Text(stringResource(R.string.schedule_none),style=MaterialTheme.typography.bodyMedium,color=muted)
    val day=state.date?.let {state.schedule.day(it)}
    when {
        state.loaded && state.date==null -> Text(stringResource(R.string.schedule_choose),style=MaterialTheme.typography.bodyMedium,color=muted)
        day!=null -> {
            Text(format.calendarDay(LocalDate.parse(day.date)),style=MaterialTheme.typography.titleMedium,modifier=Modifier.semantics {heading()})
            if(day.status!=BookingDayStatus.OPEN) Text(dayMessage(day),style=MaterialTheme.typography.bodyMedium)
            day.rows.forEach {row -> key(row.startsAt) {
                val session=row.session
                if(session==null) EmptyHour(row)
                else SessionCard(session,state.therapist,session.patientId in patients,state.marking!=null,{vm.mark(session,it)}) {session.patientId?.let(openPatient)}
            }}
        }
    }
}
