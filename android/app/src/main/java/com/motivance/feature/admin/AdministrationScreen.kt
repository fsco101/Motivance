package com.motivance.feature.admin

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.motivance.R
import com.motivance.designsystem.*
import androidx.compose.runtime.saveable.rememberSaveable

@OptIn(ExperimentalLayoutApi::class)
@Composable fun ColumnScope.AdministrationScreen(vm:AdministrationViewModel) {
    val state by vm.state.collectAsStateWithLifecycle()
    LaunchedEffect(state.owner) {vm.refresh()}
    var confirm by remember {mutableStateOf<(() -> Unit)?>(null)}
    Text(stringResource(R.string.admin_title),style=MaterialTheme.typography.headlineMedium)
    Text(stringResource(R.string.admin_scope))
    if(state.busy) LoadingNotice(when(state.activeAction) {
        AdminAction.REFRESH -> R.string.ui_loading_admin
        AdminAction.MORE -> R.string.ui_loading_older
        AdminAction.PUBLISH -> R.string.ui_publishing_catalogue
        else -> R.string.ui_saving_changes
    })
    if(state.failed) FeedbackNotice(R.string.connected_failed,error=true,retry={vm.refresh()})
    if(state.updated) FeedbackNotice(R.string.ui_changes_saved)
    ActionButton(R.string.refresh_connected,{vm.refresh()},outlined=true,enabled=!state.busy)
    var section by rememberSaveable {mutableStateOf(0)}
    FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
        listOf(R.string.admin_accounts,R.string.admin_links,R.string.admin_catalogue).forEachIndexed {index,label ->
            FilterChip(section==index,{section=index},enabled=!state.busy,label={Text(stringResource(label))})
        }
    }
    if(section==0) {
    Text(stringResource(R.string.admin_accounts),style=MaterialTheme.typography.titleLarge)
    state.data.accounts.forEach {account -> Card(Modifier.fillMaxWidth(),colors=CardDefaults.cardColors(containerColor=MaterialTheme.colorScheme.surface),border=androidx.compose.foundation.BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant)) {Column(Modifier.padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
        Text(account.name.ifBlank {account.id},style=MaterialTheme.typography.titleMedium)
        Text(account.id)
        Text(stringResource(if(account.active) R.string.admin_active else R.string.admin_disabled))
        if(account.id!=state.owner) {
            OutlinedButton({confirm={vm.account(account.id,!account.active)}},enabled=!state.busy) {Text(stringResource(if(account.active) R.string.admin_disable else R.string.admin_enable))}
            listOf("therapist" to R.string.role_therapist,"admin" to R.string.role_admin).forEach {(role,label) ->
                val roleLabel=stringResource(label)
                Row {Checkbox(role in account.roles,{granted -> confirm={vm.role(account.id,role,granted)}},enabled=!state.busy && account.active,modifier=Modifier.semantics {contentDescription=roleLabel});Text(roleLabel,Modifier.padding(top=12.dp))}
            }
        }
    }}}
    if(state.data.next!=null) ActionButton(R.string.admin_more,{vm.older()},outlined=true,enabled=!state.busy,busy=state.activeAction==AdminAction.MORE,busyLabel=R.string.ui_loading_older)
    }
    if(section==1) ClinicalCard {
    Text(stringResource(R.string.admin_links),style=MaterialTheme.typography.titleLarge)
    Text(stringResource(R.string.admin_link_help))
    var therapist by remember {mutableStateOf("")};var patient by remember {mutableStateOf("")}
    OutlinedTextField(therapist,{therapist=it},enabled=!state.busy,label={Text(stringResource(R.string.admin_therapist_id))},modifier=Modifier.fillMaxWidth())
    OutlinedTextField(patient,{patient=it},enabled=!state.busy,label={Text(stringResource(R.string.admin_patient_id))},modifier=Modifier.fillMaxWidth())
    val valid=runCatching {java.util.UUID.fromString(therapist);java.util.UUID.fromString(patient)}.isSuccess
    Button({confirm={vm.link(therapist,patient,true)}},enabled=valid && !state.busy) {Text(stringResource(R.string.admin_link))}
    state.data.links.forEach {link ->
        Text("${link.therapist} → ${link.patient}")
        OutlinedButton({confirm={vm.link(link.therapist,link.patient,!link.active)}},enabled=!state.busy) {Text(stringResource(if(link.active) R.string.admin_unlink else R.string.admin_link))}
    }
    }
    if(section==2) {
    Text(stringResource(R.string.admin_catalogue),style=MaterialTheme.typography.titleLarge)
    state.data.exercises.forEach {exercise -> key(exercise.id,exercise.version) {
        var name by remember {mutableStateOf(exercise.name)};var en by remember {mutableStateOf(exercise.english)};var fil by remember {mutableStateOf(exercise.filipino)}
        Card(Modifier.fillMaxWidth(),colors=CardDefaults.cardColors(containerColor=MaterialTheme.colorScheme.surface),border=androidx.compose.foundation.BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant)) {Column(Modifier.padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            Text("${exercise.code} · v${exercise.version}")
            OutlinedTextField(name,{name=it},enabled=!state.busy,label={Text(stringResource(R.string.admin_name))},modifier=Modifier.fillMaxWidth())
            OutlinedTextField(en,{en=it},enabled=!state.busy,label={Text(stringResource(R.string.admin_instructions_en))},modifier=Modifier.fillMaxWidth())
            OutlinedTextField(fil,{fil=it},enabled=!state.busy,label={Text(stringResource(R.string.admin_instructions_fil))},modifier=Modifier.fillMaxWidth())
            Button({confirm={vm.publish(exercise.id,name,en,fil)}},enabled=!state.busy && name.isNotBlank() && name.length<=120 && en.isNotBlank() && en.length<=4000 && fil.isNotBlank() && fil.length<=4000) {Text(stringResource(R.string.admin_publish))}
            OutlinedButton({confirm={vm.exercise(exercise.id,!exercise.active)}},enabled=!state.busy) {Text(stringResource(if(exercise.active) R.string.admin_deactivate else R.string.admin_activate))}
        }}
    }}
    }
    if(confirm!=null) AlertDialog(onDismissRequest={confirm=null},title={Text(stringResource(R.string.confirm_action))},text={Text(stringResource(R.string.admin_confirm))},confirmButton={TextButton({val action=confirm;confirm=null;action?.invoke()}) {Text(stringResource(R.string.confirm_action))}},dismissButton={TextButton({confirm=null}) {Text(stringResource(R.string.cancel_action))}})
}
