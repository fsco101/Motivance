package com.motivance.feature.admin

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.motivance.R
import com.motivance.designsystem.*
import com.motivance.domain.*

private const val LINK_DISPLAY_LIMIT=500
private const val PICKER_SUGGESTIONS=6

@Composable internal fun ColumnScope.AdminLinks(state:AdministrationState,vm:AdministrationViewModel,therapist:String,setTherapist:(String)->Unit,
    patient:String,setPatient:(String)->Unit,confirm:(AdminConfirmation)->Unit) {
    val accounts=state.data.accounts
    // Names come from the directory when loaded, otherwise from link rows, so either source can label an ID.
    val names=remember(accounts,state.data.links) {
        state.data.links.flatMap {listOf(it.therapist to it.therapistName,it.patient to it.patientName)}.filter {it.second.isNotBlank()}.toMap()+
            accounts.associate {it.id to it.label}
    }
    fun nameOf(id:String)=names[id]?.ifBlank {null} ?: shortId(id)

    ClinicalCard {
        Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(14.dp)) {
            IconBadge(Icons.Default.Share)
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.admin_new_link),style=MaterialTheme.typography.titleMedium)
                Text(stringResource(R.string.admin_link_help),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        AccountPicker(R.string.admin_therapist,therapist,accounts.filter {it.active && "therapist" in it.roles},!state.busy,setTherapist)
        AccountPicker(R.string.admin_patient,patient,accounts.filter {it.active && !it.staff},!state.busy,setPatient)
        val valid=ACCOUNT_ID.matches(therapist.trim()) && ACCOUNT_ID.matches(patient.trim()) && !therapist.trim().equals(patient.trim(),ignoreCase=true)
        val existing=state.data.links.firstOrNull {it.therapist.equals(therapist.trim(),true) && it.patient.equals(patient.trim(),true)}
        if(existing?.active==true) Text(stringResource(R.string.admin_link_exists),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.secondary)
        val title=stringResource(R.string.admin_link)
        val message=stringResource(R.string.admin_confirm_link,nameOf(therapist.trim()),nameOf(patient.trim()))
        ActionButton(R.string.admin_link,{confirm(AdminConfirmation(title,message,title,false) {vm.link(therapist,patient,true)})},enabled=valid && existing?.active!=true && !state.busy,busy=state.activeAction==AdminAction.LINK)
        Text(stringResource(R.string.admin_relink_notice),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    }

    var filter by rememberSaveable {mutableStateOf(LinkFilter.ACTIVE)}
    var text by rememberSaveable {mutableStateOf("")}
    val links=state.data.links
    SectionHeading(R.string.admin_links) {if(links.isNotEmpty()) StatusPill(stringResource(R.string.admin_active_count,links.count {it.active}),PillTone.PRIMARY)}
    ChoiceChips(LinkFilter.entries,filter,{stringResource(when(it) {
        LinkFilter.ACTIVE -> R.string.admin_link_filter_active;LinkFilter.REVOKED -> R.string.admin_link_filter_revoked;LinkFilter.ALL -> R.string.admin_filter_all
    })}) {filter=it}
    if(links.size>5) OutlinedTextField(text,{text=it.take(ADMIN_SEARCH_LIMIT)},Modifier.fillMaxWidth(),singleLine=true,
        label={Text(stringResource(R.string.admin_link_search))},leadingIcon={Icon(Icons.Default.Search,null)},
        trailingIcon={if(text.isNotEmpty()) IconButton({text=""}) {Icon(Icons.Default.Clear,stringResource(R.string.admin_search_clear))}},
        shape=RoundedCornerShape(12.dp))
    val needle=text.trim()
    val shown=links.filter {filter.accepts(it)}.filter {needle.isEmpty() ||
        listOf(nameOf(it.therapist),nameOf(it.patient),it.therapist,it.patient).any {value -> value.contains(needle,ignoreCase=true)}}
    if(shown.isEmpty() && !state.busy && !state.failed) EmptyState(R.string.admin_links_empty,R.string.admin_links_empty_detail)
    shown.groupBy {it.therapist}.forEach {(id,group) -> key(id) {TherapistLinks(id,nameOf(id),group,::nameOf,!state.busy,confirm,vm)}}
    if(links.size>=LINK_DISPLAY_LIMIT) Text(stringResource(R.string.admin_links_limit,LINK_DISPLAY_LIMIT),style=MaterialTheme.typography.bodySmall,
        color=MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable private fun TherapistLinks(id:String,name:String,links:List<AdminLink>,nameOf:(String)->String,enabled:Boolean,
    confirm:(AdminConfirmation)->Unit,vm:AdministrationViewModel) {
    ClinicalCard {
        Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(14.dp)) {
            AdminAvatar(name,"therapist",size=44)
            Column(Modifier.weight(1f)) {
                Text(name,style=MaterialTheme.typography.titleMedium,maxLines=1,overflow=TextOverflow.Ellipsis)
                Text(roleLabel("therapist"),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
            StatusPill(stringResource(R.string.admin_patient_count,links.count {it.active}),PillTone.POSITIVE)
        }
        links.forEach {link ->
            HorizontalDivider(color=MaterialTheme.colorScheme.outlineVariant)
            val patient=nameOf(link.patient)
            Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                AdminAvatar(patient,"patient",link.active,36)
                Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)) {
                    Text(patient,style=MaterialTheme.typography.titleSmall,maxLines=1,overflow=TextOverflow.Ellipsis)
                    StatusPill(stringResource(if(link.active) R.string.admin_link_active else R.string.admin_link_revoked),
                        if(link.active) PillTone.POSITIVE else PillTone.NEUTRAL)
                }
                val revokeTitle=stringResource(R.string.admin_unlink)
                val restoreTitle=stringResource(R.string.admin_restore_link)
                val revokeMessage=stringResource(R.string.admin_confirm_unlink,name,patient)
                val restoreMessage=stringResource(R.string.admin_confirm_link,name,patient)
                if(link.active) TextButton({confirm(AdminConfirmation(revokeTitle,revokeMessage,revokeTitle,true) {vm.link(id,link.patient,false)})},
                    enabled=enabled,colors=ButtonDefaults.textButtonColors(contentColor=MaterialTheme.colorScheme.error),modifier=Modifier.heightIn(min=48.dp)) {Text(revokeTitle)}
                else TextButton({confirm(AdminConfirmation(restoreTitle,restoreMessage,restoreTitle,false) {vm.link(id,link.patient,true)})},
                    enabled=enabled,modifier=Modifier.heightIn(min=48.dp)) {Text(restoreTitle)}
            }
        }
    }
}

/**
 * Searchable account field. Suggestions come from the loaded directory; an account ID can also be pasted, which
 * covers people on directory pages that are not loaded. The field shows the chosen account's name, and editing it
 * starts a new search.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun AccountPicker(label:Int,value:String,candidates:List<AdminAccount>,enabled:Boolean,onChange:(String)->Unit) {
    var expanded by remember {mutableStateOf(false)}
    val selected=candidates.firstOrNull {it.id.equals(value.trim(),ignoreCase=true)}
    val display=selected?.label ?: value
    val needle=if(selected!=null) "" else value.trim()
    val suggestions=candidates.filter {needle.isEmpty() || listOfNotNull(it.label,it.email,it.username,it.id).any {v -> v.contains(needle,ignoreCase=true)}}.take(PICKER_SUGGESTIONS)
    val invalid=value.isNotBlank() && !ACCOUNT_ID.matches(value.trim())
    ExposedDropdownMenuBox(expanded && enabled,{expanded=it}) {
        OutlinedTextField(display,{onChange(it.take(ADMIN_SEARCH_LIMIT));expanded=true},
            Modifier.fillMaxWidth().menuAnchor(MenuAnchorType.PrimaryEditable,enabled),enabled=enabled,singleLine=true,
            label={Text(stringResource(label))},isError=invalid && !expanded,
            leadingIcon={if(selected!=null) AdminAvatar(selected.label,selected.primaryRole,size=28) else Icon(Icons.Default.Person,null)},
            trailingIcon={ExposedDropdownMenuDefaults.TrailingIcon(expanded)},
            supportingText={Text(when {
                selected!=null -> listOfNotNull(selected.email.takeIf {it.isNotBlank()},shortId(selected.id)).joinToString(" · ")
                invalid -> stringResource(R.string.admin_picker_invalid)
                else -> stringResource(R.string.admin_picker_help)
            },maxLines=1,overflow=TextOverflow.Ellipsis)},
            shape=RoundedCornerShape(12.dp))
        ExposedDropdownMenu(expanded && enabled,{expanded=false}) {
            if(suggestions.isEmpty()) DropdownMenuItem(text={Text(stringResource(R.string.admin_picker_none))},onClick={expanded=false},enabled=false)
            suggestions.forEach {account ->
                DropdownMenuItem(
                    text={Column {
                        Text(account.label,style=MaterialTheme.typography.bodyLarge,maxLines=1,overflow=TextOverflow.Ellipsis)
                        Text(account.email.ifBlank {shortId(account.id)},style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant,maxLines=1,overflow=TextOverflow.Ellipsis)
                    }},
                    leadingIcon={AdminAvatar(account.label,account.primaryRole,size=32)},
                    onClick={onChange(account.id);expanded=false},
                    contentPadding=ExposedDropdownMenuDefaults.ItemContentPadding)
            }
        }
    }
}
