package com.motivance.feature.admin

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.motivance.R
import com.motivance.designsystem.*
import com.motivance.domain.AdminAccount
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

enum class AdminSection(val label:Int,val icon:ImageVector) {
    OVERVIEW(R.string.admin_overview,Icons.Default.Home),
    ACCOUNTS(R.string.admin_accounts,Icons.Default.AccountCircle),
    LINKS(R.string.admin_links_tab,Icons.Default.Share),
    CATALOGUE(R.string.admin_catalogue_tab,Icons.AutoMirrored.Filled.List),
    ACTIVITY(R.string.admin_activity,Icons.Default.Notifications),
}

/** A pending confirmation. The message names the affected record so the administrator approves one specific change. */
internal class AdminConfirmation(val title:String,val message:String,val confirm:String,val destructive:Boolean,val action:()->Unit)

@Composable internal fun AdminConfirmDialog(request:AdminConfirmation,dismiss:()->Unit) {
    AlertDialog(onDismissRequest=dismiss,
        icon={Icon(if(request.destructive) Icons.Default.Warning else Icons.Default.Info,null,
            tint=if(request.destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.secondary)},
        title={Text(request.title)},
        text={Text(request.message)},
        confirmButton={TextButton({dismiss();request.action()},
            colors=if(request.destructive) ButtonDefaults.textButtonColors(contentColor=MaterialTheme.colorScheme.error) else ButtonDefaults.textButtonColors()) {
            Text(request.confirm)
        }},
        dismissButton={TextButton(dismiss) {Text(stringResource(R.string.cancel_action))}})
}

internal fun AdminAction.loadingLabel()=when(this) {
    AdminAction.REFRESH -> R.string.ui_loading_admin
    AdminAction.SEARCH -> R.string.admin_searching
    AdminAction.MORE, AdminAction.ACTIVITY -> R.string.ui_loading_older
    AdminAction.PUBLISH -> R.string.ui_publishing_catalogue
    else -> R.string.ui_saving_changes
}
internal fun AdminAction.savedLabel()=when(this) {
    AdminAction.ACCOUNT -> R.string.admin_saved_account
    AdminAction.ROLE -> R.string.admin_saved_role
    AdminAction.LINK -> R.string.admin_saved_link
    AdminAction.EXERCISE -> R.string.admin_saved_exercise
    AdminAction.PUBLISH -> R.string.admin_saved_publish
    AdminAction.PHOTO -> R.string.admin_saved_photo
    else -> R.string.ui_changes_saved
}

/** Progress, failure and saved notices plus a compact refresh action. */
@Composable internal fun AdminStatus(state:AdministrationState,refresh:()->Unit) {
    when {
        state.busy -> LoadingNotice(state.activeAction?.loadingLabel() ?: R.string.ui_loading_admin)
        state.failed -> FeedbackNotice(R.string.admin_failed,error=true,retry=refresh)
        state.updated -> FeedbackNotice(state.completedAction?.savedLabel() ?: R.string.ui_changes_saved)
    }
    if(!state.failed) Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End) {
        TextButton(refresh,enabled=!state.busy,modifier=Modifier.heightIn(min=48.dp)) {
            Icon(Icons.Default.Refresh,null,Modifier.size(18.dp));Spacer(Modifier.width(8.dp));Text(stringResource(R.string.admin_refresh))
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
/** Horizontally scrolling single-choice chip row, used for both section navigation and list filters. */
@Composable internal fun <T> ChoiceChips(options:List<T>,selected:T,label:@Composable (T)->String,icon:((T)->ImageVector)?=null,onSelect:(T)->Unit) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).semantics {selectableGroup()},horizontalArrangement=Arrangement.spacedBy(8.dp)) {
        options.forEach {option ->
            val chosen=option==selected
            // The row is wider than a phone; keep the selected chip visible, including after programmatic navigation.
            val requester=remember {BringIntoViewRequester()}
            LaunchedEffect(chosen) {if(chosen) requester.bringIntoView()}
            FilterChip(chosen,{onSelect(option)},label={Text(label(option))},modifier=Modifier.bringIntoViewRequester(requester),
                leadingIcon=icon?.let {{Icon(if(chosen) Icons.Default.Check else it(option),null,Modifier.size(18.dp))}})
        }
    }
}

@Composable internal fun roleLabel(role:String)=stringResource(when(role) {"admin" -> R.string.admin_role_admin;"therapist" -> R.string.admin_role_therapist;else -> R.string.admin_role_patient})

/** The account's photo, or initials on a role-coloured disc; disabled accounts are drawn neutral. */
@Composable internal fun AdminAvatar(name:String,role:String,active:Boolean=true,size:Int=48,photoUrl:String?=null) {
    val scheme=MaterialTheme.colorScheme
    val (container,content)=when {
        !active -> scheme.surfaceContainerHigh to scheme.outline
        role=="admin" -> scheme.primary to scheme.onPrimary
        role=="therapist" -> scheme.secondary to scheme.onSecondary
        else -> scheme.primaryContainer to scheme.onPrimaryContainer
    }
    PersonAvatar(photoUrl,name,size.dp,container=container,content=content)
}

/** Status and role badges shared by account cards and pickers. */
@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun AccountBadges(account:AdminAccount,self:Boolean) {
    FlowRow(horizontalArrangement=Arrangement.spacedBy(6.dp),verticalArrangement=Arrangement.spacedBy(6.dp)) {
        if(self) StatusPill(stringResource(R.string.admin_you),PillTone.PRIMARY)
        listOf("admin","therapist").filter {it in account.roles}.forEach {StatusPill(roleLabel(it),PillTone.POSITIVE)}
        if(!account.staff) StatusPill(roleLabel("patient"))
        if(!account.active) StatusPill(stringResource(R.string.admin_disabled),PillTone.ATTENTION,Icons.Default.Lock)
    }
}

/** A tappable stat tile; [caption] carries a secondary count such as how many records need attention. */
@Composable internal fun AdminMetric(label:Int,value:String,icon:ImageVector,modifier:Modifier=Modifier,caption:String?=null,
    tint:Color=MaterialTheme.colorScheme.secondary,onClick:(()->Unit)?=null) {
    val body:@Composable ColumnScope.()->Unit={
        IconBadge(icon,tint,36)
        Text(value,style=MaterialTheme.typography.headlineMedium,fontWeight=FontWeight.Bold,color=MaterialTheme.colorScheme.primary)
        Text(stringResource(label),style=MaterialTheme.typography.labelLarge,color=MaterialTheme.colorScheme.onSurface)
        if(caption!=null) Text(caption,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    }
    val border=androidx.compose.foundation.BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant)
    val content:@Composable ()->Unit={Column(Modifier.padding(16.dp).semantics(mergeDescendants=true) {},verticalArrangement=Arrangement.spacedBy(6.dp),content=body)}
    if(onClick!=null) Surface(onClick,modifier,color=MaterialTheme.colorScheme.surface,shape=MaterialTheme.shapes.large,border=border,content=content)
    else Surface(modifier,color=MaterialTheme.colorScheme.surface,shape=MaterialTheme.shapes.large,border=border,content=content)
}

internal val ACCOUNT_ID=Regex("^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$")
internal fun shortId(id:String)=id.take(8)

private fun parse(value:String?)=value?.let {runCatching {OffsetDateTime.parse(it,DateTimeFormatter.ISO_OFFSET_DATE_TIME).atZoneSameInstant(ZoneId.systemDefault())}.getOrNull()}
internal fun adminDate(value:String?)=parse(value)?.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(Locale.getDefault()))
internal fun adminDateTime(value:String?)=parse(value)?.format(DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM,FormatStyle.SHORT).withLocale(Locale.getDefault()))
