package com.motivance.feature.notifications

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.motivance.R
import com.motivance.designsystem.*
import com.motivance.domain.*
import com.motivance.feature.booking.bookingReasonText
import com.motivance.feature.booking.rememberSessionFormat

/** Written here from the facts, so it follows the reader's language and the center's time. */
@Composable private fun notificationText(note:AppNotification,format:SessionFormat):String {
    val at=format.whenAt(note.startsAt,note.endsAt)
    // A therapist who lost a session knows it by the time they had, not the time it moved to.
    val was=(note.previousStartsAt ?: note.startsAt).let {"${format.day(it)}, ${format.time(it)}"}
    val patient=note.patient.orEmpty()
    val therapist=note.therapist ?: stringResource(R.string.booking_no_therapist)
    return when(note.kind) {
        NotificationKind.CONFIRMED -> stringResource(R.string.notification_confirmed,at,therapist)
        NotificationKind.REJECTED -> stringResource(R.string.notification_rejected,at)
        NotificationKind.CANCELLED -> stringResource(R.string.notification_cancelled,at)
        NotificationKind.RESCHEDULED -> stringResource(R.string.notification_rescheduled,at)
        NotificationKind.THERAPIST_CHANGED -> stringResource(R.string.notification_therapist_changed,at,therapist)
        NotificationKind.RETURNED_TO_PENDING -> stringResource(R.string.notification_returned_to_pending,at)
        NotificationKind.SESSION_ASSIGNED -> stringResource(R.string.notification_session_assigned,patient,at)
        NotificationKind.SESSION_MOVED -> stringResource(R.string.notification_session_moved,patient,at)
        NotificationKind.SESSION_CANCELLED -> stringResource(R.string.notification_session_cancelled,patient,at)
        NotificationKind.SESSION_REMOVED -> stringResource(R.string.notification_session_removed,patient,was)
        NotificationKind.REQUEST_RECEIVED -> stringResource(R.string.notification_request_received,patient,at)
        NotificationKind.PATIENT_CANCELLED -> stringResource(R.string.notification_patient_cancelled,patient,at)
        NotificationKind.NEEDS_THERAPIST -> stringResource(R.string.notification_needs_therapist,patient,at)
        NotificationKind.REMINDER -> stringResource(R.string.notification_reminder,at,therapist)
        NotificationKind.SESSION_REMINDER -> stringResource(R.string.notification_session_reminder,patient,at)
        NotificationKind.PLACE_OPEN -> stringResource(R.string.notification_place_open,at)
        NotificationKind.PATIENT_RESCHEDULED -> stringResource(R.string.notification_patient_rescheduled,patient,at)
    }
}

@Composable private fun NotificationRow(note:AppNotification,open:()->Unit) {
    val format=rememberSessionFormat()
    val scheme=MaterialTheme.colorScheme
    val unread=stringResource(R.string.notifications_unread)
    Surface(open,Modifier.fillMaxWidth().semantics {if(note.unread) stateDescription=unread},shape=MaterialTheme.shapes.medium,color=if(note.unread) scheme.primaryContainer else scheme.surface,contentColor=if(note.unread) scheme.onPrimaryContainer else scheme.onSurface) {
        Row(Modifier.heightIn(min=56.dp).padding(horizontal=16.dp,vertical=12.dp),horizontalArrangement=Arrangement.spacedBy(12.dp),verticalAlignment=Alignment.Top) {
            Box(Modifier.padding(top=7.dp).size(8.dp).clip(MaterialTheme.shapes.extraSmall).background(if(note.unread) scheme.primary else Color.Transparent))
            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(2.dp)) {
                Text(notificationText(note,format),style=MaterialTheme.typography.bodyMedium,fontWeight=if(note.unread) FontWeight.SemiBold else FontWeight.Normal)
                note.reason?.let {Text(bookingReasonText(it),style=MaterialTheme.typography.bodySmall)}
                if(note.createdAt.isNotBlank()) Text("${format.day(note.createdAt)}, ${format.time(note.createdAt)}",style=MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable fun ColumnScope.Notifications(state:NotificationsState,vm:NotificationsViewModel,open:()->Unit) {
    if(state.inbox.unread>0) ActionButton(R.string.notifications_mark_all,{vm.markAllRead()},outlined=true)
    if(state.failed && !state.loaded) FeedbackNotice(R.string.notifications_failed,error=true) {vm.refresh()}
    if(state.loading && !state.loaded) LoadingNotice(R.string.notifications_loading)
    if(state.loaded && state.inbox.items.isEmpty()) EmptyState(R.string.notifications_none_title,R.string.notifications_none_detail)
    state.inbox.items.forEach {note -> key(note.id) {NotificationRow(note) {vm.open(note);open()}}}
}
