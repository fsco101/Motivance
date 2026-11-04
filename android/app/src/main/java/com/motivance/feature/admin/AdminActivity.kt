package com.motivance.feature.admin

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.motivance.R
import com.motivance.designsystem.*
import com.motivance.domain.*

/** Category filter for the feed; null shows everything. */
private val CATEGORIES=listOf<AuditCategory?>(null)+AuditCategory.entries

@Composable internal fun ColumnScope.AdminActivity(state:AdministrationState,vm:AdministrationViewModel) {
    var category by rememberSaveable {mutableStateOf<AuditCategory?>(null)}
    Text(stringResource(R.string.admin_activity_help),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    ChoiceChips(CATEGORIES,category,{stringResource(it?.label() ?: R.string.admin_filter_all)}) {category=it}
    val shown=state.data.activity.filter {category==null || it.category()==category}
    if(shown.isEmpty() && !state.busy && !state.failed) EmptyState(R.string.admin_activity_empty,
        if(state.data.activityNext!=null) R.string.admin_activity_empty_more else R.string.admin_activity_empty_detail)
    else if(shown.isNotEmpty()) ActivityList(shown)
    if(state.data.activityNext!=null) ActionButton(R.string.admin_activity_more,{vm.olderActivity()},outlined=true,enabled=!state.busy,
        busy=state.activeAction==AdminAction.ACTIVITY,busyLabel=R.string.ui_loading_older)
}

private fun AuditCategory.label()=when(this) {
    AuditCategory.ACCOUNTS -> R.string.admin_category_accounts
    AuditCategory.LINKS -> R.string.admin_category_links
    AuditCategory.CATALOGUE -> R.string.admin_category_catalogue
    AuditCategory.CLINICAL -> R.string.admin_category_clinical
    AuditCategory.PRIVACY -> R.string.admin_category_privacy
}
private fun AuditCategory.icon():ImageVector=when(this) {
    AuditCategory.ACCOUNTS -> Icons.Default.AccountCircle
    AuditCategory.LINKS -> Icons.Default.Share
    AuditCategory.CATALOGUE -> Icons.AutoMirrored.Filled.List
    AuditCategory.CLINICAL -> Icons.Default.DateRange
    AuditCategory.PRIVACY -> Icons.Default.Lock
}
internal fun AuditKind.label()=when(this) {
    AuditKind.ACCOUNT_ENABLED -> R.string.admin_event_account_enabled
    AuditKind.ACCOUNT_DISABLED -> R.string.admin_event_account_disabled
    AuditKind.PHOTO_UPDATED -> R.string.admin_event_photo_updated
    AuditKind.PHOTO_REMOVED -> R.string.admin_event_photo_removed
    AuditKind.PROFILE_UPDATED -> R.string.admin_event_profile_updated
    AuditKind.ROLE_GRANTED -> R.string.admin_event_role_granted
    AuditKind.ROLE_REMOVED -> R.string.admin_event_role_removed
    AuditKind.ROLE_CHANGED -> R.string.admin_event_role_changed
    AuditKind.LINK_CREATED -> R.string.admin_event_link_created
    AuditKind.LINK_UPDATED -> R.string.admin_event_link_updated
    AuditKind.INVITATION_CREATED -> R.string.admin_event_invitation
    AuditKind.EXERCISE_ACTIVATED -> R.string.admin_event_exercise_activated
    AuditKind.EXERCISE_DEACTIVATED -> R.string.admin_event_exercise_deactivated
    AuditKind.VERSION_PUBLISHED -> R.string.admin_event_version_published
    AuditKind.PRESCRIPTION_PUBLISHED -> R.string.admin_event_prescription
    AuditKind.SESSION_RECORDED -> R.string.admin_event_session
    AuditKind.CONSENT_RECORDED -> R.string.admin_event_consent
    AuditKind.REQUEST_CREATED -> R.string.admin_event_request_created
    AuditKind.REQUEST_UPDATED -> R.string.admin_event_request_updated
    AuditKind.OTHER -> R.string.admin_event_other
}

/** One bordered group of audit rows, newest first. */
@Composable internal fun ActivityList(events:List<AuditEvent>) {
    Surface(Modifier.fillMaxWidth(),color=MaterialTheme.colorScheme.surface,shape=MaterialTheme.shapes.large,
        border=BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant)) {
        Column {
            events.forEachIndexed {index,event ->
                if(index>0) HorizontalDivider(Modifier.padding(horizontal=20.dp),color=MaterialTheme.colorScheme.outlineVariant)
                ActivityRow(event)
            }
        }
    }
}

@Composable private fun ActivityRow(event:AuditEvent) {
    val category=event.category()
    val attention=event.kind() in setOf(AuditKind.ACCOUNT_DISABLED,AuditKind.ROLE_REMOVED,AuditKind.EXERCISE_DEACTIVATED,AuditKind.PHOTO_REMOVED)
    val target=when(category) {
        AuditCategory.ACCOUNTS -> event.targetName.ifBlank {shortId(event.targetId)}
        AuditCategory.LINKS -> if(event.targetType=="therapist_patients") {
            val (therapist,patient)=event.targetId.split(':').let {(it.getOrNull(0) ?: "") to (it.getOrNull(1) ?: "")}
            stringResource(R.string.admin_event_link_target,event.targetName.ifBlank {shortId(therapist)},event.relatedName.ifBlank {shortId(patient)})
        } else stringResource(R.string.admin_event_reference,shortId(event.targetId))
        else -> stringResource(R.string.admin_event_reference,shortId(event.targetId))
    }
    val actor=when {
        event.system -> stringResource(R.string.admin_event_system)
        else -> event.actorName.ifBlank {shortId(event.actorId.orEmpty())}
    }
    Row(Modifier.fillMaxWidth().padding(horizontal=20.dp,vertical=14.dp).semantics(mergeDescendants=true) {},
        verticalAlignment=Alignment.Top,horizontalArrangement=Arrangement.spacedBy(14.dp)) {
        IconBadge(category.icon(),if(attention) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.secondary,40)
        Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(2.dp)) {
            Text(stringResource(event.kind().label()),style=MaterialTheme.typography.titleSmall)
            Text(target,style=MaterialTheme.typography.bodyMedium,maxLines=2,overflow=TextOverflow.Ellipsis)
            Text(stringResource(R.string.admin_event_meta,actor,adminDateTime(event.recordedAt) ?: event.recordedAt),
                style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
