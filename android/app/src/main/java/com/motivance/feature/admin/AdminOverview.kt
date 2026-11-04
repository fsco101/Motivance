package com.motivance.feature.admin

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.motivance.R
import com.motivance.designsystem.*
import com.motivance.domain.AccountFilter
import com.motivance.domain.AdminSummary

private const val RECENT_EVENTS=5

@Composable internal fun ColumnScope.AdminOverview(state:AdministrationState,open:(AdminSection)->Unit,accounts:(AccountFilter)->Unit) {
    val summary=state.data.summary
    if(summary==null) {
        if(!state.busy && !state.failed) EmptyState(R.string.admin_overview_empty,R.string.admin_overview_empty_detail)
        return
    }
    SectionHeading(R.string.admin_people)
    MetricPair(
        {AdminMetric(R.string.admin_metric_accounts,summary.accounts.toString(),Icons.Default.AccountCircle,it,
            stringResource(R.string.admin_metric_disabled,summary.disabled)) {accounts(AccountFilter.ALL)}},
        {AdminMetric(R.string.admin_metric_patients,summary.patients.toString(),Icons.Default.Person,it,
            stringResource(R.string.admin_metric_unlinked,summary.unlinkedPatients)) {accounts(AccountFilter.PATIENTS)}})
    MetricPair(
        {AdminMetric(R.string.admin_metric_therapists,summary.therapists.toString(),Icons.Default.Face,it,tint=MaterialTheme.colorScheme.primary) {accounts(AccountFilter.THERAPISTS)}},
        {AdminMetric(R.string.admin_metric_admins,summary.admins.toString(),Icons.Default.Lock,it,tint=MaterialTheme.colorScheme.primary) {accounts(AccountFilter.ADMINS)}})
    SectionHeading(R.string.admin_care_activity)
    MetricPair(
        {AdminMetric(R.string.admin_metric_links,summary.activeLinks.toString(),Icons.Default.Share,it) {open(AdminSection.LINKS)}},
        {AdminMetric(R.string.admin_metric_exercises,summary.activeExercises.toString(),Icons.AutoMirrored.Filled.List,it,
            stringResource(R.string.admin_metric_exercises_total,summary.exercises)) {open(AdminSection.CATALOGUE)}})
    MetricPair(
        {AdminMetric(R.string.admin_metric_sessions,summary.sessionsWeek.toString(),Icons.Default.DateRange,it,stringResource(R.string.admin_metric_sessions_window))},
        {AdminMetric(R.string.admin_metric_requests,summary.pendingRequests.toString(),Icons.Default.Email,it,stringResource(R.string.admin_metric_requests_detail))})
    Attention(summary,open,accounts)
    SectionHeading(R.string.admin_recent_activity) {
        if(state.data.activity.isNotEmpty()) TextButton({open(AdminSection.ACTIVITY)},Modifier.heightIn(min=48.dp)) {Text(stringResource(R.string.admin_view_all))}
    }
    if(state.data.activity.isEmpty()) EmptyState(R.string.admin_activity_empty,R.string.admin_activity_empty_detail)
    else ActivityList(state.data.activity.take(RECENT_EVENTS))
}

@Composable private fun MetricPair(first:@Composable (Modifier)->Unit,second:@Composable (Modifier)->Unit) {
    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min),horizontalArrangement=Arrangement.spacedBy(12.dp)) {
        first(Modifier.weight(1f).fillMaxHeight());second(Modifier.weight(1f).fillMaxHeight())
    }
}

/** Items an administrator can act on now, each leading to the section that resolves it. */
@Composable private fun Attention(summary:AdminSummary,open:(AdminSection)->Unit,accounts:(AccountFilter)->Unit) {
    data class Item(val title:Int,val detail:Int,val count:Int,val icon:ImageVector,val go:(()->Unit)?)
    val items=listOfNotNull(
        Item(R.string.admin_attention_unlinked,R.string.admin_attention_unlinked_detail,summary.unlinkedPatients,Icons.Default.Person) {open(AdminSection.LINKS)}.takeIf {summary.unlinkedPatients>0},
        Item(R.string.admin_attention_disabled,R.string.admin_attention_disabled_detail,summary.disabled,Icons.Default.Lock) {accounts(AccountFilter.DISABLED)}.takeIf {summary.disabled>0},
        Item(R.string.admin_attention_catalogue,R.string.admin_attention_catalogue_detail,summary.activeExercises,Icons.Default.Warning) {open(AdminSection.CATALOGUE)}.takeIf {summary.activeExercises==0},
        Item(R.string.admin_attention_requests,R.string.admin_attention_requests_detail,summary.pendingRequests,Icons.Default.Email,null).takeIf {summary.pendingRequests>0},
    )
    SectionHeading(R.string.admin_attention)
    if(items.isEmpty()) {FeedbackNotice(R.string.admin_attention_clear);return}
    Surface(Modifier.fillMaxWidth(),color=MaterialTheme.colorScheme.surface,shape=MaterialTheme.shapes.large,
        border=BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant)) {
        Column {
            items.forEachIndexed {index,item ->
                if(index>0) HorizontalDivider(Modifier.padding(horizontal=20.dp),color=MaterialTheme.colorScheme.outlineVariant)
                val row:@Composable ()->Unit={
                    Row(Modifier.fillMaxWidth().padding(horizontal=20.dp,vertical=14.dp).semantics(mergeDescendants=true) {},
                        verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(14.dp)) {
                        IconBadge(item.icon,MaterialTheme.colorScheme.error,40)
                        Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(2.dp)) {
                            Text(stringResource(item.title),style=MaterialTheme.typography.titleSmall)
                            Text(stringResource(item.detail),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        StatusPill(item.count.toString(),PillTone.ATTENTION)
                        if(item.go!=null) Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight,null,tint=MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if(item.go!=null) Surface(item.go,color=MaterialTheme.colorScheme.surface,content=row) else row()
            }
        }
    }
}
