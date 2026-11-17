package com.motivance.feature.admin

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.motivance.R
import com.motivance.designsystem.*
import com.motivance.domain.*
import java.time.Instant
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

private enum class Tone { GOOD, WARNING, CRITICAL, NEUTRAL }

/**
 * Storage against the plan, the backend's health and the last 14 days: the same facts, in the same order, as the web
 * overview. It sits above the cards that open each section.
 */
@Composable internal fun BackendSection(status:BackendStatus?) {
    SectionHeading(R.string.admin_backend_storage)
    if(status==null) {FeedbackNotice(R.string.admin_backend_unavailable,error=true);return}
    AdminCard {
        Text(stringResource(R.string.admin_backend_plan,status.planName,adminDateTime(status.generatedAt) ?: ""),
            style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        Meter(stringResource(R.string.admin_backend_database),status.databaseBytes,status.databaseLimit)
        Meter(stringResource(R.string.admin_backend_files),status.storageBytes,status.storageLimit)
        SizedList(stringResource(R.string.admin_backend_largest_tables),status.tables.map {it.name to it.bytes})
        SizedList(stringResource(R.string.admin_backend_buckets),status.buckets.map {
            pluralStringResource(R.plurals.admin_backend_bucket,it.files.toInt(),bucketName(it.name),it.files.toInt()) to it.bytes
        })
    }
    SectionHeading(R.string.admin_backend_health)
    AdminCard(padded=false) {
        val failing=status.jobs?.filter {it.failing}.orEmpty()
        val stuck=status.oldestWaiting?.let {runCatching {Instant.parse(it).isBefore(Instant.now().minusSeconds(STUCK_MINUTES*60))}.getOrNull()} ?: false
        val rows=listOf<@Composable ()->Unit>(
            {if(status.jobs==null) Health(R.string.admin_backend_jobs,"–",stringResource(R.string.admin_backend_jobs_unknown),Tone.WARNING)
             else Health(R.string.admin_backend_jobs,"${status.jobs!!.size-failing.size}/${status.jobs!!.size}",
                if(failing.isEmpty()) stringResource(R.string.admin_backend_jobs_healthy) else stringResource(R.string.admin_backend_jobs_failing,failing.joinToString {it.name}),
                if(failing.isEmpty()) Tone.GOOD else Tone.CRITICAL)},
            {Health(R.string.admin_backend_waiting,status.waiting.toString(),
                status.oldestWaiting?.let {stringResource(if(stuck) R.string.admin_backend_waiting_stuck else R.string.admin_backend_waiting_since,adminDateTime(it) ?: it)}
                    ?: stringResource(R.string.admin_backend_waiting_none),
                if(stuck) Tone.WARNING else if(status.waiting==0) Tone.GOOD else Tone.NEUTRAL)},
            {Health(R.string.admin_backend_failed,status.failedWeek.toString(),stringResource(R.string.admin_backend_failed_detail),if(status.failedWeek>0) Tone.WARNING else Tone.GOOD)},
            {Health(R.string.admin_backend_sent,status.sentDay.toString(),stringResource(R.string.admin_backend_sent_detail))},
            {Health(R.string.admin_backend_signed_in,status.signedInWeek.toString(),pluralStringResource(R.plurals.admin_backend_new_accounts,status.newWeek,status.newWeek))},
            {Health(R.string.admin_backend_devices,status.devices.toString(),stringResource(R.string.admin_backend_devices_detail))},
        )
        rows.forEachIndexed {index,row ->
            if(index>0) HorizontalDivider(Modifier.padding(horizontal=20.dp),color=MaterialTheme.colorScheme.outlineVariant)
            row()
        }
    }
    SectionHeading(R.string.admin_backend_activity)
    AdminCard {
        Text(stringResource(R.string.admin_backend_activity_detail),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        val series=listOf<Pair<Int,(BackendDay)->Int>>(
            R.string.admin_backend_series_sessions to {it.sessions},R.string.admin_backend_series_messages to {it.messages},
            R.string.admin_backend_series_bookings to {it.bookings},R.string.admin_backend_series_accounts to {it.accounts})
        series.forEach {(title,value) -> DailyColumns(stringResource(title),status.activity.map {shortDay(it.day) to value(it)})}
    }
}

@Composable private fun AdminCard(padded:Boolean=true,content:@Composable ColumnScope.()->Unit) {
    Surface(Modifier.fillMaxWidth(),color=MaterialTheme.colorScheme.surface,shape=MaterialTheme.shapes.large,
        border=BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant)) {
        Column(if(padded) Modifier.padding(20.dp) else Modifier,verticalArrangement=Arrangement.spacedBy(if(padded) 18.dp else 0.dp),content=content)
    }
}

/**
 * One amount against its limit. The track is a pale step of the fill's own hue, and the fill turns to the caution and then the
 * error colour as the limit nears. The words below say the same, so colour is never the only sign.
 */
@Composable private fun Meter(label:String,used:Long,limit:Long) {
    val level=meterLevel(used,limit)
    val share=if(limit>0) (used.toDouble()/limit).coerceIn(0.0,1.0).toFloat() else 0f
    val fill=when(level) {MeterLevel.FULL -> MaterialTheme.colorScheme.error;MeterLevel.HIGH -> MaterialTheme.colorScheme.tertiary;MeterLevel.OK -> MaterialTheme.colorScheme.primary}
    val usedText=stringResource(R.string.admin_backend_used_of,formatBytes(used),formatBytes(limit))
    val detail=stringResource(R.string.admin_backend_remaining,formatBytes(maxOf(limit-used,0)),Math.round(share*100))
    val status=when(level) {MeterLevel.FULL -> stringResource(R.string.admin_backend_nearly_full);MeterLevel.HIGH -> stringResource(R.string.admin_backend_getting_full);MeterLevel.OK -> null}
    Column(Modifier.semantics(mergeDescendants=true) {
        progressBarRangeInfo=ProgressBarRangeInfo(share,0f..1f);contentDescription="$label. $usedText. ${status.orEmpty()} $detail"
    },verticalArrangement=Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment=Alignment.Bottom) {
            Text(label,style=MaterialTheme.typography.titleSmall,modifier=Modifier.weight(1f))
            Text(usedText,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Box(Modifier.fillMaxWidth().height(12.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primaryContainer)) {
            if(used>0) Box(Modifier.fillMaxWidth(maxOf(share,0.01f)).fillMaxHeight().clip(CircleShape).background(fill))
        }
        Text((status?.let {"$it "} ?: "")+detail,style=MaterialTheme.typography.bodySmall,
            color=if(status!=null) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight=if(status!=null) FontWeight.SemiBold else null)
    }
}

/** Named sizes, largest first, on one baseline in one hue, with each size written out. */
@Composable private fun SizedList(title:String,items:List<Pair<String,Long>>) {
    if(items.isEmpty()) return
    val largest=maxOf(items.maxOf {it.second},1L)
    Column(verticalArrangement=Arrangement.spacedBy(10.dp)) {
        Text(title,style=MaterialTheme.typography.labelLarge,color=MaterialTheme.colorScheme.onSurfaceVariant)
        items.forEach {(name,bytes) ->
            Column(Modifier.semantics(mergeDescendants=true) {},verticalArrangement=Arrangement.spacedBy(4.dp)) {
                Row {
                    Text(name,style=MaterialTheme.typography.bodyMedium,modifier=Modifier.weight(1f))
                    Text(formatBytes(bytes),style=MaterialTheme.typography.bodyMedium,fontWeight=FontWeight.SemiBold)
                }
                Box(Modifier.fillMaxWidth().height(8.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant)) {
                    Box(Modifier.fillMaxWidth((bytes.toFloat()/largest).coerceIn(0f,1f)).fillMaxHeight().clip(CircleShape).background(MaterialTheme.colorScheme.primary))
                }
            }
        }
    }
}

/** One health fact: what it is, its number, and, when it needs a look, an icon and words that say so. */
@Composable private fun Health(label:Int,value:String,detail:String,tone:Tone=Tone.NEUTRAL) {
    val (icon,tint)=when(tone) {
        Tone.GOOD -> Icons.Default.CheckCircle to MaterialTheme.colorScheme.secondary
        Tone.WARNING -> Icons.Default.Warning to MaterialTheme.colorScheme.tertiary
        Tone.CRITICAL -> Icons.Default.Warning to MaterialTheme.colorScheme.error
        Tone.NEUTRAL -> null to MaterialTheme.colorScheme.onSurfaceVariant
    }
    Row(Modifier.fillMaxWidth().padding(horizontal=20.dp,vertical=14.dp).semantics(mergeDescendants=true) {},
        verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(14.dp)) {
        if(icon!=null) IconBadge(icon,tint,36) else Spacer(Modifier.size(36.dp))
        Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(2.dp)) {
            Text(stringResource(label),style=MaterialTheme.typography.titleSmall)
            Text(detail,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text(value,style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.Bold)
    }
}

/**
 * Daily counts as columns, one series per chart, so charts of different sizes never share an axis. Screen readers hear the
 * total and every day's count, since a column cannot be pointed at.
 */
@Composable private fun DailyColumns(title:String,days:List<Pair<String,Int>>) {
    val total=days.sumOf {it.second}
    val largest=days.maxOfOrNull {it.second} ?: 0
    val color=MaterialTheme.colorScheme.primary
    val baseline=MaterialTheme.colorScheme.outlineVariant
    val totalText=pluralStringResource(R.plurals.admin_backend_total,total,total)
    val description="$title, $totalText. "+days.joinToString("; ") {"${it.first}: ${it.second}"}
    Column(Modifier.semantics(mergeDescendants=true) {contentDescription=description},verticalArrangement=Arrangement.spacedBy(6.dp)) {
        Row(Modifier.clearAndSetSemantics {},verticalAlignment=Alignment.Bottom) {
            Text(title,style=MaterialTheme.typography.titleSmall,modifier=Modifier.weight(1f))
            Text(totalText,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Canvas(Modifier.fillMaxWidth().height(72.dp).clearAndSetSemantics {}) {
            val slot=size.width/maxOf(days.size,1)
            val gap=2.dp.toPx()
            val bar=minOf(slot-gap,24.dp.toPx())
            val radius=minOf(4.dp.toPx(),bar/2)
            drawLine(baseline,Offset(0f,size.height),Offset(size.width,size.height),1.dp.toPx())
            days.forEachIndexed {index,(_,value) ->
                if(value>0 && largest>0) {
                    val height=maxOf(size.height*value/largest,3.dp.toPx())
                    val x=index*slot+(slot-bar)/2
                    // Rounded at the data end only: the column is squared off where it meets the baseline.
                    drawRoundRect(color,Offset(x,size.height-height),Size(bar,height),CornerRadius(radius,radius))
                    drawRect(color,Offset(x,size.height-minOf(radius,height)),Size(bar,minOf(radius,height)))
                }
            }
        }
        Row(Modifier.fillMaxWidth().clearAndSetSemantics {},horizontalArrangement=Arrangement.SpaceBetween) {
            Text(days.firstOrNull()?.first.orEmpty(),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            Text(days.lastOrNull()?.first.orEmpty(),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable private fun bucketName(bucket:String)=when(bucket) {
    "avatars" -> stringResource(R.string.admin_backend_bucket_avatars)
    "chat-media" -> stringResource(R.string.admin_backend_bucket_chat)
    else -> bucket
}

private val SHORT_DAY get()=DateTimeFormatter.ofPattern("MMM d",Locale.getDefault())
private fun shortDay(day:String)=runCatching {SHORT_DAY.format(LocalDate.parse(day))}.getOrDefault(day)
