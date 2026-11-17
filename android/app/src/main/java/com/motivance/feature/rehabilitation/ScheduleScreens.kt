package com.motivance.feature.rehabilitation

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.motivance.R
import com.motivance.designsystem.*
import com.motivance.domain.*
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.TextStyle
import java.util.Locale
import java.util.UUID

/** The center's calendar day, which schedules count from. The server's own answer is used when the record has one. */
internal fun centerToday(day:ExerciseDay?):LocalDate=day?.day ?: LocalDate.now(ZoneId.of("Asia/Manila"))

internal fun weekdayName(day:Int,style:TextStyle=TextStyle.FULL):String=DayOfWeek.of(day).getDisplayName(style,Locale.getDefault())

@Composable internal fun scheduleRange(schedule:ExerciseSchedule)=stringResource(R.string.exercise_schedule_range,displayDate(schedule.startsOn.toString()),displayDate(schedule.endsOn.toString()))

@Composable private fun scheduleSummary(exercise:Int,rest:Int)=stringResource(R.string.exercise_schedule_summary,
    pluralStringResource(R.plurals.exercise_schedule_exercise_days,exercise,exercise),pluralStringResource(R.plurals.exercise_schedule_rest_days,rest,rest))

private fun DayExercise?.today():Pair<Int,PillTone>?=when {
    this==null -> null
    done -> R.string.exercise_schedule_today_done to PillTone.POSITIVE
    due -> R.string.exercise_schedule_today_todo to PillTone.PRIMARY
    else -> R.string.exercise_schedule_today_rest to PillTone.NEUTRAL
}

/**
 * A patient's plan on their record: each current or coming schedule with its exercises, then exercises due every day, then any left
 * from schedules that have ended. Mirrors the web record (PatientRecordView.tsx).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable fun ColumnScope.PatientSchedules(state:RehabilitationState,patientId:String,patientName:String,endSchedule:(String)->Unit,stopExercise:(String)->Unit,
    newSchedule:()->Unit,editSchedule:(ExerciseSchedule)->Unit,addExercise:(ExerciseSchedule)->Unit,assignEveryDay:()->Unit,editPlan:(String)->Unit,
    share:((String)->Unit)?) {
    val day=state.days[patientId]
    val plans=state.workspace.prescriptions.filter {it.patientId==patientId}
    val today=centerToday(day)
    var ending by remember {mutableStateOf<ExerciseSchedule?>(null)}
    var removing by remember {mutableStateOf<PrescriptionSummary?>(null)}
    @Composable fun Plan(p:PrescriptionSummary) {
        AssignedPrescriptionCard(p,state.workspace.catalogue.firstOrNull {it.id==p.exerciseId},!state.busy,day?.exercises?.firstOrNull {it.assignmentId==p.assignmentId}.today(),
            locked=p.therapistId.isNotBlank() && p.therapistId!=state.owner,onRemove={removing=p}) {editPlan(p.assignmentId)}
        if(share!=null) TextButton({share(p.assignmentId)},Modifier.heightIn(min=48.dp)) {Text(stringResource(R.string.chat_cards_send_exercise))}
    }
    SectionHeading(R.string.exercise_schedule_title) {
        FilledTonalButton(newSchedule,enabled=!state.busy,modifier=Modifier.heightIn(min=48.dp)) {
            Icon(Icons.Default.DateRange,null,Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.exercise_schedule_new))
        }
    }
    Text(stringResource(R.string.exercise_schedule_help),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    if(day==null) {LoadingNotice(R.string.ui_loading_workspace); return}
    val everyDay=plans.filter {it.scheduleId==null}
    if(day.schedules.isEmpty()) EmptyState(R.string.exercise_schedule_none_title,R.string.exercise_schedule_none_detail,
        action=if(everyDay.isEmpty()) ({TextButton(assignEveryDay,Modifier.heightIn(min=48.dp)) {Text(stringResource(R.string.exercise_schedule_every_day_assign))}}) else null)
    day.schedules.forEach {schedule ->
        val mine=schedule.therapistId==state.owner
        ClinicalCard {
            Text(scheduleRange(schedule),style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.SemiBold)
            StatusPill(when(schedule.state) {
                ScheduleState.UPCOMING -> stringResource(R.string.exercise_schedule_state_upcoming,displayDate(schedule.startsOn.toString()))
                ScheduleState.REST -> stringResource(R.string.exercise_schedule_state_rest)
                else -> stringResource(R.string.exercise_schedule_state_exercise)
            },if(schedule.state==ScheduleState.UPCOMING) PillTone.ATTENTION else if(schedule.state==ScheduleState.REST) PillTone.NEUTRAL else PillTone.PRIMARY)
            Text(scheduleSummary(schedule.exerciseDays,schedule.restDays)+" · "+pluralStringResource(R.plurals.exercise_schedule_days_left,schedule.daysLeft,schedule.daysLeft),
                style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            val rest=schedule.restWeekdays.sorted().map {stringResource(R.string.exercise_schedule_every_weekday,weekdayName(it))}+
                schedule.restDates.filter {!it.isBefore(today)}.map {displayDate(it.toString())}
            Text(if(rest.isEmpty()) stringResource(R.string.exercise_schedule_no_rest) else stringResource(R.string.exercise_schedule_rest_line,rest.joinToString(", ")),
                style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            if(!mine) Text(stringResource(R.string.exercise_schedule_set_by,schedule.therapistName),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            if(mine) FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                FilledTonalButton({addExercise(schedule)},enabled=!state.busy,modifier=Modifier.heightIn(min=48.dp)) {
                    Icon(Icons.Default.Add,null,Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.exercise_schedule_add_exercise))
                }
                OutlinedButton({editSchedule(schedule)},enabled=!state.busy,modifier=Modifier.heightIn(min=48.dp)) {
                    Icon(Icons.Default.Edit,null,Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.exercise_schedule_edit))
                }
                TextButton({ending=schedule},enabled=!state.busy,modifier=Modifier.heightIn(min=48.dp)) {Text(stringResource(R.string.exercise_schedule_end))}
            }
        }
        val inside=plans.filter {it.scheduleId==schedule.id}
        if(inside.isEmpty()) Text(stringResource(R.string.exercise_schedule_empty),style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
        inside.forEach {Plan(it)}
    }
    if(day.missed.isNotEmpty()) ClinicalCard {
        Text(stringResource(R.string.exercise_schedule_missed_title),style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.SemiBold)
        Text(stringResource(R.string.exercise_schedule_missed_help),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
            day.missed.forEach {missed ->
                StatusPill(stringResource(R.string.exercise_schedule_missed_item,displayDate(missed.day.toString()),missed.done,missed.due),
                    if(missed.done==0) PillTone.ATTENTION else PillTone.NEUTRAL)
            }
        }
    }
    if(everyDay.isNotEmpty()) {
        SectionHeading(R.string.exercise_schedule_every_day) {
            FilledTonalButton(assignEveryDay,enabled=!state.busy,modifier=Modifier.heightIn(min=48.dp)) {
                Icon(Icons.Default.Add,null,Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.assign_exercise))
            }
        }
        Text(stringResource(R.string.exercise_schedule_every_day_help),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        everyDay.forEach {Plan(it)}
    }
    val ended=plans.filter {p -> p.scheduleId!=null && day.schedules.none {it.id==p.scheduleId}}
    if(ended.isNotEmpty()) {
        SectionHeading(R.string.exercise_schedule_ended)
        Text(stringResource(R.string.exercise_schedule_ended_help),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        ended.forEach {Plan(it)}
    }
    ending?.let {schedule -> AlertDialog(onDismissRequest={ending=null},icon={Icon(Icons.Default.Warning,null)},
        title={Text(stringResource(R.string.exercise_schedule_end_title))},
        text={Text(stringResource(if(schedule.state==ScheduleState.UPCOMING) R.string.exercise_schedule_end_upcoming else R.string.exercise_schedule_end_started,patientName))},
        confirmButton={TextButton({endSchedule(schedule.id); ending=null}) {Text(stringResource(R.string.exercise_schedule_end))}},
        dismissButton={TextButton({ending=null}) {Text(stringResource(R.string.cancel_action))}})}
    removing?.let {plan -> AlertDialog(onDismissRequest={removing=null},icon={Icon(Icons.Default.Warning,null)},
        title={Text(stringResource(R.string.exercise_schedule_remove_title))},
        text={Text(stringResource(R.string.exercise_schedule_remove_message,state.workspace.catalogue.firstOrNull {it.id==plan.exerciseId}?.name ?: stringResource(R.string.history_unknown_exercise),patientName))},
        confirmButton={TextButton({stopExercise(plan.assignmentId); removing=null}) {Text(stringResource(R.string.exercise_schedule_remove_confirm))}},
        dismissButton={TextButton({removing=null}) {Text(stringResource(R.string.cancel_action))}})}
}

/** Start and end dates, rest weekdays and single rest dates, with the count of days they make before anything is saved. Mirrors ScheduleForm.tsx. */
@OptIn(ExperimentalLayoutApi::class)
@Composable fun ColumnScope.ScheduleForm(state:RehabilitationState,patientId:String,existing:ExerciseSchedule?,today:LocalDate,cancel:()->Unit,save:(ScheduleDraft)->Unit) {
    val id=rememberSaveable {existing?.id ?: UUID.randomUUID().toString()}
    var startsOn by rememberSaveable {mutableStateOf((existing?.startsOn ?: today).toString())}
    var endsOn by rememberSaveable {mutableStateOf((existing?.endsOn ?: today.plusDays(13)).toString())}
    var restWeekdays by rememberSaveable {mutableStateOf<List<Int>>(existing?.restWeekdays?.sorted() ?: emptyList())}
    var restDates by rememberSaveable {mutableStateOf<List<String>>(existing?.restDates?.map {it.toString()} ?: emptyList())}
    val started=existing!=null && !existing.startsOn.isAfter(today)
    val start=LocalDate.parse(startsOn); val end=LocalDate.parse(endsOn)
    val draft=ScheduleDraft(id,patientId,start,end,restWeekdays.toSet(),restDates.map(LocalDate::parse))
    val problem=ScheduleRules.problem(draft,today,existing?.startsOn)
    val counts=ScheduleRules.counts(draft)
    val first=if(start.isAfter(today)) start else today
    Text(stringResource(R.string.exercise_schedule_form_help),style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
    DateInput(R.string.exercise_schedule_starts_on,startsOn,enabled=!started,allowed=today..today.plusYears(2),
        help=if(started) stringResource(R.string.exercise_schedule_started_hint) else "") {startsOn=it}
    DateInput(R.string.exercise_schedule_ends_on,endsOn,allowed=first..start.plusDays(ScheduleRules.MAX_DAYS-1L),help="") {endsOn=it}
    Text(stringResource(R.string.exercise_schedule_rest_weekdays),style=MaterialTheme.typography.titleSmall)
    FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        (1..7).forEach {weekday ->
            val chosen=weekday in restWeekdays
            val full=weekdayName(weekday)
            FilterChip(chosen,{restWeekdays=if(chosen) restWeekdays-weekday else (restWeekdays+weekday).sorted()},label={Text(weekdayName(weekday,TextStyle.SHORT))},
                modifier=Modifier.heightIn(min=48.dp).semantics {contentDescription=full})
        }
    }
    Text(stringResource(R.string.exercise_schedule_rest_dates),style=MaterialTheme.typography.titleSmall)
    // Choosing a date adds it; the field stays empty for the next one.
    DateInput(R.string.exercise_schedule_rest_date_label,"",allowed=first..(if(end.isBefore(first)) first else end),help="") {chosen ->
        if(chosen !in restDates) restDates=(restDates+chosen).sorted()
    }
    if(restDates.isEmpty()) Text(stringResource(R.string.exercise_schedule_no_rest_dates),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    else FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        restDates.forEach {date ->
            val label=displayDate(date)
            // A rest day already behind a started schedule is history, so it stays.
            val past=LocalDate.parse(date).isBefore(today)
            InputChip(false,{if(!past) restDates=restDates-date},label={Text(label)},enabled=!past,modifier=Modifier.heightIn(min=48.dp),
                trailingIcon=if(past) null else ({Icon(Icons.Default.Close,stringResource(R.string.exercise_schedule_remove_rest_date,label),Modifier.size(18.dp))}))
        }
    }
    Surface(Modifier.fillMaxWidth(),shape=MaterialTheme.shapes.medium,color=if(problem!=null) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceVariant) {
        Text(problem?.let {stringResource(it.message())} ?: scheduleSummary(counts.exercise,counts.rest),Modifier.padding(12.dp),
            style=MaterialTheme.typography.bodyMedium,fontWeight=FontWeight.SemiBold,
            color=if(problem!=null) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSurfaceVariant)
    }
    ActionButton(R.string.exercise_schedule_save,{if(problem==null) save(draft)},enabled=problem==null && !state.busy,
        busy=state.activeAction==RehabAction.SAVE_SCHEDULE,busyLabel=R.string.exercise_schedule_saving)
    OutlinedButton(cancel,Modifier.fillMaxWidth().heightIn(min=48.dp),shape=MaterialTheme.shapes.medium) {Text(stringResource(R.string.cancel_action))}
}

private fun ScheduleProblem.message()=when(this) {
    ScheduleProblem.DATES -> R.string.exercise_schedule_problem_dates
    ScheduleProblem.TOO_LONG -> R.string.exercise_schedule_problem_too_long
    ScheduleProblem.PAST_START -> R.string.exercise_schedule_problem_past_start
    ScheduleProblem.PAST_END -> R.string.exercise_schedule_problem_past_end
    ScheduleProblem.ALL_REST -> R.string.exercise_schedule_problem_all_rest
    ScheduleProblem.NO_DAY -> R.string.exercise_schedule_problem_no_day
}
