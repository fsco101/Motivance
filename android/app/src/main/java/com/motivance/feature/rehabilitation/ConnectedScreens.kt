package com.motivance.feature.rehabilitation

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.motivance.R
import com.motivance.data.local.CachedPrescription
import com.motivance.data.local.ExerciseJson
import com.motivance.designsystem.*
import com.motivance.domain.*
import com.motivance.feature.auth.ProfileAvatar
import java.text.DateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID
import kotlin.math.cos
import kotlin.math.sin

internal fun RehabAction.loadingLabel()=when(this) {
    RehabAction.REFRESH -> R.string.ui_loading_workspace
    RehabAction.INVITE -> R.string.ui_creating_invitation
    RehabAction.ACCEPT -> R.string.ui_connecting_therapist
    RehabAction.REVOKE -> R.string.ui_revoking_access
    RehabAction.PRESCRIBE -> R.string.ui_publishing_prescription
    RehabAction.CREATE_EXERCISE -> R.string.custom_exercise_saving
    RehabAction.ARCHIVE_EXERCISE -> R.string.custom_exercise_removing
    RehabAction.SYNC -> R.string.ui_preparing_sync
    RehabAction.WITHDRAW -> R.string.ui_withdrawing_consent
    RehabAction.EXPORT, RehabAction.DELETE -> R.string.ui_submitting_request
}

/** Workspace status notices plus a compact refresh action, so the page content stays the visual focus. */
/** [showRefresh] is off on pages where pull-to-refresh is the only refresh people need. */
@Composable fun ConnectedStatus(state:RehabilitationState,showRefresh:Boolean=true,refresh:()->Unit) {
    when {
        state.busy -> LoadingNotice(state.activeAction?.loadingLabel() ?: R.string.ui_loading_workspace)
        state.failed -> FeedbackNotice(R.string.connected_failed,error=true,retry=refresh)
    }
    if(!state.failed && showRefresh) Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End) {
        TextButton(refresh,enabled=!state.busy,modifier=Modifier.heightIn(min=48.dp)) {
            Icon(Icons.Default.Refresh,null,Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text(stringResource(R.string.refresh_connected))
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Therapist: patient list
// ---------------------------------------------------------------------------------------------

@Composable fun ColumnScope.PatientManagement(state:RehabilitationState,vm:RehabilitationViewModel,open:(String)->Unit) {
    var email by rememberSaveable {mutableStateOf("")}
    var revoke by remember {mutableStateOf<LinkedPatient?>(null)}
    var inviting by rememberSaveable {mutableStateOf(false)}
    ClinicalCard {
        val toggle=stringResource(if(inviting) R.string.ui_collapse else R.string.ui_expand)
        val turn by animateFloatAsState(if(inviting) 180f else 0f,label="chevron")
        Row(Modifier.fillMaxWidth().clickable(enabled=!state.busy,onClickLabel=toggle,role=Role.Button) {inviting=!inviting},
            verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(14.dp)) {
            IconBadge(Icons.Default.Email)
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.invite_patient),style=MaterialTheme.typography.titleMedium)
                Text(stringResource(R.string.ui_invite_summary),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Icon(Icons.Default.KeyboardArrowDown,null,Modifier.rotate(turn),tint=MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Collapsible(inviting) {
            Text(stringResource(R.string.invitation_help),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedTextField(email,{email=it},label={Text(stringResource(R.string.email))},singleLine=true,enabled=!state.busy,
                leadingIcon={Icon(Icons.Default.Email,null)},shape=MaterialTheme.shapes.small,
                modifier=Modifier.fillMaxWidth(),keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Email))
            ActionButton(R.string.create_invitation,{vm.invite(email)},enabled=!state.busy && email.isNotBlank(),busy=state.activeAction==RehabAction.INVITE,busyLabel=R.string.ui_creating_invitation)
            state.invitation?.let {code -> InvitationCode(code)}
        }
    }
    val patients=state.workspace.patients.filter {it.id!=state.owner}
    SectionHeading(R.string.nav_patients) {if(patients.isNotEmpty()) StatusPill(patients.size.toString(),PillTone.PRIMARY)}
    if(patients.isEmpty() && !state.busy && !state.failed) EmptyState(R.string.no_patients,R.string.no_patients_detail)
    if(patients.isNotEmpty()) PatientList(patients,state.workspace.prescriptions,!state.busy,open) {revoke=it}
    revoke?.let {patient -> AlertDialog(onDismissRequest={revoke=null},icon={Icon(Icons.Default.Warning,null)},
        title={Text(stringResource(R.string.revoke_patient_access))},text={Text(stringResource(R.string.revoke_confirmation))},
        confirmButton={TextButton({vm.revoke(patient.id); revoke=null},colors=ButtonDefaults.textButtonColors(contentColor=MaterialTheme.colorScheme.error)) {Text(stringResource(R.string.confirm_action))}},
        dismissButton={TextButton({revoke=null}) {Text(stringResource(R.string.cancel_action))}}) }
}

/** The one-time code, large enough to read aloud, with a copy action that confirms itself in place. */
@Composable private fun InvitationCode(code:String) {
    @Suppress("DEPRECATION") val clipboard=LocalClipboardManager.current
    val haptics=rememberHaptics()
    val toaster=LocalToaster.current
    var copied by remember(code) {mutableStateOf(false)}
    LaunchedEffect(copied) {if(copied) {kotlinx.coroutines.delay(2400); copied=false}}
    Surface(color=MaterialTheme.colorScheme.primaryContainer.copy(alpha=.55f),shape=MaterialTheme.shapes.medium) {
        Column(Modifier.fillMaxWidth().padding(16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
            Text(stringResource(R.string.invitation_share),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onPrimaryContainer)
            SelectionContainer {Text(code,style=MaterialTheme.typography.headlineMedium,color=MaterialTheme.colorScheme.onPrimaryContainer)}
            FilledTonalButton({clipboard.setText(AnnotatedString(code)); haptics.confirm(); copied=true; toaster.show(R.string.code_copied)},Modifier.heightIn(min=48.dp)) {
                AnimatedContent(copied,label="copied") {done ->
                    Row(verticalAlignment=Alignment.CenterVertically) {
                        Icon(if(done) Icons.Default.Check else Icons.Default.Share,null,Modifier.size(18.dp)); Spacer(Modifier.width(8.dp))
                        Text(stringResource(if(done) R.string.code_copied else R.string.copy_code),modifier=Modifier.semantics {liveRegion=LiveRegionMode.Polite})
                    }
                }
            }
        }
    }
}

/**
 * Linked patients as one grouped list: each row opens the patient's record. [revoke] adds an overflow menu
 * for the destructive action so it is never one accidental tap away.
 */
@Composable fun PatientList(patients:List<LinkedPatient>,prescriptions:List<PrescriptionSummary>,enabled:Boolean,open:(String)->Unit,
    revoke:((LinkedPatient)->Unit)?=null) {
    Surface(Modifier.fillMaxWidth(),color=MaterialTheme.colorScheme.surface,shape=MaterialTheme.shapes.large,
        border=androidx.compose.foundation.BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant)) {
        Column {
            patients.forEachIndexed {index,patient ->
                if(index>0) HorizontalDivider(Modifier.padding(start=84.dp),color=MaterialTheme.colorScheme.outlineVariant)
                PatientRow(patient,prescriptions.count {it.patientId==patient.id},enabled,{open(patient.id)},revoke?.let {{it(patient)}})
            }
        }
    }
}

@Composable private fun PatientRow(patient:LinkedPatient,plans:Int,enabled:Boolean,open:()->Unit,revoke:(()->Unit)?) {
    var menu by remember {mutableStateOf(false)}
    val name=patient.name.ifBlank {patient.id.take(8)}
    Row(Modifier.fillMaxWidth().clickable(enabled=enabled,onClickLabel=stringResource(R.string.open_patient),role=Role.Button,onClick=open)
        .padding(start=16.dp,end=4.dp,top=14.dp,bottom=14.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(14.dp)) {
        patient.profile?.let {ProfileAvatar(it,52.dp)} ?: PersonAvatar(patient.photoUrl,name,52.dp,
            container=MaterialTheme.colorScheme.secondaryContainer,content=MaterialTheme.colorScheme.onSecondaryContainer)
        Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)) {
            Text(name,style=MaterialTheme.typography.titleMedium)
            patient.profile?.let {
                Text("@"+it.username+" · "+stringResource(R.string.profile_age,it.age?.toString() ?: "--"),
                    style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
            StatusPill(stringResource(R.string.ui_plan_count,plans),if(plans>0) PillTone.POSITIVE else PillTone.NEUTRAL,Icons.AutoMirrored.Filled.List)
        }
        if(revoke!=null) Box {
            IconButton({menu=true},enabled=enabled) {Icon(Icons.Default.MoreVert,stringResource(R.string.ui_more_actions))}
            DropdownMenu(menu,{menu=false}) {
                DropdownMenuItem(text={Text(stringResource(R.string.revoke_patient_access),color=MaterialTheme.colorScheme.error)},
                    leadingIcon={Icon(Icons.Default.Delete,null,tint=MaterialTheme.colorScheme.error)},onClick={menu=false;revoke()})
            }
        } else Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight,null,Modifier.padding(end=8.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** One assigned exercise on the therapist's patient page. */
@OptIn(ExperimentalLayoutApi::class)
@Composable fun AssignedPrescriptionCard(p:PrescriptionSummary,exercise:CatalogueExercise?,enabled:Boolean,onEdit:()->Unit) {
    val focus=runCatching {org.json.JSONObject(p.parameters).optString("focus_joint","")}.getOrDefault("").takeIf {it.isNotBlank()}
        ?.let {runCatching {BodyJoint.valueOf(it)}.getOrNull()}
    ClinicalCard {
        Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(14.dp)) {
            ExerciseGlyph(exercise?.algorithm)
            Column(Modifier.weight(1f)) {
                Text(exercise?.name ?: stringResource(R.string.history_unknown_exercise),style=MaterialTheme.typography.titleMedium)
                Text(stringResource(if(p.side=="right") R.string.right_side else R.string.left_side),style=MaterialTheme.typography.bodySmall,
                    color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
            StatusPill(stringResource(R.string.ui_version_label,p.version),PillTone.PRIMARY)
        }
        FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
            StatusPill(stringResource(R.string.ui_range_value,degrees(p.low),degrees(p.high)),PillTone.POSITIVE)
            StatusPill(stringResource(R.string.ui_reps_value,p.repetitions),PillTone.POSITIVE)
            StatusPill(stringResource(R.string.ui_focus_value,stringResource(focus?.label() ?: R.string.focus_automatic)))
        }
        OutlinedButton(onEdit,enabled=enabled,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp),shape=MaterialTheme.shapes.medium) {
            Icon(Icons.Default.Edit,null,Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text(stringResource(R.string.edit_prescription))
        }
    }
}

@Composable fun PatientInvitation(state:RehabilitationState,vm:RehabilitationViewModel) {
    var code by remember {mutableStateOf("")}
    ClinicalCard {
        Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(14.dp)) {
            IconBadge(Icons.Default.Person)
            Text(stringResource(R.string.join_therapist),style=MaterialTheme.typography.titleMedium,modifier=Modifier.weight(1f))
        }
        Text(stringResource(R.string.join_therapist_help),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedTextField(code,{code=it},label={Text(stringResource(R.string.invitation_code))},singleLine=true,enabled=!state.busy,
            shape=MaterialTheme.shapes.small,modifier=Modifier.fillMaxWidth())
        ActionButton(R.string.accept_invitation,{vm.accept(code)},enabled=!state.busy && code.isNotBlank(),busy=state.activeAction==RehabAction.ACCEPT,busyLabel=R.string.ui_connecting_therapist)
    }
}

// ---------------------------------------------------------------------------------------------
// Patient: downloaded assignments
// ---------------------------------------------------------------------------------------------

@OptIn(ExperimentalLayoutApi::class)
@Composable fun ColumnScope.CachedAssignments(prescriptions:List<CachedPrescription>,unavailable:Boolean=false,loading:Boolean=false,start:(CachedPrescription)->Unit) {
    if(unavailable) FeedbackNotice(R.string.assignment_unavailable,error=true)
    if(prescriptions.isEmpty() && !loading) EmptyState(R.string.no_assignments,R.string.no_assignments_detail)
    prescriptions.forEach {p ->
        val rules=ExerciseJson.rules(p.rulesJson)
        val valid=p.expiresAt>System.currentTimeMillis()
        val side=stringResource(if(rules.side==BodySide.LEFT) R.string.left_side else R.string.right_side)
        var details by rememberSaveable(p.versionId) {mutableStateOf(false)}
        ClinicalCard(accent=if(valid) MaterialTheme.colorScheme.primary else null) {
            Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(14.dp)) {
                ExerciseGlyph(when(rules.kind) {ExerciseKind.ELBOW_FLEXION -> "elbow-flexion-v1"; ExerciseKind.SHOULDER_ABDUCTION -> "shoulder-abduction-v1"; ExerciseKind.CUSTOM -> null})
                Column(Modifier.weight(1f)) {
                    Text(rules.displayName(),style=MaterialTheme.typography.titleLarge)
                    Text(side,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if(!valid) StatusPill(stringResource(R.string.ui_expired),PillTone.ATTENTION)
            }
            // The prescribed band on the same protractor the therapist set it with.
            Column(Modifier.fillMaxWidth(),horizontalAlignment=Alignment.CenterHorizontally) {
                Column(Modifier.widthIn(max=280.dp).fillMaxWidth()) {
                    RangeArc(rules.lowDegrees,rules.highDegrees,stringResource(R.string.session_targets,rules.lowDegrees.toInt(),rules.highDegrees.toInt()))
                }
            }
            FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                StatusPill(stringResource(R.string.ui_range_value,degrees(rules.lowDegrees),degrees(rules.highDegrees)),PillTone.POSITIVE)
                StatusPill(stringResource(R.string.ui_reps_value,rules.targetRepetitions),PillTone.POSITIVE)
            }
            if(p.instructions.isNotBlank()) Text(p.instructions,style=MaterialTheme.typography.bodyLarge)
            Text(stringResource(R.string.assigned_focus,side,stringResource(rules.focusJoint.label())),style=MaterialTheme.typography.bodySmall)
            if(!valid) Text(stringResource(R.string.assignment_expired),color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.bodySmall)
            ActionButton(R.string.start_assigned_exercise,{start(p)},enabled=valid && p.instructions.isNotBlank())
            TextButton({details=!details},Modifier.heightIn(min=48.dp)) {
                Text(stringResource(if(details) R.string.hide_details else R.string.show_details))
                Icon(Icons.Default.KeyboardArrowDown,null,Modifier.rotate(animateFloatAsState(if(details) 180f else 0f,label="details").value))
            }
            Collapsible(details) {
                Text(stringResource(R.string.session_targets,rules.lowDegrees.toInt(),rules.highDegrees.toInt()),style=MaterialTheme.typography.bodySmall,
                    color=MaterialTheme.colorScheme.onSurfaceVariant)
                Text(stringResource(R.string.last_downloaded,if(p.cachedAt>0) DateFormat.getDateTimeInstance().format(Date(p.cachedAt)) else "--"),
                    style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                Text(stringResource(R.string.pinned_version,p.versionId.take(8)),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
    Text(stringResource(R.string.assignment_cache_policy),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
}

// ---------------------------------------------------------------------------------------------
// Therapist: exercise assignment editor
// ---------------------------------------------------------------------------------------------

@Composable fun ColumnScope.PrescriptionForm(state:RehabilitationState,vm:RehabilitationViewModel,patientId:String?,existing:PrescriptionSummary?=null,published:()->Unit) {
    PrescriptionEditor(state,patientId,existing,{draft,created -> vm.createExercise(draft,created)},{vm.archiveExercise(it)}) {vm.prescribe(it,published)}
}

/**
 * Exercise assignment split into numbered steps (exercise, side and focus, targets, timing) and a
 * review card that summarises exactly what the publish button will send.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun ColumnScope.PrescriptionEditor(state:RehabilitationState,patientId:String?,existing:PrescriptionSummary?=null,
    onCreateExercise:(CustomExerciseDraft,(String)->Unit)->Unit={_,_ ->},onArchiveExercise:(String)->Unit={},onPublish:(PrescriptionDraft)->Unit) {
    var patient by rememberSaveable {mutableStateOf(existing?.patientId ?: patientId.orEmpty())}
    var exercise by rememberSaveable {mutableStateOf(existing?.exerciseId ?: "")}
    var side by rememberSaveable {mutableStateOf(existing?.side ?: "left")}
    var low by rememberSaveable {mutableStateOf(existing?.low?.let(::degrees) ?: "20")}
    var high by rememberSaveable {mutableStateOf(existing?.high?.let(::degrees) ?: "90")}
    var reps by rememberSaveable {mutableStateOf(existing?.repetitions?.toString() ?: "5")}
    val parameters=remember(existing) {org.json.JSONObject(existing?.parameters ?: "{}")}
    var focusJoint by rememberSaveable {mutableStateOf(parameters.optString("focus_joint",""))}
    var minimum by rememberSaveable {mutableStateOf(parameters.optLong("minimum_cycle_ms",600).toString())}
    var maximum by rememberSaveable {mutableStateOf(parameters.optLong("maximum_cycle_ms",30000).toString())}
    var hold by rememberSaveable {mutableStateOf(parameters.optLong("peak_hold_ms",100).toString())}
    var lean by rememberSaveable {mutableStateOf(parameters.optDouble("max_trunk_lean_degrees",20.0).let(::degrees))}
    var requestId by rememberSaveable {mutableStateOf(UUID.randomUUID().toString())}
    val assignmentId=rememberSaveable {existing?.assignmentId ?: UUID.randomUUID().toString()}
    var advanced by rememberSaveable {mutableStateOf(false)}
    var addingExercise by rememberSaveable {mutableStateOf(false)}
    var removing by remember {mutableStateOf<CatalogueExercise?>(null)}
    fun changed() {requestId=UUID.randomUUID().toString()}
    val enabled=!state.busy
    val patients=state.workspace.patients.filter {it.id!=state.owner}
    val chosenPatient=patients.firstOrNull {it.id==patient}
    val chosenExercise=state.workspace.catalogue.firstOrNull {it.id==exercise}

    val l=low.toDoubleOrNull(); val h=high.toDoubleOrNull(); val r=reps.toIntOrNull(); val min=minimum.toLongOrNull(); val max=maximum.toLongOrNull(); val peak=hold.toLongOrNull(); val trunk=lean.toDoubleOrNull()
    val rangeValid=l!=null && h!=null && l.isFinite() && h.isFinite() && l>=0 && h<=180 && h>l+10
    val repsValid=r!=null && r in 1..1000
    val timingValid=min!=null && max!=null && peak!=null && trunk!=null && min in 100..30000 && max>min && max<=300000 && peak in 0..5000 && trunk.isFinite() && trunk in 0.0..90.0
    val valid=patient.isNotBlank() && exercise.isNotBlank() && rangeValid && repsValid && timingValid && runCatching {
        ExerciseRules(lowDegrees=l!!,highDegrees=h!!,targetRepetitions=r!!,minimumCycleMs=min!!,maximumCycleMs=max!!,peakHoldMs=peak!!,maxTrunkLeanDegrees=trunk!!)
    }.isSuccess

    // Who and which version this assignment applies to.
    AssignmentContext(chosenPatient?.name?.ifBlank {null} ?: patient.take(8).ifBlank {null},chosenPatient?.profile,existing)
    if(existing==null && patientId==null) ClinicalCard {
        Choice(R.string.select_patient,patients.map {it.id to it.name.ifBlank {it.id.take(8)}},patient,enabled) {patient=it; changed()}
    }

    StepCard(1,R.string.select_exercise,R.string.ui_step_exercise_help,complete=chosenExercise!=null) {
        val choices=state.workspace.catalogue.filter {it.selectable}
        if(choices.isEmpty()) Text(stringResource(R.string.ui_no_catalogue),style=MaterialTheme.typography.bodyMedium,
            color=MaterialTheme.colorScheme.onSurfaceVariant)
        Column(Modifier.selectableGroup(),verticalArrangement=Arrangement.spacedBy(10.dp)) {
            choices.forEach {item ->
                val measures=item.joint?.let {stringResource(R.string.custom_exercise_measures,stringResource(it.label()))}
                SelectionTile(exercise==item.id,{exercise=item.id; changed()},item.name,Modifier.fillMaxWidth(),
                    description=listOfNotNull(measures,item.instructions.ifBlank {null}).joinToString("\n").ifBlank {null},enabled=enabled,leading={ExerciseGlyph(item.algorithm)})
                if(item.custom) TextButton({removing=item},enabled=enabled,modifier=Modifier.heightIn(min=48.dp)) {Text(stringResource(R.string.custom_exercise_remove))}
            }
        }
        if(addingExercise) CustomExerciseForm(enabled,state.activeAction==RehabAction.CREATE_EXERCISE,{addingExercise=false}) {draft ->
            onCreateExercise(draft) {version -> exercise=version; addingExercise=false; changed()}
        } else OutlinedButton({addingExercise=true},Modifier.fillMaxWidth().heightIn(min=48.dp),enabled=enabled,shape=MaterialTheme.shapes.medium) {
            Icon(Icons.Default.Add,null,Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text(stringResource(R.string.custom_exercise_add))
        }
    }
    removing?.let {item ->
        AlertDialog(onDismissRequest={removing=null},title={Text(stringResource(R.string.custom_exercise_remove_title,item.name))},
            text={Text(stringResource(R.string.custom_exercise_remove_detail))},
            confirmButton={TextButton({
                if(exercise==item.id) {exercise=""; changed()}
                removing=null; onArchiveExercise(item.exerciseId)
            }) {Text(stringResource(R.string.custom_exercise_remove))}},
            dismissButton={TextButton({removing=null}) {Text(stringResource(R.string.custom_exercise_keep))}})
    }

    StepCard(2,R.string.ui_step_side,R.string.ui_step_side_help,complete=true) {
        Row(Modifier.fillMaxWidth().selectableGroup(),horizontalArrangement=Arrangement.spacedBy(10.dp)) {
            listOf("left" to R.string.left_side,"right" to R.string.right_side).forEach {(value,label) ->
                SelectionTile(side==value,{side=value; changed()},stringResource(label),Modifier.weight(1f),enabled=enabled)
            }
        }
        Text(stringResource(R.string.prescription_focus),style=MaterialTheme.typography.labelLarge,modifier=Modifier.padding(top=4.dp))
        FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp),verticalArrangement=Arrangement.spacedBy(4.dp)) {
            (listOf("" to R.string.focus_automatic)+BodyJoint.entries.map {it.name to it.label()}).forEach {(value,label) ->
                val selected=focusJoint==value
                FilterChip(selected,{focusJoint=value; changed()},enabled=enabled,label={Text(stringResource(label))},
                    leadingIcon=if(selected) {{Icon(Icons.Default.Check,null,Modifier.size(18.dp))}} else null)
            }
        }
        Text(stringResource(R.string.prescription_focus_help),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    }

    StepCard(3,R.string.ui_step_targets,R.string.ui_step_targets_help,complete=rangeValid && repsValid) {
        chosenExercise?.joint?.let {Text(stringResource(it.zeroHint()),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
        val arcDescription=stringResource(R.string.ui_range_preview,low.ifBlank {"--"},high.ifBlank {"--"})
        Column(Modifier.fillMaxWidth(),horizontalAlignment=Alignment.CenterHorizontally) {
            Column(Modifier.widthIn(max=340.dp).fillMaxWidth()) {
                RangeArc(l.takeIf {rangeValid},h.takeIf {rangeValid},arcDescription,onChange=if(enabled) {{a,b -> low=degrees(a); high=degrees(b); changed()}} else null)
                Row(Modifier.fillMaxWidth().clearAndSetSemantics {},verticalAlignment=Alignment.CenterVertically) {
                    Text("0°",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(if(rangeValid) stringResource(R.string.ui_range_value,degrees(l!!),degrees(h!!)) else "--",Modifier.weight(1f),
                        style=MaterialTheme.typography.headlineMedium,color=MaterialTheme.colorScheme.onSurface,textAlign=TextAlign.Center)
                    Text("180°",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        Text(stringResource(R.string.range_drag_help),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(12.dp)) {
            NumberField(R.string.ui_return_angle,low,"°",!rangeValid,enabled,Modifier.weight(1f)) {low=it; changed()}
            NumberField(R.string.ui_reach_angle,high,"°",!rangeValid,enabled,Modifier.weight(1f)) {high=it; changed()}
        }
        Text(stringResource(if(rangeValid) R.string.ui_range_help else R.string.ui_range_error),style=MaterialTheme.typography.bodySmall,
            color=if(rangeValid) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error)
        RepetitionStepper(reps,repsValid,enabled) {reps=it; changed()}
        if(!repsValid) Text(stringResource(R.string.ui_reps_error),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.error)
    }

    ClinicalCard {
        val toggle=stringResource(if(advanced) R.string.ui_hide_timing else R.string.ui_show_timing)
        val turn by animateFloatAsState(if(advanced) 180f else 0f,label="timing")
        Row(Modifier.fillMaxWidth().clickable(onClickLabel=toggle,role=Role.Button) {advanced=!advanced},
            verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
            IconBadge(Icons.Default.Settings,MaterialTheme.colorScheme.primary,40)
            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(2.dp)) {
                Text(stringResource(R.string.ui_timing_title),style=MaterialTheme.typography.titleMedium)
                Text(stringResource(R.string.ui_timing_summary,minimum.ifBlank {"--"},maximum.ifBlank {"--"},hold.ifBlank {"--"},lean.ifBlank {"--"}),
                    style=MaterialTheme.typography.bodySmall,color=if(timingValid) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error)
            }
            Icon(Icons.Default.KeyboardArrowDown,null,Modifier.rotate(turn),tint=MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Collapsible(advanced) {
            NumberField(R.string.minimum_cycle_ms,minimum,"ms",min==null || min !in 100..30000,enabled,Modifier.fillMaxWidth(),KeyboardType.Number) {minimum=it; changed()}
            NumberField(R.string.maximum_cycle_ms,maximum,"ms",max==null || min==null || max<=min || max>300000,enabled,Modifier.fillMaxWidth(),KeyboardType.Number) {maximum=it; changed()}
            NumberField(R.string.peak_hold_ms,hold,"ms",peak==null || peak !in 0..5000,enabled,Modifier.fillMaxWidth(),KeyboardType.Number) {hold=it; changed()}
            NumberField(R.string.maximum_trunk_lean,lean,"°",trunk==null || trunk !in 0.0..90.0,enabled,Modifier.fillMaxWidth()) {lean=it; changed()}
        }
        if(!timingValid) Text(stringResource(R.string.ui_timing_error),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.error)
    }

    ClinicalCard(accent=MaterialTheme.colorScheme.secondary) {
        Text(stringResource(R.string.ui_review_title),style=MaterialTheme.typography.titleLarge,modifier=Modifier.semantics {heading()})
        val sideText=stringResource(if(side=="right") R.string.right_side else R.string.left_side)
        val focusText=stringResource(focusJoint.takeIf {it.isNotBlank()}?.let {BodyJoint.valueOf(it).label()} ?: R.string.focus_automatic)
        DetailRow(stringResource(R.string.ui_review_patient),chosenPatient?.name?.ifBlank {null} ?: patient.take(8).ifBlank {"—"})
        DetailRow(stringResource(R.string.ui_review_exercise),chosenExercise?.name ?: "—")
        DetailRow(stringResource(R.string.ui_review_side),"$sideText · $focusText")
        DetailRow(stringResource(R.string.ui_review_targets),
            if(rangeValid && repsValid) stringResource(R.string.ui_review_targets_value,degrees(l!!),degrees(h!!),r!!) else "—")
        Surface(color=MaterialTheme.colorScheme.surfaceContainerLow,shape=MaterialTheme.shapes.small) {
            Row(Modifier.fillMaxWidth().padding(12.dp),horizontalArrangement=Arrangement.spacedBy(10.dp)) {
                Icon(Icons.Default.Info,null,Modifier.size(18.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant)
                Text(if(existing!=null) stringResource(R.string.ui_assign_next_version,existing.version+1) else stringResource(R.string.prescription_version_help),
                    style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if(!valid) Text(stringResource(R.string.ui_review_incomplete),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.error)
        ActionButton(R.string.publish_prescription,{onPublish(PrescriptionDraft(assignmentId,requestId,patient,exercise,BodySide.valueOf(side.uppercase()),l!!,h!!,r!!,min!!,max!!,peak!!,trunk!!,parameters.optDouble("confidence",.7),focusJoint.takeIf {it.isNotBlank()}?.let {BodyJoint.valueOf(it)}))},enabled=valid && !state.busy,busy=state.activeAction==RehabAction.PRESCRIBE,busyLabel=R.string.ui_publishing_prescription)
        if(state.failed && !state.busy) FeedbackNotice(R.string.connected_failed,error=true)
    }
}

@Composable private fun AssignmentContext(name:String?,profile:PatientProfile?,existing:PrescriptionSummary?) {
    Surface(Modifier.fillMaxWidth(),shape=MaterialTheme.shapes.extraLarge,color=Motion.Ink,contentColor=Color.White) {
        Row(Modifier.padding(20.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(14.dp)) {
            if(profile!=null) ProfileAvatar(profile) else IconBadge(Icons.Default.Person,MaterialTheme.colorScheme.secondaryContainer,52)
            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)) {
                Text(stringResource(R.string.assigned_patient),style=MaterialTheme.typography.labelMedium,color=Motion.NightInk)
                Text(name ?: "—",style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.SemiBold)
                profile?.let {Text("@"+it.username,style=MaterialTheme.typography.bodySmall,color=Motion.NightInk)}
            }
            Surface(shape=RoundedCornerShape(50),color=Motion.SproutBright,contentColor=Motion.Ink) {
                Text(if(existing!=null) stringResource(R.string.ui_assign_editing,existing.version) else stringResource(R.string.ui_assign_new),
                    Modifier.padding(horizontal=12.dp,vertical=6.dp),style=MaterialTheme.typography.labelMedium,fontWeight=FontWeight.SemiBold)
            }
        }
    }
}

@Composable private fun NumberField(label:Int,value:String,suffix:String,error:Boolean,enabled:Boolean,modifier:Modifier,
    type:KeyboardType=KeyboardType.Decimal,set:(String)->Unit) {
    OutlinedTextField(value,{set(it.filter {c -> c.isDigit() || c=='.'})},modifier,enabled=enabled,label={Text(stringResource(label))},
        suffix={Text(suffix)},isError=error,singleLine=true,shape=MaterialTheme.shapes.small,
        keyboardOptions=KeyboardOptions(keyboardType=type))
}

@Composable private fun RepetitionStepper(reps:String,valid:Boolean,enabled:Boolean,set:(String)->Unit) {
    val current=reps.toIntOrNull()
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)) {
        val decrease=stringResource(R.string.ui_decrease)
        FilledTonalIconButton({set(((current ?: 2)-1).coerceIn(1,1000).toString())},enabled=enabled && (current ?: 0)>1,
            modifier=Modifier.size(52.dp).semantics {contentDescription=decrease}) {Text("−",style=MaterialTheme.typography.titleLarge)}
        OutlinedTextField(reps,{set(it.filter(Char::isDigit).take(4))},Modifier.weight(1f),enabled=enabled,
            label={Text(stringResource(R.string.target_repetitions))},isError=!valid,singleLine=true,shape=MaterialTheme.shapes.small,
            textStyle=MaterialTheme.typography.titleMedium.copy(textAlign=TextAlign.Center),
            keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Number))
        FilledTonalIconButton({set(((current ?: 0)+1).coerceIn(1,1000).toString())},enabled=enabled && (current ?: 0)<1000,
            modifier=Modifier.size(52.dp)) {Icon(Icons.Default.Add,stringResource(R.string.ui_increase))}
    }
}

/** Small drawn limb-angle icon: upper segment plus a moving segment at the exercise's typical angle. */
@Composable internal fun ExerciseGlyph(algorithm:String?) {
    val tint=MaterialTheme.colorScheme.primary
    val open=when {algorithm?.startsWith("shoulder")==true -> 90f; algorithm?.startsWith("elbow")==true -> 45f; else -> 65f}
    Surface(color=tint.copy(alpha=.1f),shape=RoundedCornerShape(14.dp),modifier=Modifier.size(44.dp)) {
        Canvas(Modifier.padding(9.dp).fillMaxSize()) {
            val joint=Offset(size.width*.32f,size.height*.78f)
            val length=size.height*.66f
            val radians=Math.toRadians((-90.0+open))
            val end=Offset(joint.x+length*cos(radians).toFloat(),joint.y+length*sin(radians).toFloat())
            drawArc(tint.copy(alpha=.45f),-90f,open,false,Offset(joint.x-length*.42f,joint.y-length*.42f),Size(length*.84f,length*.84f),style=Stroke(2.dp.toPx()))
            drawLine(tint,joint,Offset(joint.x,joint.y-length),3.dp.toPx(),StrokeCap.Round)
            drawLine(tint,joint,end,3.dp.toPx(),StrokeCap.Round)
            drawCircle(tint,3.5.dp.toPx(),joint)
        }
    }
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

private fun degrees(value:Double):String=if(value==Math.floor(value) && !value.isInfinite()) value.toLong().toString() else String.format(Locale.US,"%.1f",value)

// ---------------------------------------------------------------------------------------------
// Sync and privacy
// ---------------------------------------------------------------------------------------------

@Composable fun ColumnScope.SyncAndPrivacy(state:RehabilitationState,vm:RehabilitationViewModel,patient:Boolean,onWithdraw:()->Unit) {
    ClinicalCard {
        Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(14.dp)) {
            IconBadge(Icons.Default.Refresh)
            Text(stringResource(R.string.synchronization),style=MaterialTheme.typography.titleLarge,modifier=Modifier.weight(1f))
        }
        if(state.outbox.isEmpty()) Text(stringResource(R.string.ui_no_pending_uploads),color=MaterialTheme.colorScheme.onSurfaceVariant)
        state.outbox.forEach {item -> Text(stringResource(R.string.sync_item,item.sessionId.take(8),syncLabel(item.state)),style=MaterialTheme.typography.bodySmall,
            color=MaterialTheme.colorScheme.onSurfaceVariant) }
        ActionButton(R.string.sync_now,{vm.synchronize()},enabled=!state.busy,busy=state.activeAction==RehabAction.SYNC,busyLabel=R.string.ui_preparing_sync)
    }
    if(patient) ClinicalCard {
        Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(14.dp)) {
            IconBadge(Icons.Default.Lock,MaterialTheme.colorScheme.primary)
            Text(stringResource(R.string.ui_privacy_title),style=MaterialTheme.typography.titleLarge,modifier=Modifier.weight(1f))
        }
        Text(stringResource(R.string.consent_policy),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        state.consents.firstOrNull()?.let {
            Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                StatusPill(stringResource(if(it.event=="granted") R.string.consent_granted else R.string.consent_withdrawn),if(it.event=="granted") PillTone.POSITIVE else PillTone.NEUTRAL)
                StatusPill(syncLabel(it.state))
            }
        }
        ActionButton(R.string.withdraw_consent,onWithdraw,outlined=true,enabled=!state.busy,busy=state.activeAction==RehabAction.WITHDRAW,busyLabel=R.string.ui_withdrawing_consent)
        HorizontalDivider(color=MaterialTheme.colorScheme.outlineVariant)
        Text(stringResource(R.string.privacy_request_help),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        ActionButton(R.string.request_export,{vm.request("export")},outlined=true,enabled=!state.busy,busy=state.activeAction==RehabAction.EXPORT,busyLabel=R.string.ui_submitting_request)
        ActionButton(R.string.request_deletion,{vm.request("delete")},outlined=true,enabled=!state.busy,busy=state.activeAction==RehabAction.DELETE,busyLabel=R.string.ui_submitting_request)
        state.workspace.requests.forEach {Text(stringResource(if(it.kind=="export") R.string.request_export else R.string.request_deletion)+": "+stringResource(when(it.status) {"fulfilled"->R.string.request_fulfilled; "declined"->R.string.request_declined; else->R.string.request_pending}),style=MaterialTheme.typography.bodySmall)}
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
