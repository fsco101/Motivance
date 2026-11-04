package com.motivance.feature.admin

import android.content.ClipData
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.motivance.R
import com.motivance.designsystem.*
import com.motivance.domain.*
import kotlinx.coroutines.launch

@Composable internal fun ColumnScope.AdminAccounts(state:AdministrationState,vm:AdministrationViewModel,filter:AccountFilter,
    setFilter:(AccountFilter)->Unit,confirm:(AdminConfirmation)->Unit,manageLinks:(therapist:String,patient:String)->Unit) {
    var text by rememberSaveable {mutableStateOf(state.query)}
    val focus=LocalFocusManager.current
    val submit={focus.clearFocus();vm.search(text)}
    OutlinedTextField(text,{text=it.take(ADMIN_SEARCH_LIMIT)},Modifier.fillMaxWidth(),enabled=!state.busy,singleLine=true,
        label={Text(stringResource(R.string.admin_search))},
        supportingText={Text(stringResource(R.string.admin_search_help))},
        leadingIcon={Icon(Icons.Default.Search,null)},
        trailingIcon={if(text.isNotEmpty()) IconButton({text="";if(state.query.isNotEmpty()) vm.search("")},enabled=!state.busy) {
            Icon(Icons.Default.Clear,stringResource(R.string.admin_search_clear))
        }},
        shape=RoundedCornerShape(12.dp),
        keyboardOptions=KeyboardOptions(imeAction=ImeAction.Search),keyboardActions=KeyboardActions(onSearch={submit()}))
    if(text.trim()!=state.query) ActionButton(R.string.admin_search_action,submit,enabled=!state.busy,busy=state.activeAction==AdminAction.SEARCH,busyLabel=R.string.admin_searching)
    ChoiceChips(AccountFilter.entries,filter,{stringResource(it.label())}) {setFilter(it)}
    val shown=state.data.accounts.filter {filter.accepts(it)}
    SectionHeading(if(state.query.isEmpty()) R.string.admin_directory else R.string.admin_search_results) {
        if(state.data.accounts.isNotEmpty()) StatusPill(stringResource(R.string.admin_shown_count,shown.size,state.data.accounts.size),PillTone.PRIMARY)
    }
    if(state.query.isNotEmpty()) Text(stringResource(R.string.admin_search_for,state.query),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    if(shown.isEmpty() && !state.busy && !state.failed) EmptyState(R.string.admin_accounts_empty,
        if(state.data.next!=null) R.string.admin_accounts_empty_more else R.string.admin_accounts_empty_detail)
    shown.forEach {account -> key(account.id) {AccountCard(account,account.id==state.owner,!state.busy,confirm,manageLinks,vm)}}
    if(state.data.next!=null) ActionButton(R.string.admin_more,{vm.older()},outlined=true,enabled=!state.busy,busy=state.activeAction==AdminAction.MORE,busyLabel=R.string.ui_loading_older)
}

private fun AccountFilter.label()=when(this) {
    AccountFilter.ALL -> R.string.admin_filter_all
    AccountFilter.PATIENTS -> R.string.admin_filter_patients
    AccountFilter.THERAPISTS -> R.string.admin_filter_therapists
    AccountFilter.ADMINS -> R.string.admin_filter_admins
    AccountFilter.DISABLED -> R.string.admin_filter_disabled
}

@Composable private fun AccountCard(account:AdminAccount,self:Boolean,enabled:Boolean,confirm:(AdminConfirmation)->Unit,
    manageLinks:(String,String)->Unit,vm:AdministrationViewModel) {
    var expanded by rememberSaveable(account.id) {mutableStateOf(false)}
    ClinicalCard {
        val toggle=stringResource(if(expanded) R.string.ui_collapse else R.string.ui_expand)
        Row(Modifier.fillMaxWidth().clickable(onClickLabel=toggle,role=Role.Button) {expanded=!expanded},
            verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(14.dp)) {
            AdminAvatar(account.label,account.primaryRole,account.active,photoUrl=account.photoUrl)
            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)) {
                Text(account.label,style=MaterialTheme.typography.titleMedium,maxLines=1,overflow=TextOverflow.Ellipsis)
                val secondary=listOfNotNull(account.username?.let {"@$it"},account.email.takeIf {it.isNotBlank() && it!=account.label}).joinToString(" · ")
                if(secondary.isNotEmpty()) Text(secondary,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant,maxLines=1,overflow=TextOverflow.Ellipsis)
                AccountBadges(account,self)
            }
            Icon(Icons.Default.KeyboardArrowDown,null,Modifier.rotate(if(expanded) 180f else 0f),tint=MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if(expanded) AccountDetails(account,self,enabled,confirm,manageLinks,vm)
    }
}

@Composable private fun ColumnScope.AccountDetails(account:AdminAccount,self:Boolean,enabled:Boolean,confirm:(AdminConfirmation)->Unit,
    manageLinks:(String,String)->Unit,vm:AdministrationViewModel) {
    HorizontalDivider(color=MaterialTheme.colorScheme.outlineVariant)
    AccountIdRow(account.id)
    Row(horizontalArrangement=Arrangement.spacedBy(16.dp)) {
        DetailRow(stringResource(R.string.admin_joined),adminDate(account.createdAt) ?: "—",Modifier.weight(1f))
        DetailRow(stringResource(R.string.admin_last_sign_in),adminDateTime(account.lastSignInAt) ?: stringResource(R.string.admin_never),Modifier.weight(1f))
    }
    if(self) {
        Surface(color=MaterialTheme.colorScheme.surfaceContainerLow,shape=MaterialTheme.shapes.medium) {
            Row(Modifier.fillMaxWidth().padding(14.dp),horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                Icon(Icons.Default.Info,null,tint=MaterialTheme.colorScheme.secondary)
                Text(stringResource(R.string.admin_self_notice),style=MaterialTheme.typography.bodySmall)
            }
        }
        return
    }
    Text(stringResource(R.string.admin_access),style=MaterialTheme.typography.titleSmall,color=MaterialTheme.colorScheme.primary,modifier=Modifier.semantics {heading()})
    val name=account.label
    listOf(Triple("therapist",R.string.admin_role_therapist_detail,R.string.admin_revoke_therapist_detail),
        Triple("admin",R.string.admin_role_admin_detail,R.string.admin_revoke_admin_detail)).forEach {(role,detail,revokeDetail) ->
        val granted=role in account.roles
        val label=roleLabel(role)
        val grantTitle=stringResource(R.string.admin_confirm_grant_title,label)
        val revokeTitle=stringResource(R.string.admin_confirm_revoke_title,label)
        val grantMessage=stringResource(R.string.admin_confirm_grant,label,name)
        val revokeMessage=stringResource(R.string.admin_confirm_revoke,label,name)+" "+stringResource(revokeDetail)
        val grantLabel=stringResource(R.string.admin_grant)
        val revokeLabel=stringResource(R.string.admin_revoke)
        RoleSwitch(label,stringResource(detail),granted,enabled && account.active) {
            confirm(if(granted) AdminConfirmation(revokeTitle,revokeMessage,revokeLabel,true) {vm.role(account.id,role,false)}
                else AdminConfirmation(grantTitle,grantMessage,grantLabel,role=="admin") {vm.role(account.id,role,true)})
        }
    }
    if(!account.active) Text(stringResource(R.string.admin_roles_need_active),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    if(account.active && ("therapist" in account.roles || !account.staff)) {
        val therapist="therapist" in account.roles
        OutlinedButton({if(therapist) manageLinks(account.id,"") else manageLinks("",account.id)},Modifier.fillMaxWidth().heightIn(min=48.dp),
            enabled=enabled,shape=MaterialTheme.shapes.medium) {
            Icon(Icons.Default.Share,null,Modifier.size(18.dp));Spacer(Modifier.width(8.dp))
            Text(stringResource(if(therapist) R.string.admin_link_patient else R.string.admin_assign_therapist))
        }
    }
    if(account.photoUrl!=null) {
        val photoTitle=stringResource(R.string.admin_remove_photo)
        val photoMessage=stringResource(R.string.admin_confirm_remove_photo,name)
        OutlinedButton({confirm(AdminConfirmation(photoTitle,photoMessage,photoTitle,true) {vm.clearPhoto(account.id)})},
            Modifier.fillMaxWidth().heightIn(min=48.dp),enabled=enabled,shape=MaterialTheme.shapes.medium) {
            Icon(Icons.Default.Delete,null,Modifier.size(18.dp));Spacer(Modifier.width(8.dp));Text(photoTitle)
        }
    }
    val disableTitle=stringResource(R.string.admin_disable)
    val enableTitle=stringResource(R.string.admin_enable)
    val disableMessage=stringResource(R.string.admin_confirm_disable,name)
    val enableMessage=stringResource(R.string.admin_confirm_enable,name)
    if(account.active) OutlinedButton({confirm(AdminConfirmation(disableTitle,disableMessage,disableTitle,true) {vm.account(account.id,false)})},
        Modifier.fillMaxWidth().heightIn(min=48.dp),enabled=enabled,shape=MaterialTheme.shapes.medium,
        colors=ButtonDefaults.outlinedButtonColors(contentColor=MaterialTheme.colorScheme.error)) {
        Icon(Icons.Default.Lock,null,Modifier.size(18.dp));Spacer(Modifier.width(8.dp));Text(disableTitle)
    }
    else Button({confirm(AdminConfirmation(enableTitle,enableMessage,enableTitle,false) {vm.account(account.id,true)})},
        Modifier.fillMaxWidth().heightIn(min=48.dp),enabled=enabled,shape=MaterialTheme.shapes.medium) {
        Icon(Icons.Default.CheckCircle,null,Modifier.size(18.dp));Spacer(Modifier.width(8.dp));Text(enableTitle)
    }
}

/** Selectable account ID with a copy action, since links and support requests refer to accounts by ID. */
@Composable private fun AccountIdRow(id:String) {
    val clipboard=LocalClipboard.current
    val scope=rememberCoroutineScope()
    var copied by remember(id) {mutableStateOf(false)}
    Row(verticalAlignment=Alignment.CenterVertically) {
        Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(2.dp)) {
            Text(stringResource(R.string.admin_account_id),style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
            SelectionContainer {Text(id,style=MaterialTheme.typography.bodySmall)}
        }
        TextButton({scope.launch {clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("account-id",id)));copied=true}},Modifier.heightIn(min=48.dp)) {
            if(copied) {Icon(Icons.Default.Check,null,Modifier.size(18.dp));Spacer(Modifier.width(6.dp))}
            Text(stringResource(if(copied) R.string.admin_copied else R.string.admin_copy_id),
                modifier=Modifier.semantics {liveRegion=LiveRegionMode.Polite})
        }
    }
}

/** The whole row toggles, so the switch, title and explanation read as one control. */
@Composable private fun RoleSwitch(title:String,detail:String,checked:Boolean,enabled:Boolean,onToggle:()->Unit) {
    Row(Modifier.fillMaxWidth().toggleable(checked,enabled=enabled,role=Role.Switch) {onToggle()}.padding(vertical=4.dp),
        verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
        Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(2.dp)) {
            Text(title,style=MaterialTheme.typography.bodyLarge,color=if(enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.outline)
            Text(detail,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked,null,enabled=enabled)
    }
}
