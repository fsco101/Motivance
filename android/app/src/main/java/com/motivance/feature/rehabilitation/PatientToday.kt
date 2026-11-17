package com.motivance.feature.rehabilitation

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.motivance.R
import com.motivance.data.local.CachedPrescription
import com.motivance.data.local.ExerciseJson
import com.motivance.data.local.LocalSession
import com.motivance.data.remote.ScheduleJson
import com.motivance.designsystem.ClinicalCard
import com.motivance.designsystem.displayDate
import com.motivance.domain.*
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** Days count at the center, as on the server, whatever zone the phone is set to. */
internal val CENTER_ZONE:ZoneId=ZoneId.of("Asia/Manila")

internal fun centerDate(at:Long=System.currentTimeMillis()):LocalDate=Instant.ofEpochMilli(at).atZone(CENTER_ZONE).toLocalDate()

/**
 * Today's list on the phone (#127). Each cached exercise carries its schedule, so the list works offline. An exercise is done today
 * when the server says so, or when this phone finished it today, including a session still waiting to upload, so it never comes
 * back after being finished without a connection. A both-sides exercise needs both sides.
 */
internal fun patientToday(cached:List<CachedPrescription>,history:List<LocalSession>,server:ExerciseDay?,today:LocalDate):DailyPlan<CachedPrescription> {
    val finished=history.filter {it.status=="COMPLETED" && centerDate(it.startedAt)==today}.mapNotNull {runCatching {ExerciseJson.rules(it.rulesJson)}.getOrNull()}
    val serverDone=server?.takeIf {it.day==today}?.exercises?.filter {it.done}?.map {it.assignmentId}?.toSet().orEmpty()
    return TodayPlanner.plan(cached.map {p ->
        val bilateral=runCatching {ExerciseJson.rules(p.rulesJson).bilateral}.getOrDefault(false)
        val mine=finished.filter {it.prescriptionVersionId==p.versionId}
        val local=if(bilateral) mine.map {it.side}.toSet().containsAll(setOf(BodySide.LEFT,BodySide.RIGHT)) else mine.isNotEmpty()
        TodayItem(p,p.scheduleJson?.let {runCatching {ScheduleJson.window(JSONObject(it))}.getOrNull()},p.assignmentId in serverDone || local)
    },today)
}

/** What a patient sees on a day with nothing left to do: done, resting, not started yet, or over. Mirrors TodayNotice on the web. */
@Composable fun TodayNotice(plan:DailyPlan<*>,modifier:Modifier=Modifier) {
    val next=plan.nextDay?.let {displayDate(it.toString())}
    val (title,detail)=when(plan.state) {
        TodayState.DONE -> R.string.patient_all_done_title to (next?.let {stringResource(R.string.patient_all_done_next,it)} ?: stringResource(R.string.patient_all_done_last))
        TodayState.REST -> R.string.patient_rest_title to (next?.let {stringResource(R.string.patient_rest_next,it)} ?: stringResource(R.string.patient_finished_detail))
        TodayState.UPCOMING -> R.string.patient_upcoming_title to stringResource(R.string.patient_upcoming_detail,displayDate(plan.startsOn.toString()))
        else -> R.string.patient_finished_title to stringResource(R.string.patient_finished_detail)
    }
    ClinicalCard(modifier) {
        Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
            Icon(if(plan.state==TodayState.DONE) Icons.Default.CheckCircle else Icons.Default.DateRange,null,tint=MaterialTheme.colorScheme.primary)
            Text(stringResource(title),style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.SemiBold)
        }
        Text(detail,style=MaterialTheme.typography.bodyLarge)
    }
}

/** "1 of 3 done today", shown once there is more than one exercise to keep count of. */
@Composable fun TodayProgress(plan:DailyPlan<*>) {
    if(plan.due>1) Text(stringResource(R.string.patient_today_done,plan.done,plan.due),style=MaterialTheme.typography.titleSmall,color=MaterialTheme.colorScheme.primary)
}
