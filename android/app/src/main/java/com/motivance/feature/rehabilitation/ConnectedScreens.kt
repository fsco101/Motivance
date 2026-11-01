package com.motivance.feature.rehabilitation

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.motivance.R
import com.motivance.feature.auth.ProfileAvatar
import com.motivance.data.local.CachedPrescription
import com.motivance.data.local.ExerciseJson
import com.motivance.domain.*
import com.motivance.designsystem.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.Alignment
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import java.text.DateFormat
import java.util.Date
import java.util.UUID

internal fun RehabAction.loadingLabel()=when(this) {
    RehabAction.REFRESH -> R.string.ui_loading_workspace
    RehabAction.INVITE -> R.string.ui_creating_invitation
    RehabAction.ACCEPT -> R.string.ui_connecting_therapist
    RehabAction.REVOKE -> R.string.ui_revoking_access
    RehabAction.PRESCRIBE -> R.string.ui_publishing_prescription
    RehabAction.SYNC -> R.string.ui_preparing_sync
    RehabAction.WITHDRAW -> R.string.ui_withdrawing_consent
    RehabAction.EXPORT, RehabAction.DELETE -> R.string.ui_submitting_request
}

@Composable fun ConnectedStatus(state:RehabilitationState,refresh:()->Unit) {
    when {
        state.busy -> LoadingNotice(state.activeAction?.loadingLabel() ?: R.string.ui_loading_workspace)
        state.failed -> FeedbackNotice(R.string.connected_failed,error=true,retry=refresh)
        state.notice && state.completedAction!=RehabAction.REFRESH -> FeedbackNotice(when(state.completedAction) {
            RehabAction.SYNC -> R.string.ui_sync_queued
            RehabAction.PRESCRIBE -> R.string.ui_prescription_published
            RehabAction.EXPORT, RehabAction.DELETE -> R.string.request_pending
            RehabAction.WITHDRAW -> R.string.consent_withdrawn
            else -> R.string.ui_changes_saved
        })
    }
    if(!state.failed) ActionButton(R.string.refresh_connected,refresh,outlined=true,enabled=!state.busy,
        busy=state.activeAction==RehabAction.REFRESH,busyLabel=R.string.ui_loading_workspace)
}

@Composable fun ColumnScope.PatientManagement(state:RehabilitationState,vm:RehabilitationViewModel,open:(String)->Unit) {
    var email by rememberSaveable {mutableStateOf("")}
    var revoke by remember {mutableStateOf<LinkedPatient?>(null)}
    var inviting by rememberSaveable {mutableStateOf(false)}
    ActionButton(R.string.invite_patient,{inviting=!inviting},outlined=true,enabled=!state.busy)
    if(inviting) ClinicalCard {
    Text(stringResource(R.string.invite_patient),style=MaterialTheme.typography.titleLarge)
    Text(stringResource(R.string.invitation_help))
    OutlinedTextField(email,{email=it},label={Text(stringResource(R.string.email))},singleLine=true,enabled=!state.busy,modifier=Modifier.fillMaxWidth(),keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Email))
    ActionButton(R.string.create_invitation,{vm.invite(email)},enabled=!state.busy && email.isNotBlank(),busy=state.activeAction==RehabAction.INVITE,busyLabel=R.string.ui_creating_invitation)
    state.invitation?.let {code ->
        Text(stringResource(R.string.invitation_share))
        SelectionContainer {Text(code,style=MaterialTheme.typography.bodyMedium)}
    }
    }
    val patients=state.workspace.patients.filter {it.id!=state.owner}
    if(patients.isEmpty() && !state.busy && !state.failed) EmptyState(R.string.nav_patients,R.string.no_patients_detail)
    patients.forEach {patient -> Card(Modifier.fillMaxWidth(),colors=CardDefaults.cardColors(containerColor=MaterialTheme.colorScheme.surface),border=androidx.compose.foundation.BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant)) {
        Column(Modifier.padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            patient.profile?.let {ProfileAvatar(it);Text("@"+it.username,style=MaterialTheme.typography.titleMedium);Text(stringResource(R.string.profile_age,it.age?.toString() ?: "--"))}
            Text(patient.name.ifBlank {patient.id.take(8)},style=MaterialTheme.typography.titleMedium)
            OutlinedButton({open(patient.id)},enabled=!state.busy) {Text(stringResource(R.string.patient_history_and_prescribe))}
            TextButton({revoke=patient},enabled=!state.busy) {Text(stringResource(R.string.revoke_patient_access))}
        }
    } }
    revoke?.let {patient -> AlertDialog(onDismissRequest={revoke=null},title={Text(stringResource(R.string.revoke_patient_access))},text={Text(stringResource(R.string.revoke_confirmation))},confirmButton={TextButton({vm.revoke(patient.id); revoke=null}) {Text(stringResource(R.string.confirm_action))}},dismissButton={TextButton({revoke=null}) {Text(stringResource(R.string.cancel_action))}}) }
}

@Composable fun PatientInvitation(state:RehabilitationState,vm:RehabilitationViewModel) {
    var code by remember {mutableStateOf("")}
    Card(Modifier.fillMaxWidth(),colors=CardDefaults.cardColors(containerColor=MaterialTheme.colorScheme.surface),border=androidx.compose.foundation.BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant)) {Column(Modifier.padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.join_therapist),style=MaterialTheme.typography.titleMedium)
        Text(stringResource(R.string.join_therapist_help))
        OutlinedTextField(code,{code=it},label={Text(stringResource(R.string.invitation_code))},singleLine=true,enabled=!state.busy,modifier=Modifier.fillMaxWidth())
        ActionButton(R.string.accept_invitation,{vm.accept(code)},enabled=!state.busy && code.isNotBlank(),busy=state.activeAction==RehabAction.ACCEPT,busyLabel=R.string.ui_connecting_therapist)
    } }
}

@Composable fun ColumnScope.CachedAssignments(prescriptions:List<CachedPrescription>,unavailable:Boolean=false,loading:Boolean=false,start:(CachedPrescription)->Unit) {
    Text(stringResource(R.string.assignment_cache_policy),style=MaterialTheme.typography.bodySmall)
    if(unavailable) Text(stringResource(R.string.assignment_unavailable),color=MaterialTheme.colorScheme.error)
    if(prescriptions.isEmpty() && !loading) EmptyState(R.string.no_assignments,R.string.no_assignments_detail)
    prescriptions.forEach {p ->
        val rules=ExerciseJson.rules(p.rulesJson)
        val valid=p.expiresAt>System.currentTimeMillis()
        Card(Modifier.fillMaxWidth(),colors=CardDefaults.cardColors(containerColor=MaterialTheme.colorScheme.surface),border=androidx.compose.foundation.BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant)) {Column(Modifier.padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            Text(stringResource(if(rules.kind==ExerciseKind.ELBOW_FLEXION) R.string.elbow_flexion else R.string.shoulder_abduction),style=MaterialTheme.typography.titleLarge)
            Text(stringResource(if(rules.side==BodySide.LEFT) R.string.left_side else R.string.right_side))
            Text(p.instructions)
            Text(stringResource(R.string.assigned_focus,stringResource(if(rules.side==BodySide.LEFT) R.string.left_side else R.string.right_side),stringResource(rules.focusJoint.label())))
            Text(stringResource(R.string.session_targets,rules.lowDegrees.toInt(),rules.highDegrees.toInt()))
            Text(stringResource(R.string.completed_reps,0,rules.targetRepetitions))
            Text(stringResource(R.string.last_downloaded,if(p.cachedAt>0) DateFormat.getDateTimeInstance().format(Date(p.cachedAt)) else "--"),style=MaterialTheme.typography.bodySmall)
            Text(stringResource(R.string.pinned_version,p.versionId.take(8)),style=MaterialTheme.typography.labelSmall)
            if(!valid) Text(stringResource(R.string.assignment_expired),color=MaterialTheme.colorScheme.error)
            ActionButton(R.string.start_assigned_exercise,{start(p)},enabled=valid && p.instructions.isNotBlank())
        } }
    }
}

@Composable fun ColumnScope.PrescriptionForm(state:RehabilitationState,vm:RehabilitationViewModel,patientId:String?,existing:PrescriptionSummary?=null) {
    PrescriptionEditor(state,patientId,existing,vm::prescribe)
}

@Composable internal fun ColumnScope.PrescriptionEditor(state:RehabilitationState,patientId:String?,existing:PrescriptionSummary?=null,onPublish:(PrescriptionDraft)->Unit) {
    var patient by rememberSaveable {mutableStateOf(existing?.patientId ?: patientId.orEmpty())}
    var exercise by rememberSaveable {mutableStateOf(existing?.exerciseId ?: "")}
    var side by rememberSaveable {mutableStateOf(existing?.side ?: "left")}
    var low by rememberSaveable {mutableStateOf(existing?.low?.toString() ?: "20")}
    var high by rememberSaveable {mutableStateOf(existing?.high?.toString() ?: "90")}
    var reps by rememberSaveable {mutableStateOf(existing?.repetitions?.toString() ?: "5")}
    val parameters=remember(existing) {org.json.JSONObject(existing?.parameters ?: "{}")}
    var focusJoint by rememberSaveable {mutableStateOf(parameters.optString("focus_joint",""))}
    var minimum by rememberSaveable {mutableStateOf(parameters.optLong("minimum_cycle_ms",600).toString())}
    var maximum by rememberSaveable {mutableStateOf(parameters.optLong("maximum_cycle_ms",30000).toString())}
    var hold by rememberSaveable {mutableStateOf(parameters.optLong("peak_hold_ms",100).toString())}
    var lean by rememberSaveable {mutableStateOf(parameters.optDouble("max_trunk_lean_degrees",20.0).toString())}
    var requestId by rememberSaveable {mutableStateOf(UUID.randomUUID().toString())}
    val assignmentId=rememberSaveable {existing?.assignmentId ?: UUID.randomUUID().toString()}
    fun changed() {requestId=UUID.randomUUID().toString()}
    Text(stringResource(R.string.prescription_version_help))
    Choice(R.string.select_patient,state.workspace.patients.filter {it.id!=state.owner}.map {it.id to it.name.ifBlank {it.id.take(8)}},patient,!state.busy && existing==null) {patient=it; changed()}
    Choice(R.string.select_exercise,state.workspace.catalogue.map {it.id to it.name},exercise,!state.busy) {exercise=it; changed()}
    Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
        listOf("left" to R.string.left_side,"right" to R.string.right_side).forEach {(value,label) -> FilterChip(side==value,{side=value;changed()},enabled=!state.busy,label={Text(stringResource(label))})}
    }
    Text(stringResource(R.string.prescription_focus),style=MaterialTheme.typography.titleSmall)
    Text(stringResource(R.string.prescription_focus_help),style=MaterialTheme.typography.bodySmall)
    Choice(R.string.prescription_focus,listOf("" to stringResource(R.string.focus_automatic))+BodyJoint.entries.map {it.name to stringResource(it.label())},focusJoint,!state.busy) {focusJoint=it;changed()}
    @Composable fun field(label:Int,value:String,set:(String)->Unit) {OutlinedTextField(value,{set(it);changed()},enabled=!state.busy,label={Text(stringResource(label))},singleLine=true,modifier=Modifier.fillMaxWidth(),keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Decimal))}
    field(R.string.target_minimum,low) {low=it}; field(R.string.target_maximum,high) {high=it}; field(R.string.target_repetitions,reps) {reps=it}
    var advanced by rememberSaveable {mutableStateOf(false)}
    TextButton({advanced=!advanced}) {Text(stringResource(if(advanced) R.string.ui_hide_timing else R.string.ui_show_timing))}
    if(advanced) {
    field(R.string.minimum_cycle_ms,minimum) {minimum=it}; field(R.string.maximum_cycle_ms,maximum) {maximum=it}; field(R.string.peak_hold_ms,hold) {hold=it}; field(R.string.maximum_trunk_lean,lean) {lean=it}
    }
    val l=low.toDoubleOrNull(); val h=high.toDoubleOrNull(); val r=reps.toIntOrNull(); val min=minimum.toLongOrNull(); val max=maximum.toLongOrNull(); val peak=hold.toLongOrNull(); val trunk=lean.toDoubleOrNull()
    val valid=patient.isNotBlank() && exercise.isNotBlank() && l!=null && h!=null && r!=null && min!=null && max!=null && peak!=null && trunk!=null && runCatching {ExerciseRules(lowDegrees=l,highDegrees=h,targetRepetitions=r,minimumCycleMs=min,maximumCycleMs=max,peakHoldMs=peak,maxTrunkLeanDegrees=trunk); require(min in 100..30000 && max<=300000 && peak<=5000)}.isSuccess
    ActionButton(R.string.publish_prescription,{onPublish(PrescriptionDraft(assignmentId,requestId,patient,exercise,BodySide.valueOf(side.uppercase()),l!!,h!!,r!!,min!!,max!!,peak!!,trunk!!,parameters.optDouble("confidence",.7),focusJoint.takeIf {it.isNotBlank()}?.let {BodyJoint.valueOf(it)}))},enabled=valid && !state.busy,busy=state.activeAction==RehabAction.PRESCRIBE,busyLabel=R.string.ui_publishing_prescription)
    if(state.completedAction==RehabAction.PRESCRIBE && state.notice) FeedbackNotice(R.string.ui_prescription_published)
    if(state.failed && !state.busy) FeedbackNotice(R.string.connected_failed,error=true)
}

@Composable private fun Choice(label:Int,options:List<Pair<String,String>>,selected:String,enabled:Boolean,choose:(String)->Unit) {
    var expanded by remember {mutableStateOf(false)}
    Box {
        OutlinedButton({expanded=true},enabled=enabled && options.isNotEmpty(),modifier=Modifier.fillMaxWidth().heightIn(min=56.dp),shape=MaterialTheme.shapes.small) {
            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)) {
                Text(stringResource(label),style=MaterialTheme.typography.labelSmall)
                Text(options.firstOrNull {it.first==selected}?.second ?: stringResource(R.string.history_select))
            }
            Icon(Icons.Default.KeyboardArrowDown,null)
        }
        DropdownMenu(expanded,{expanded=false}) {options.forEach {(id,name) -> DropdownMenuItem(text={Text(name)},onClick={choose(id);expanded=false})}}
    }
}

@Composable fun ColumnScope.SyncAndPrivacy(state:RehabilitationState,vm:RehabilitationViewModel,patient:Boolean,onWithdraw:()->Unit) {
    ClinicalCard {
    Text(stringResource(R.string.synchronization),style=MaterialTheme.typography.titleLarge)
    ActionButton(R.string.sync_now,{vm.synchronize()},enabled=!state.busy,busy=state.activeAction==RehabAction.SYNC,busyLabel=R.string.ui_preparing_sync)
    if(state.outbox.isEmpty()) Text(stringResource(R.string.ui_no_pending_uploads),color=MaterialTheme.colorScheme.onSurfaceVariant)
    state.outbox.forEach {item -> Text(stringResource(R.string.sync_item,item.sessionId.take(8),syncLabel(item.state))) }
    }
    if(patient) ClinicalCard {
        Text(stringResource(R.string.ui_privacy_title),style=MaterialTheme.typography.titleLarge)
        Text(stringResource(R.string.consent_policy),style=MaterialTheme.typography.bodySmall)
        state.consents.firstOrNull()?.let {Text(stringResource(if(it.event=="granted") R.string.consent_granted else R.string.consent_withdrawn)); Text(syncLabel(it.state))}
        ActionButton(R.string.withdraw_consent,onWithdraw,outlined=true,enabled=!state.busy,busy=state.activeAction==RehabAction.WITHDRAW,busyLabel=R.string.ui_withdrawing_consent)
        Text(stringResource(R.string.privacy_request_help),style=MaterialTheme.typography.bodySmall)
        ActionButton(R.string.request_export,{vm.request("export")},outlined=true,enabled=!state.busy,busy=state.activeAction==RehabAction.EXPORT,busyLabel=R.string.ui_submitting_request)
        ActionButton(R.string.request_deletion,{vm.request("delete")},outlined=true,enabled=!state.busy,busy=state.activeAction==RehabAction.DELETE,busyLabel=R.string.ui_submitting_request)
        state.workspace.requests.forEach {Text(stringResource(if(it.kind=="export") R.string.request_export else R.string.request_deletion)+": "+stringResource(when(it.status) {"fulfilled"->R.string.request_fulfilled; "declined"->R.string.request_declined; else->R.string.request_pending}))}
    }
}

@Composable fun syncLabel(state:String)=stringResource(when(state) {
    "SYNCED" -> R.string.sync_synced
    "LOCAL_ONLY" -> R.string.sync_local_only
    "WAITING_AUTH" -> R.string.sync_auth
    "REJECTED" -> R.string.sync_rejected
    "FAILED" -> R.string.sync_failed
    "REVIEW_REQUIRED" -> R.string.sync_legacy
    else -> R.string.sync_pending
})
