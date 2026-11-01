package com.motivance.navigation

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.motivance.R
import com.motivance.domain.UserRole
import com.motivance.domain.WorkspaceOverview
import com.motivance.feature.auth.*
import com.motivance.feature.exercise.CameraPrototype
import com.motivance.feature.exercise.ExerciseSessionViewModel
import com.motivance.data.local.ExerciseJson
import androidx.lifecycle.viewmodel.compose.viewModel
import com.motivance.feature.rehabilitation.*
import com.motivance.feature.admin.*
import com.motivance.designsystem.*
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.ui.graphics.Brush

private val Navy=Color(0xFF002042)
private val Teal=Color(0xFF006A61)

@Composable fun MotivanceApp(vm: AuthViewModel) {
    val auth by vm.state.collectAsStateWithLifecycle()
    val overview by vm.overview.collectAsStateWithLifecycle()
    val exercise:ExerciseSessionViewModel=viewModel()
    val local by exercise.state.collectAsStateWithLifecycle()
    val profile:PatientProfileViewModel=viewModel()
    val rehabilitation:RehabilitationViewModel=viewModel()
    val connected by rehabilitation.state.collectAsStateWithLifecycle()
    val history:HistoryViewModel=viewModel()
    val administration:AdministrationViewModel=viewModel()
    LaunchedEffect(auth.session?.userId,auth.session?.roles) {administration.configure(auth.session?.takeIf {UserRole.ADMIN in it.roles}?.userId)}
    LaunchedEffect(Unit) {vm.restore()}
    LaunchedEffect(auth.session?.userId) {
        profile.configure(auth.session?.userId)
        exercise.configure(auth.session?.userId ?: "local-demo")
        rehabilitation.configure(auth.session?.userId)
        history.configure(auth.session?.userId)
    }
    var route by rememberSaveable { mutableStateOf("LANDING") }
    var selectedRole by rememberSaveable { mutableStateOf<String?>(null) }
    var selectedPatient by rememberSaveable {mutableStateOf<String?>(null)}
    var editingAssignment by rememberSaveable {mutableStateOf<String?>(null)}
    val role=selectedRole?.let { UserRole.valueOf(it) }
    LaunchedEffect(auth.session?.userId) {
        selectedPatient=null; editingAssignment=null
        if(auth.session!=null) { route="HOME"; vm.loadOverview() }
        else if(route !in setOf("LANDING","AUTH","SETUP","CAMERA","CHECK_COMPLETE")) route="AUTH"
    }
    if(auth.restoring) { AuthLoadingScreen(); return }
    fun goBack() { route=parentRoute(route,auth.session!=null) }
    BackHandler(enabled=route!="LANDING" && route!="HOME") { goBack() }
    if(route=="CAMERA") { CameraPrototype(ownerId=auth.session?.userId ?: "local-demo") { route="CHECK_COMPLETE" }; return }
    if(route=="AUTH" && auth.session==null) {
        AuthScreen(vm,{route="SETUP"},role) { route="LANDING" }; return
    }
    if(auth.session==null && route=="LANDING") {
        RoleLanding({selectedRole=it.name; route="AUTH"},{route="SETUP"}); return
    }
    val actualRole=role ?: auth.session?.roles?.firstOrNull() ?: UserRole.PATIENT
    if(auth.session!=null && actualRole !in auth.session!!.roles) {
        Column(Modifier.fillMaxSize().padding(24.dp),verticalArrangement=Arrangement.spacedBy(20.dp)) {
            BrandHeader()
            Text(stringResource(R.string.role_not_authorized))
            auth.session!!.roles.forEach { allowed -> Button({selectedRole=allowed.name; route="HOME"}) { Text(stringResource(allowed.title())) } }
            TextButton({vm.act(AuthAction.SIGN_OUT); route="AUTH"}) { Text(stringResource(R.string.sign_out)) }
        }; return
    }
    val rootRoutes=setOf("HOME","PATIENTS","EXERCISES","PROGRESS","PROFILE","ADMIN")
    val activeTab=when(route) {
        "PATIENT_DETAIL","ASSIGN" -> "PATIENTS"
        "LOCAL_HISTORY" -> "PROFILE"
        else -> route
    }
    Scaffold(
        containerColor=MaterialTheme.colorScheme.background,
        topBar={BrandHeader(onProfile=if(auth.session!=null) ({route="PROFILE"}) else null,
            onBack=if(route !in rootRoutes) ({goBack()}) else null)},
        bottomBar={if(auth.session!=null) NavigationBar(containerColor=Color.White,tonalElevation=0.dp,windowInsets=WindowInsets(0,0,0,0)) {
            val destinations=when(actualRole) {
                UserRole.ADMIN -> listOf(Triple("HOME",R.string.nav_home,Icons.Default.Home),Triple("ADMIN",R.string.role_admin,Icons.Default.Settings),Triple("PROFILE",R.string.nav_profile,Icons.Default.AccountCircle))
                UserRole.THERAPIST -> listOf(Triple("HOME",R.string.nav_home,Icons.Default.Home),Triple("PATIENTS",R.string.nav_patients,Icons.Default.Person),Triple("PROGRESS",R.string.nav_progress,Icons.Default.DateRange),Triple("PROFILE",R.string.nav_profile,Icons.Default.AccountCircle))
                else -> listOf(Triple("HOME",R.string.nav_home,Icons.Default.Home),Triple("EXERCISES",R.string.nav_exercises,Icons.Default.PlayArrow),Triple("PROGRESS",R.string.nav_progress,Icons.Default.DateRange),Triple("PROFILE",R.string.nav_profile,Icons.Default.AccountCircle))
            }
            destinations.forEach { (page,label,icon) -> NavigationBarItem(selected=activeTab==page,onClick={route=page},icon={Icon(icon,null)},
                colors=NavigationBarItemDefaults.colors(indicatorColor=MaterialTheme.colorScheme.secondaryContainer.copy(alpha=.5f),selectedIconColor=Teal,selectedTextColor=Teal),label={Text(stringResource(label))}) }
        }}
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding),contentAlignment=Alignment.TopCenter) {
        key(route,selectedPatient) {
        Column(Modifier.widthIn(max=720.dp).fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(20.dp),verticalArrangement=Arrangement.spacedBy(20.dp)) {
            when(route) {
                "SETUP" -> CameraSetup { route="CAMERA" }
                "CHECK_COMPLETE" -> {
                    SectionTitle(R.string.camera_check_complete,if(local.saved) R.string.session_saved_local else R.string.camera_preview_only)
                    ClinicalCard {
                        Icon(Icons.Default.CheckCircle,null,tint=Teal,modifier=Modifier.size(48.dp))
                        Text(stringResource(R.string.camera_check_complete),style=MaterialTheme.typography.headlineSmall)
                        Text(stringResource(if(local.saved) R.string.session_saved_local else R.string.no_clinical_record))
                        if(local.saved) {
                            Text(stringResource(R.string.completed_reps,local.metrics.completed,local.rules.targetRepetitions))
                            Text(stringResource(R.string.session_metrics,local.metrics.romDegrees?.let {"%.1f".format(it)} ?: "--",local.metrics.incomplete,local.metrics.durationMs/1000))
                            connected.outbox.firstOrNull {it.sessionId==local.id}?.let {Text(syncLabel(it.state))}
                        }
                    }
                    PrimaryAction(R.string.try_camera_again) { route="SETUP" }
                    OutlinedButton({route="LOCAL_HISTORY"}) {Text(stringResource(R.string.local_history))}
                    TextButton({route=if(auth.session!=null) "HOME" else "LANDING"}) { Text(stringResource(R.string.back)) }
                }
                "PROFILE" -> {
                    SectionTitle(R.string.nav_profile,R.string.account_and_access)
                    PatientProfileEditor(profile) {vm.loadOverview();rehabilitation.refresh()}
                    LanguagePicker()
                    auth.session?.roles?.filter {it!=actualRole}?.forEach {allowed -> OutlinedButton({selectedRole=allowed.name;route="HOME"}) {Text(stringResource(allowed.title()))}}
                    if(actualRole==UserRole.ADMIN) PrimaryAction(R.string.admin_title) {route="ADMIN"}
                    ClinicalCard {
                        Text(overview.data?.displayName?.takeIf { it.isNotBlank() } ?: stringResource(R.string.your_account),style=MaterialTheme.typography.headlineSmall)
                        Text(stringResource(actualRole.title()),color=Teal)
                        Text(stringResource(R.string.memory_session_notice))
                        OutlinedButton({route="LOCAL_HISTORY"}) {Text(stringResource(R.string.local_history))}
                        ActionButton(R.string.refresh_session,{vm.act(AuthAction.REFRESH)},outlined=true,enabled=!auth.busy,busy=auth.activeAction==AuthAction.REFRESH,busyLabel=R.string.ui_refreshing_session)
                        ActionButton(R.string.sign_out,{vm.act(AuthAction.SIGN_OUT)},outlined=true,enabled=!auth.busy,busy=auth.activeAction==AuthAction.SIGN_OUT,busyLabel=R.string.ui_signing_out)
                    }
                    ConnectedStatus(connected) {rehabilitation.refresh(); vm.loadOverview()}
                    SyncAndPrivacy(connected,rehabilitation,actualRole==UserRole.PATIENT) {exercise.newSession(); rehabilitation.withdraw()}
                }
                "LOCAL_HISTORY" -> {
                    SectionTitle(R.string.local_history,R.string.local_history_detail)
                    if(local.history.isEmpty()) EmptyCard(R.string.no_sessions,R.string.no_sessions_detail)
                    local.history.forEach { row -> ClinicalCard {
                        val metrics=ExerciseJson.snapshot(row.snapshotJson)
                        val rules=ExerciseJson.rules(row.rulesJson)
                        Text(stringResource(if(rules.kind==com.motivance.domain.ExerciseKind.ELBOW_FLEXION) R.string.elbow_flexion else R.string.shoulder_abduction),style=MaterialTheme.typography.titleMedium)
                        Text(stringResource(if(row.status=="COMPLETED") R.string.completed_session else R.string.interrupted_session))
                        Text(stringResource(R.string.completed_reps,metrics.completed,rules.targetRepetitions))
                        Text(stringResource(R.string.session_metrics,metrics.romDegrees?.let {"%.1f".format(it)} ?: "--",metrics.incomplete,metrics.durationMs/1000))
                        Text(stringResource(if(rules.demo) R.string.demo_assessment_notice else R.string.prescribed_assessment_notice),style=MaterialTheme.typography.bodySmall)
                        connected.outbox.firstOrNull {it.sessionId==row.id}?.let {Text(syncLabel(it.state))}
                    } }
                }
                "ADMIN" -> if(actualRole==UserRole.ADMIN) AdministrationScreen(administration)
                "PATIENTS" -> {
                    SectionTitle(R.string.patient_management,R.string.assigned_patients_only)
                    ConnectedStatus(connected) {rehabilitation.refresh(); vm.loadOverview()}
                    if(actualRole==UserRole.ADMIN) AdministrationScreen(administration)
                    else PatientManagement(connected,rehabilitation) {selectedPatient=it; route="PATIENT_DETAIL"}
                }
                "PATIENT_DETAIL" -> {
                    Text(connected.workspace.patients.firstOrNull {it.id==selectedPatient}?.name.orEmpty(),style=MaterialTheme.typography.headlineMedium)
                    connected.workspace.patients.firstOrNull {it.id==selectedPatient}?.profile?.let {PatientProfileSummary(it)}
                    ConnectedStatus(connected) {rehabilitation.refresh(); vm.loadOverview()}
                    PrimaryAction(R.string.assign_exercise) {editingAssignment=null; route="ASSIGN"}
                    connected.workspace.prescriptions.filter {it.patientId==selectedPatient}.forEach {p -> ClinicalCard {
                        Text(connected.workspace.catalogue.firstOrNull {it.id==p.exerciseId}?.name.orEmpty())
                        Text(stringResource(R.string.prescription_summary,p.version,p.low.toInt(),p.high.toInt(),p.repetitions))
                        OutlinedButton({editingAssignment=p.assignmentId;route="ASSIGN"}) {Text(stringResource(R.string.edit_prescription))}
                    } }
                    ResultsDashboard(connected.workspace,connected.owner,selectedPatient,history)
                }
                "ASSIGN" -> {
                    SectionTitle(R.string.exercise_assignment,R.string.professional_targets)
                    ConnectedStatus(connected) {rehabilitation.refresh(); vm.loadOverview()}
                    ClinicalCard {
                        val existing=connected.workspace.prescriptions.firstOrNull {it.assignmentId==editingAssignment}
                        key(existing?.versionId ?: "new") {PrescriptionForm(connected,rehabilitation,selectedPatient,existing)}
                    }
                }
                "EXERCISES" -> {
                    SectionTitle(R.string.your_exercises,R.string.professional_targets)
                    ConnectedStatus(connected) {rehabilitation.refresh(); vm.loadOverview()}
                    CachedAssignments(local.cached,connected.workspace.prescriptions.any {p -> local.cached.none {it.versionId==p.versionId}},loading=connected.busy || connected.failed) {exercise.newSession(); exercise.usePrescription(it); route="SETUP"}
                    PatientInvitation(connected,rehabilitation)
                    ClinicalCard {
                        Text(stringResource(R.string.camera_check),style=MaterialTheme.typography.titleLarge)
                        Text(stringResource(R.string.camera_preview_only))
                        ActionButton(R.string.prepare_camera,{route="SETUP"},outlined=true)
                    }
                }
                "PROGRESS" -> {
                    SectionTitle(R.string.recovery_progress,R.string.valid_measurements_only)
                    ConnectedStatus(connected) {rehabilitation.refresh(); history.refresh()}
                    ResultsDashboard(connected.workspace,connected.owner,if(actualRole==UserRole.PATIENT) auth.session?.userId else null,history)
                }
                else -> {
                    SectionTitle(if(actualRole==UserRole.PATIENT) R.string.your_recovery else R.string.clinical_overview,if(actualRole==UserRole.PATIENT) R.string.personal_rehabilitation else R.string.assigned_patients_only)
                    overview.data?.displayName?.takeIf {it.isNotBlank()}?.let { Text(it,style=MaterialTheme.typography.titleLarge) }
                    OverviewStatus(overview) { vm.loadOverview() }
                    WorkspaceHero(actualRole) {route=when(actualRole) {UserRole.PATIENT->"EXERCISES";UserRole.THERAPIST->"PATIENTS";else->"ADMIN"}}
                    MetricRow(if(actualRole==UserRole.PATIENT) R.string.active_assignments else R.string.total_patients,if(actualRole==UserRole.PATIENT) overview.data?.assignments?.size?.toString() ?: "—" else overview.data?.patientIds?.size?.toString() ?: "—",R.string.recent_sessions,overview.data?.sessions?.size?.toString() ?: "—")
                    ClinicalCard {
                        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween) { Text(stringResource(R.string.camera_check),style=MaterialTheme.typography.titleLarge); Icon(Icons.Default.PlayArrow,null,tint=Teal) }
                        Text(stringResource(R.string.single_camera_description))
                        ActionButton(R.string.prepare_camera,{route="SETUP"},outlined=true)
                    }
                    SessionCards(overview.data)
                }
            }
        }
        }
        }
    }
}

internal fun parentRoute(route:String,signedIn:Boolean)=when(route) {
    "AUTH" -> "LANDING"
    "CAMERA" -> "SETUP"
    "ASSIGN" -> "PATIENT_DETAIL"
    "PATIENT_DETAIL" -> "PATIENTS"
    "LOCAL_HISTORY" -> if(signedIn) "PROFILE" else "CHECK_COMPLETE"
    "SETUP" -> if(signedIn) "HOME" else "LANDING"
    else -> if(signedIn) "HOME" else "LANDING"
}

@Composable internal fun RoleLanding(onRole:(UserRole)->Unit,onCamera:()->Unit) {
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),horizontalAlignment=Alignment.CenterHorizontally) {
        BrandHeader()
        Column(Modifier.widthIn(max=640.dp).weight(1f).verticalScroll(rememberScrollState()).padding(20.dp),verticalArrangement=Arrangement.spacedBy(20.dp)) {
            Badge(R.string.markerless_rehabilitation)
            Text(stringResource(R.string.welcome_motivance),style=MaterialTheme.typography.headlineLarge,fontWeight=FontWeight.ExtraBold)
            Text(stringResource(R.string.welcome_description),style=MaterialTheme.typography.bodyLarge,color=MaterialTheme.colorScheme.onSurfaceVariant)
            Text(stringResource(R.string.select_access_portal),style=MaterialTheme.typography.labelLarge)
            RoleCard(UserRole.THERAPIST,R.string.clinical_portal,R.string.therapist_description,R.string.enter_therapist,Navy,onRole)
            RoleCard(UserRole.PATIENT,R.string.rehabilitation_portal,R.string.patient_description,R.string.continue_patient,Teal,onRole)
            TextButton({onRole(UserRole.ADMIN)}) {Text(stringResource(R.string.admin_sign_in))}
            LanguagePicker()
            OutlinedButton(onCamera,modifier=Modifier.fillMaxWidth().heightIn(min=56.dp)) { Icon(Icons.Default.PlayArrow,null); Spacer(Modifier.width(8.dp)); Text(stringResource(R.string.try_camera)) }
            Text(stringResource(R.string.research_prototype),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable private fun RoleCard(role:UserRole,portal:Int,description:Int,action:Int,color:Color,onRole:(UserRole)->Unit) {
    ClinicalCard(accent=color) {
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween,verticalAlignment=Alignment.CenterVertically) {
            Surface(color=color.copy(alpha=.09f),shape=RoundedCornerShape(16.dp)) { Icon(if(role==UserRole.PATIENT) Icons.Default.Person else Icons.Default.Add,null,tint=color,modifier=Modifier.padding(12.dp).size(32.dp)) }
            Badge(portal)
        }
        Text(stringResource(role.title()),style=MaterialTheme.typography.headlineSmall,fontWeight=FontWeight.Bold)
        Text(stringResource(description),style=MaterialTheme.typography.bodyLarge)
        Button({onRole(role)},colors=ButtonDefaults.buttonColors(containerColor=color),shape=RoundedCornerShape(12.dp),modifier=Modifier.fillMaxWidth().heightIn(min=56.dp)) { Text(stringResource(action)); Spacer(Modifier.width(8.dp)); Icon(Icons.AutoMirrored.Filled.ArrowForward,null) }
    }
}

@Composable fun BrandHeader(onProfile:(()->Unit)?=null,onBack:(()->Unit)?=null) {
    Row(Modifier.fillMaxWidth().background(Color.White).padding(horizontal=20.dp,vertical=16.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)) {
        if(onBack!=null) IconButton(onBack) {Icon(Icons.AutoMirrored.Filled.ArrowBack,stringResource(R.string.back),tint=Navy)}
        androidx.compose.foundation.Image(painterResource(R.drawable.motivance_logo),stringResource(R.string.app_name),modifier=Modifier.size(48.dp))
        Column(Modifier.weight(1f)) { Text(stringResource(R.string.app_name),style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.ExtraBold,color=Navy); Text(stringResource(R.string.biomechanics_vision),style=MaterialTheme.typography.labelSmall,color=Teal) }
        if(onProfile!=null) IconButton(onProfile) { Icon(Icons.Default.AccountCircle,stringResource(R.string.nav_profile),tint=Navy) }
        else Badge(R.string.development_badge)
    }
}
@Composable private fun CameraSetup(onStart:()->Unit) {
    Badge(R.string.positioning_step)
    SectionTitle(R.string.prepare_camera,R.string.camera_setup_subtitle)
    ClinicalCard(accent=Teal) {
        Box(Modifier.fillMaxWidth().height(180.dp).background(Navy,RoundedCornerShape(20.dp)),contentAlignment=Alignment.Center) { Icon(Icons.Default.Person,null,tint=Color(0xFF86F2E4),modifier=Modifier.size(100.dp)) }
        Text(stringResource(R.string.position_checklist),style=MaterialTheme.typography.titleLarge)
        listOf(R.string.position_stable,R.string.position_visible,R.string.position_lighting).forEach { label -> Row(horizontalArrangement=Arrangement.spacedBy(10.dp)) { Icon(Icons.Default.CheckCircle,null,tint=Teal); Text(stringResource(label)) } }
    }
    PrimaryAction(R.string.start_camera_check,onStart)
    Text(stringResource(R.string.camera_privacy),style=MaterialTheme.typography.bodySmall)
}
@Composable private fun AssignmentCards(data:WorkspaceOverview?) {
    if(data==null) return
    if(data.assignments.isEmpty()) EmptyCard(R.string.no_assignments,R.string.no_assignments_detail)
    else data.assignments.forEach { assignment -> ClinicalCard { Text(stringResource(R.string.assignment_reference,assignment.id.take(8)),fontWeight=FontWeight.Bold); Text(stringResource(R.string.assignment_details_pending)) } }
}
@Composable private fun SessionCards(data:WorkspaceOverview?) {
    Text(stringResource(R.string.recent_sessions),style=MaterialTheme.typography.titleLarge)
    if(data==null) return
    if(data.sessions.isEmpty()) EmptyCard(R.string.no_sessions,R.string.no_sessions_detail)
    else data.sessions.forEach { session -> ClinicalCard {
        Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
            Icon(Icons.Default.DateRange,null,tint=Teal)
            Column { Text(session.startedAt.take(10),fontWeight=FontWeight.Bold); Text(stringResource(if(session.status=="completed") R.string.completed_session else R.string.interrupted_session)) }
        }
    } }
}
@Composable private fun OverviewStatus(state:OverviewState,retry:()->Unit) {
    if(state.busy) LoadingNotice(R.string.ui_loading_dashboard)
    if(state.failed) FeedbackNotice(R.string.dashboard_load_failed,error=true,retry=retry)
}
@Composable private fun MetricRow(first:Int,value:String,second:Int,other:String) {
    Row(horizontalArrangement=Arrangement.spacedBy(12.dp)) {
        listOf(first to value,second to other).forEach { (title,number) -> Surface(Modifier.weight(1f),color=Color.White,shape=RoundedCornerShape(20.dp),border=BorderStroke(1.dp,Color(0xFFE2E8F0))) { Column(Modifier.padding(20.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) { Text(stringResource(title),style=MaterialTheme.typography.labelLarge); Text(number,style=MaterialTheme.typography.headlineLarge,fontWeight=FontWeight.Bold,color=Teal) } } }
    }
}
@Composable private fun SectionTitle(title:Int,subtitle:Int) { Column(verticalArrangement=Arrangement.spacedBy(8.dp)) { Text(stringResource(title),style=MaterialTheme.typography.headlineMedium,fontWeight=FontWeight.Bold); Text(stringResource(subtitle),color=MaterialTheme.colorScheme.onSurfaceVariant) } }
@Composable private fun Badge(label:Int) { Surface(color=Color(0xFFD6F7F0),shape=RoundedCornerShape(30.dp)) { Text(stringResource(label),Modifier.padding(horizontal=12.dp,vertical=6.dp),style=MaterialTheme.typography.labelSmall,color=Teal) } }
@Composable private fun EmptyCard(title:Int,description:Int) { EmptyState(title,description) }
@Composable private fun PrimaryAction(label:Int,onClick:()->Unit) { ActionButton(label,onClick) }
private fun UserRole.title()=when(this) { UserRole.PATIENT -> R.string.patient_title; UserRole.THERAPIST -> R.string.therapist_title; UserRole.ADMIN -> R.string.role_admin }

@Composable internal fun WorkspaceHero(role:UserRole,onOpen:()->Unit) {
    Surface(shape=MaterialTheme.shapes.large,color=Navy,contentColor=Color.White) {
        Column(Modifier.fillMaxWidth().background(Brush.linearGradient(listOf(Navy,Color(0xFF104C60)))).padding(24.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
            Icon(if(role==UserRole.PATIENT) Icons.Default.PlayArrow else Icons.Default.Person,null,tint=Color(0xFF86F2E4),modifier=Modifier.size(32.dp))
            Text(stringResource(when(role) {UserRole.PATIENT->R.string.move_with_confidence;UserRole.THERAPIST->R.string.ui_care_overview;else->R.string.admin_title}),style=MaterialTheme.typography.headlineSmall)
            Text(stringResource(when(role) {UserRole.PATIENT->R.string.follow_therapist;UserRole.THERAPIST->R.string.ui_care_description;else->R.string.admin_scope}),color=Color(0xFFD6E6EE))
            Button(onOpen,modifier=Modifier.fillMaxWidth().heightIn(min=56.dp),shape=MaterialTheme.shapes.medium,
                colors=ButtonDefaults.buttonColors(containerColor=Color(0xFF86F2E4),contentColor=Navy)) {
                Text(stringResource(when(role) {UserRole.PATIENT->R.string.view_exercises;UserRole.THERAPIST->R.string.patient_management;else->R.string.admin_title}),modifier=Modifier.weight(1f))
                Icon(Icons.AutoMirrored.Filled.ArrowForward,null)
            }
        }
    }
}
