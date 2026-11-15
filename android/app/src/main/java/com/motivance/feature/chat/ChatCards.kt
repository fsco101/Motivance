package com.motivance.feature.chat

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.motivance.R
import com.motivance.domain.*
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

private fun one(value:Double)=String.format(Locale.getDefault(),"%.1f",value).removeSuffix(".0").removeSuffix(",0")
private fun signed(value:Double)=(if(value>0) "+" else if(value<0) "−" else "")+one(kotlin.math.abs(value))+"°"
private fun day(iso:String?,zone:ZoneId)=iso?.let {runCatching {DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(Locale.getDefault()).withZone(zone).format(parseServerTime(it))}.getOrNull()}

@Composable private fun sideName(side:String)=stringResource(when(side) {"left" -> R.string.left_side; "right" -> R.string.right_side; else -> R.string.history_bilateral})

@Composable fun cardSummary(card:ChatCard?)=when(card) {
    is ChatCard.Progress -> stringResource(R.string.chat_cards_shared_progress)
    is ChatCard.Exercise -> stringResource(R.string.chat_cards_shared_exercise)
    null -> null
}

@Composable private fun Figure(label:String,value:String,modifier:Modifier) {
    Column(modifier) {
        Text(label,style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value,style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.Bold)
    }
}

/** A shared progress snapshot or exercise plan, from its facts, in the reader's language. Tapping opens the page it came from. */
@Composable fun ChatCardView(card:ChatCard,mine:Boolean,open:()->Unit) {
    val zone=remember {ZoneId.systemDefault()}
    Surface(shape=RoundedCornerShape(16.dp),color=MaterialTheme.colorScheme.surface,
        border=BorderStroke(1.dp,if(mine) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline),modifier=Modifier.widthIn(max=300.dp)) {
        Column {
            Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                when(card) {
                    is ChatCard.Activity -> {
                        Text(stringResource(R.string.chat_cards_activity_title),style=MaterialTheme.typography.titleSmall)
                        Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                            Figure(stringResource(R.string.chat_cards_week),card.week.toString(),Modifier.weight(1f))
                            Figure(stringResource(R.string.chat_cards_active_days),card.activeDays.toString(),Modifier.weight(1f))
                            Figure(stringResource(R.string.chat_cards_streak),card.streak.toString(),Modifier.weight(1f))
                        }
                        day(card.asOf,zone)?.let {Text(stringResource(R.string.chat_cards_as_of,it),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
                    }
                    is ChatCard.Series -> {
                        Text("${card.exercise} · ${sideName(card.side)}",style=MaterialTheme.typography.titleSmall)
                        Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                            Figure(stringResource(R.string.history_latest),one(card.latest)+"°",Modifier.weight(1f))
                            Figure(stringResource(R.string.history_best),one(card.best)+"°",Modifier.weight(1f))
                            Figure(stringResource(R.string.chat_cards_change),card.change?.let(::signed) ?: "—",Modifier.weight(1f))
                        }
                        Text(listOfNotNull(stringResource(R.string.chat_cards_prescribed,one(card.low),one(card.high)),day(card.asOf,zone)?.let {stringResource(R.string.chat_cards_as_of,it)}).joinToString(" · "),
                            style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    is ChatCard.Exercise -> {
                        Text(card.exercise.ifBlank {stringResource(R.string.history_unknown_exercise)},style=MaterialTheme.typography.titleSmall)
                        Text(stringResource(R.string.chat_cards_exercise_line,sideName(card.side),one(card.low),one(card.high),card.repetitions),style=MaterialTheme.typography.bodyMedium)
                        Text(stringResource(R.string.chat_cards_version,card.version),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            HorizontalDivider(color=MaterialTheme.colorScheme.outlineVariant)
            TextButton(open,Modifier.fillMaxWidth().heightIn(min=48.dp)) {
                Text(stringResource(if(card is ChatCard.Exercise) R.string.chat_cards_open_exercise else R.string.chat_cards_open_progress))
            }
        }
    }
}

@Composable fun lineText(message:ChatMessage)=when(val line=message.line) {
    is SystemLine.PracticeReminder -> stringResource(R.string.chat_lines_practice_reminder)
    is SystemLine.SessionFinished -> stringResource(R.string.chat_lines_session_finished,line.completed,line.target)
    else -> message.body.ifBlank {stringResource(R.string.chat_unsupported)}
}

/** What a therapist has waiting to arrive. Only they see it, until it does. */
@Composable fun ScheduledList(items:List<ScheduledMessage>,cancel:(String)->Unit) {
    if(items.isEmpty()) return
    val zone=remember {ZoneId.systemDefault()}
    val when_=DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM,FormatStyle.SHORT).withLocale(Locale.getDefault()).withZone(zone)
    Column(Modifier.fillMaxWidth().padding(horizontal=16.dp,vertical=8.dp),verticalArrangement=Arrangement.spacedBy(4.dp)) {
        Text(stringResource(R.string.chat_schedule_waiting),style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
        items.forEach {item ->
            Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                Column(Modifier.weight(1f)) {
                    Text(runCatching {when_.format(parseServerTime(item.sendAt))}.getOrDefault(item.sendAt),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(item.body,style=MaterialTheme.typography.bodyMedium,maxLines=2)
                }
                TextButton({cancel(item.id)},Modifier.heightIn(min=48.dp)) {Text(stringResource(R.string.chat_schedule_remove))}
            }
        }
    }
}

/** Choosing when a scheduled message arrives: a day, then a time, on this phone's clock. Hands back an ISO instant. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable fun ScheduleDialog(dismiss:()->Unit,choose:(String)->Unit) {
    val zone=remember {ZoneId.systemDefault()}
    var date by remember {mutableStateOf<LocalDate?>(null)}
    val dates=rememberDatePickerState(initialSelectedDateMillis=LocalDate.now(zone).plusDays(1).atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli(),
        selectableDates=object:SelectableDates {
            override fun isSelectableDate(utcTimeMillis:Long):Boolean {
                val day=Instant.ofEpochMilli(utcTimeMillis).atZone(java.time.ZoneOffset.UTC).toLocalDate()
                return !day.isBefore(LocalDate.now(zone)) && !day.isAfter(LocalDate.now(zone).plusDays(60))
            }
        })
    if(date==null) DatePickerDialog(dismiss,confirmButton={TextButton({dates.selectedDateMillis?.let {date=Instant.ofEpochMilli(it).atZone(java.time.ZoneOffset.UTC).toLocalDate()}}) {Text(stringResource(R.string.chat_schedule_next))}},
        dismissButton={TextButton(dismiss) {Text(stringResource(R.string.chat_schedule_cancel))}}) {DatePicker(dates)}
    else {
        val time=rememberTimePickerState(9,0)
        AlertDialog(dismiss,title={Text(stringResource(R.string.chat_schedule_when))},text={TimePicker(time)},
            confirmButton={TextButton({choose(date!!.atTime(LocalTime.of(time.hour,time.minute)).atZone(zone).toInstant().toString())}) {Text(stringResource(R.string.chat_schedule_confirm))}},
            dismissButton={TextButton(dismiss) {Text(stringResource(R.string.chat_schedule_cancel))}})
    }
}

/**
 * Sharing what Progress shows into a conversation about this patient. A therapist shares into their one conversation with the
 * patient; a patient chooses among their therapists when there is more than one. Only open conversations are offered.
 */
@Composable fun ShareProgressDialog(conversations:List<Conversation>,dismiss:()->Unit,share:(String,String)->Unit) {
    var chosen by remember {mutableStateOf(conversations.firstOrNull()?.id)}
    var note by remember {mutableStateOf("")}
    AlertDialog(dismiss,title={Text(stringResource(R.string.chat_cards_share_title))},
        text={
            Column(verticalArrangement=Arrangement.spacedBy(12.dp)) {
                if(conversations.isEmpty()) Text(stringResource(R.string.chat_cards_no_conversation))
                else {
                    Text(stringResource(R.string.chat_cards_share_detail),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    if(conversations.size>1) conversations.forEach {c ->
                        Row(Modifier.fillMaxWidth().heightIn(min=48.dp).selectable(chosen==c.id,role=Role.RadioButton) {chosen=c.id},verticalAlignment=Alignment.CenterVertically) {
                            RadioButton(chosen==c.id,null); Spacer(Modifier.width(8.dp)); Text(c.otherName)
                        }
                    }
                    OutlinedTextField(note,{if(it.length<=CHAT_BODY_LIMIT) note=it},label={Text(stringResource(R.string.chat_cards_note))},maxLines=3,modifier=Modifier.fillMaxWidth())
                }
            }
        },
        confirmButton={TextButton({chosen?.let {share(it,note)}},enabled=chosen!=null) {Text(stringResource(R.string.chat_cards_send))}},
        dismissButton={TextButton(dismiss) {Text(stringResource(R.string.chat_schedule_cancel))}})
}

/** Choosing which of the patient's conversations a file goes to, when there is more than one. */
@Composable fun ChooseConversationDialog(conversations:List<Conversation>,dismiss:()->Unit,choose:(String)->Unit) {
    AlertDialog(dismiss,title={Text(stringResource(R.string.video_send_to))},
        text={
            Column {
                conversations.forEach {c ->
                    Row(Modifier.fillMaxWidth().heightIn(min=48.dp).clickable(role=Role.Button) {choose(c.id)},verticalAlignment=Alignment.CenterVertically) {Text(c.otherName)}
                }
            }
        },
        confirmButton={},dismissButton={TextButton(dismiss) {Text(stringResource(R.string.chat_schedule_cancel))}})
}
