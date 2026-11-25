package com.motivance.feature.colleagues

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import com.motivance.R
import com.motivance.designsystem.*
import com.motivance.domain.*

/** Colleagues (#173): invite by email, accept or decline, and end a link at any time. Mirrors the web's ColleaguesPanel. */
@Composable fun ColleaguesCard(colleagues:List<Colleague>?,busy:Boolean,invite:(String)->Unit,respond:(Colleague,Boolean)->Unit,end:(Colleague)->Unit) {
    var inviting by rememberSaveable {mutableStateOf(false)}
    var email by rememberSaveable {mutableStateOf("")}
    var ending by remember {mutableStateOf<Colleague?>(null)}
    ClinicalCard(Modifier.testTag("colleagues")) {
        Text(stringResource(R.string.colleagues_title),style=MaterialTheme.typography.titleLarge,modifier=Modifier.semantics {heading()})
        Text(stringResource(R.string.colleagues_description),style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
        when {
            colleagues==null -> LoadingNotice(R.string.ui_loading_workspace)
            colleagues.isEmpty() -> Text(stringResource(R.string.colleagues_none),style=MaterialTheme.typography.bodyMedium)
            else -> colleagues.forEach {colleague -> key(colleague.id) {
                Column(verticalArrangement=Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                        PersonAvatar(colleague.photo,colleague.name,40.dp,decorative=true)
                        Text(colleague.name,Modifier.weight(1f),style=MaterialTheme.typography.titleMedium,maxLines=2,overflow=TextOverflow.Ellipsis)
                    }
                    StatusPill(stringResource(when {
                        colleague.state==ColleagueState.ACTIVE -> R.string.colleagues_linked
                        colleague.incoming -> R.string.colleagues_invited_you
                        else -> R.string.colleagues_waiting
                    }),if(colleague.state==ColleagueState.ACTIVE) PillTone.POSITIVE else PillTone.ATTENTION)
                    if(colleague.state==ColleagueState.REQUESTED && colleague.incoming) {
                        ActionButton(R.string.colleagues_accept,{respond(colleague,true)},enabled=!busy)
                        ActionButton(R.string.colleagues_decline,{respond(colleague,false)},outlined=true,enabled=!busy)
                    } else TextButton({ending=colleague},Modifier.fillMaxWidth().heightIn(min=48.dp),enabled=!busy) {
                        Text(stringResource(if(colleague.state==ColleagueState.ACTIVE) R.string.colleagues_end else R.string.colleagues_withdraw))
                    }
                }
            }}
        }
        ActionButton(R.string.colleagues_invite,{email=""; inviting=true},outlined=true,enabled=!busy)
    }
    if(inviting) AlertDialog({inviting=false},title={Text(stringResource(R.string.colleagues_invite))},
        text={Column(verticalArrangement=Arrangement.spacedBy(12.dp)) {
            Text(stringResource(R.string.colleagues_invite_detail))
            OutlinedTextField(email,{email=it.take(254)},Modifier.fillMaxWidth(),singleLine=true,label={Text(stringResource(R.string.colleagues_email))},
                keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Email))
        }},
        confirmButton={TextButton({inviting=false; invite(email.trim())},enabled=email.contains('@')) {Text(stringResource(R.string.colleagues_send))}},
        dismissButton={TextButton({inviting=false}) {Text(stringResource(R.string.cancel_action))}})
    ending?.let {colleague -> AlertDialog({ending=null},title={Text(stringResource(R.string.colleagues_end_title,colleague.name))},
        text={Text(stringResource(R.string.colleagues_end_message))},
        confirmButton={TextButton({ending=null; end(colleague)}) {Text(stringResource(R.string.colleagues_end),color=MaterialTheme.colorScheme.error)}},
        dismissButton={TextButton({ending=null}) {Text(stringResource(R.string.cancel_action))}})}
}

/** Colleagues' patients, apart from one's own and labelled read-only. Opening one is recorded. */
@Composable fun ColleaguePatientsCard(patients:List<ColleaguePatient>?,open:(String)->Unit) {
    ClinicalCard(Modifier.testTag("colleague_patients")) {
        Text(stringResource(R.string.colleagues_patients_title),style=MaterialTheme.typography.titleLarge,modifier=Modifier.semantics {heading()})
        Text(stringResource(R.string.colleagues_patients_description),style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
        when {
            patients==null -> LoadingNotice(R.string.ui_loading_workspace)
            patients.isEmpty() -> Text(stringResource(R.string.colleagues_no_patients),style=MaterialTheme.typography.bodyMedium)
            else -> patients.forEach {patient -> key(patient.id) {
                Row(Modifier.fillMaxWidth().heightIn(min=56.dp).clickable(role=Role.Button) {open(patient.id)}.semantics(mergeDescendants=true) {},
                    verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                    PersonAvatar(patient.photo,patient.name,40.dp,decorative=true)
                    Column(Modifier.weight(1f)) {
                        Text(patient.name,style=MaterialTheme.typography.titleMedium)
                        Text(stringResource(R.string.colleagues_patient_of,patient.therapistName),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    StatusPill(stringResource(R.string.colleagues_read_only),PillTone.NEUTRAL)
                }
            }}
        }
    }
}

/** Who a colleague's patient is, whose patient, and that this view is read-only. */
@Composable fun ColleaguePatientHeader(patient:OpenedColleaguePatient) {
    ClinicalCard(Modifier.testTag("colleague_patient")) {
        Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
            PersonAvatar(patient.photo,patient.name,56.dp,decorative=true)
            Column(Modifier.weight(1f)) {
                Text(patient.name,style=MaterialTheme.typography.headlineSmall,fontWeight=FontWeight.Bold,modifier=Modifier.semantics {heading()})
                Text(stringResource(R.string.colleagues_patient_of,patient.therapists.joinToString(", ")),style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        StatusPill(stringResource(R.string.colleagues_colleague_patient),PillTone.PRIMARY)
        Text(stringResource(R.string.colleagues_read_only_detail),style=MaterialTheme.typography.bodyMedium)
    }
}

@Composable fun ColleaguePlanCard(plan:List<ColleaguePlanItem>?) {
    ClinicalCard {
        Text(stringResource(R.string.colleagues_plan_title),style=MaterialTheme.typography.titleLarge,modifier=Modifier.semantics {heading()})
        when {
            plan==null -> LoadingNotice(R.string.ui_loading_workspace)
            plan.isEmpty() -> Text(stringResource(R.string.colleagues_no_plan))
            else -> plan.forEach {item ->
                Column {
                    Text(item.exercise.ifBlank {stringResource(R.string.history_unknown_exercise)},style=MaterialTheme.typography.titleMedium)
                    Text(stringResource(R.string.colleagues_plan_line,sideLabel(item.side),item.low.toInt(),item.high.toInt(),item.repetitions),
                        style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

@Composable private fun sideLabel(side:String)=stringResource(when(side) {"right" -> R.string.right_side; "bilateral" -> R.string.history_bilateral; else -> R.string.left_side})

/** For a patient's own therapist: whether the patient shares with colleagues, who can see their progress, and when each last looked. */
@Composable fun ColleagueAccessCard(access:ColleagueAccess?) {
    if(access==null) return
    ClinicalCard(Modifier.testTag("colleague_access")) {
        Text(stringResource(R.string.colleagues_access_title),style=MaterialTheme.typography.titleMedium,modifier=Modifier.semantics {heading()})
        when {
            !access.sharing -> Text(stringResource(R.string.colleagues_access_off),style=MaterialTheme.typography.bodyMedium)
            access.colleagues.isEmpty() -> Text(stringResource(R.string.colleagues_access_none),style=MaterialTheme.typography.bodyMedium)
            else -> access.colleagues.forEach {viewer ->
                Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                    PersonAvatar(viewer.photo,viewer.name,32.dp,decorative=true)
                    Column(Modifier.weight(1f)) {
                        Text(viewer.name,style=MaterialTheme.typography.titleSmall)
                        Text(viewer.lastViewedAt?.let {stringResource(R.string.colleagues_last_viewed,displayDate(it.take(10)))} ?: stringResource(R.string.colleagues_never_viewed),
                            style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

/** The patient's own choice (#173): off until they turn it on, and turning it off ends every colleague's access at once. */
@Composable fun ColleagueSharingCard(granted:Boolean?,change:(Boolean)->Unit) {
    ClinicalCard(Modifier.testTag("colleague_sharing")) {
        Text(stringResource(R.string.colleagues_sharing_title),style=MaterialTheme.typography.titleLarge,modifier=Modifier.semantics {heading()})
        Text(stringResource(R.string.colleagues_sharing_detail),style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
        listOf(R.string.colleagues_sharing_point1,R.string.colleagues_sharing_point2,R.string.colleagues_sharing_point3).forEach {Text("• "+stringResource(it),style=MaterialTheme.typography.bodyMedium)}
        if(granted==null) LoadingNotice(R.string.ui_loading_workspace)
        else {
            Row(Modifier.fillMaxWidth().heightIn(min=56.dp).toggleable(granted,role=Role.Switch,onValueChange=change),
                verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                Text(stringResource(R.string.colleagues_sharing_switch),Modifier.weight(1f),style=MaterialTheme.typography.titleSmall)
                Switch(granted,null)
            }
            Text(stringResource(if(granted) R.string.colleagues_sharing_on else R.string.colleagues_sharing_off),style=MaterialTheme.typography.bodySmall,
                color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** Shown when a colleague's patient cannot be opened: the link ended, or the patient stopped sharing. */
@Composable fun ColleagueUnavailable() = EmptyState(R.string.colleagues_unavailable_title,R.string.colleagues_unavailable_detail)
