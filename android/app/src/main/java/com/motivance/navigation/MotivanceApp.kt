package com.motivance.navigation

import androidx.activity.compose.BackHandler
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.motivance.R
import com.motivance.domain.ExerciseRules
import com.motivance.domain.GuideBody
import com.motivance.domain.guideMotion
import com.motivance.feature.exercise.ExerciseGuide
import com.motivance.data.local.CachedPrescription
import com.motivance.data.local.ExerciseJson
import com.motivance.designsystem.*
import com.motivance.domain.ExerciseKind
import com.motivance.domain.BodySide
import com.motivance.domain.UserRole
import com.motivance.domain.WorkspaceOverview
import com.motivance.domain.nextSession
import com.motivance.feature.admin.*
import com.motivance.feature.auth.*
import com.motivance.feature.booking.*
import com.motivance.feature.notifications.*
import com.motivance.feature.exercise.CameraPrototype
import com.motivance.feature.exercise.ExerciseSessionViewModel
import com.motivance.feature.rehabilitation.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** How often an open patient screen checks for exercises the therapist has just published. */
private const val ASSIGNMENT_CHECK_MS=30_000L
/** How often the bell looks for news while the app is open. Nothing here is urgent enough to hold a connection open. */
private const val NOTIFICATION_CHECK_MS=60_000L

/** The toast host wraps the whole app because several screens below return early and draw without the scaffold. */
@Composable fun MotivanceApp(vm:AuthViewModel,toaster:Toaster) {
    CompositionLocalProvider(LocalToaster provides toaster) {
        Box(Modifier.fillMaxSize()) {
            AppContent(vm)
            ToastHost(toaster,Modifier.align(Alignment.TopCenter))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun AppContent(vm: AuthViewModel) {
    val auth by vm.state.collectAsStateWithLifecycle()
    val overview by vm.overview.collectAsStateWithLifecycle()
    val exercise:ExerciseSessionViewModel=viewModel()
    val local by exercise.state.collectAsStateWithLifecycle()
    val profile:PatientProfileViewModel=viewModel()
    val profileState by profile.state.collectAsStateWithLifecycle()
    val rehabilitation:RehabilitationViewModel=viewModel()
    val connected by rehabilitation.state.collectAsStateWithLifecycle()
    val history:HistoryViewModel=viewModel()
    val administration:AdministrationViewModel=viewModel()
    val booking:BookingViewModel=viewModel()
    val bookingState by booking.state.collectAsStateWithLifecycle()
    val schedule:ScheduleViewModel=viewModel()
    val scheduleState by schedule.state.collectAsStateWithLifecycle()
    val notifications:NotificationsViewModel=viewModel()
    val notificationState by notifications.state.collectAsStateWithLifecycle()
    val haptics=rememberHaptics()
    LaunchedEffect(auth.session?.userId,auth.session?.roles) {administration.configure(auth.session?.takeIf {UserRole.ADMIN in it.roles}?.userId)}
    LaunchedEffect(Unit) {vm.restore()}
    LaunchedEffect(auth.session?.userId) {
        profile.configure(auth.session?.userId)
        exercise.configure(auth.session?.userId ?: "local-demo")
        rehabilitation.configure(auth.session?.userId)
        history.configure(auth.session?.userId)
        booking.configure(auth.session?.userId)
    }
    var route by rememberSaveable { mutableStateOf("LANDING") }
    var selectedRole by rememberSaveable { mutableStateOf<String?>(null) }
    var selectedPatient by rememberSaveable {mutableStateOf<String?>(null)}
    var editingAssignment by rememberSaveable {mutableStateOf<String?>(null)}
    val role=selectedRole?.let { UserRole.valueOf(it) }
    LaunchedEffect(auth.session?.userId) {
        selectedPatient=null; editingAssignment=null
        // A workspace chosen on the profile page belongs to that sign-in; the next one starts from the account's roles.
        if(auth.session==null) selectedRole=null
        if(auth.session!=null) { route="HOME"; vm.loadOverview() }
        else if(route !in setOf("LANDING","AUTH","SETUP","CAMERA","CHECK_COMPLETE")) route="AUTH"
    }
    if(auth.restoring) { AuthLoadingScreen(); return }
    fun goBack() { route=parentRoute(route,auth.session!=null,auth.session?.workspace(role)==UserRole.THERAPIST) }
    BackHandler(enabled=route!="LANDING" && route!="HOME") { goBack() }
    if(route=="CAMERA") { CameraPrototype(ownerId=auth.session?.userId ?: "local-demo") { route="CHECK_COMPLETE" }; return }
    if(route=="AUTH" && auth.session==null) {
        AuthScreen(vm,{route="SETUP"}) { route="LANDING" }; return
    }
    if(auth.session==null && route=="LANDING") {
        Landing({route="AUTH"},{route="SETUP"}); return
    }
    val actualRole=auth.session?.workspace(role) ?: UserRole.PATIENT
    // A patient's exercises arrive on their own: on opening these pages, on returning to the app, and while it stays open.
    val lifecycle=LocalLifecycleOwner.current
    val patientAccount=auth.session?.userId?.takeIf {actualRole==UserRole.PATIENT}
    val assignmentPage=route.takeIf {patientAccount!=null && it in setOf("HOME","EXERCISES")}
    LaunchedEffect(assignmentPage,patientAccount,lifecycle) {
        if(assignmentPage!=null) lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while(true) {rehabilitation.syncAssignments(); delay(ASSIGNMENT_CHECK_MS)}
        }
    }
    val bookingPage=route.takeIf {patientAccount!=null && it in setOf("HOME","BOOKINGS","BOOK")}
    LaunchedEffect(bookingPage,patientAccount) {
        when(bookingPage) {"HOME","BOOKINGS" -> booking.refresh();"BOOK" -> booking.openBooking()}
    }
    // A therapist has room for a schedule tab. A patient's five are full, so theirs opens from My bookings.
    val therapistRole=actualRole==UserRole.THERAPIST
    val schedulePage=route.takeIf {auth.session!=null && it=="SCHEDULE"}
    LaunchedEffect(schedulePage,auth.session?.userId,therapistRole) {
        schedule.configure(auth.session?.userId,therapistRole)
        if(schedulePage!=null) schedule.open()
    }
    // Administrators take no part in bookings, so they have no bell.
    val inboxOwner=auth.session?.userId?.takeIf {actualRole!=UserRole.ADMIN}
    val language=LocalConfiguration.current.locales[0].language.let {if(it=="fil" || it=="tl") "fil" else "en"}
    LaunchedEffect(inboxOwner,language) {
        notifications.configure(inboxOwner)
        notifications.saveLanguage(language)
    }
    LaunchedEffect(inboxOwner,lifecycle) {
        if(inboxOwner!=null) lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while(true) {notifications.refresh(); delay(NOTIFICATION_CHECK_MS)}
        }
    }
    val rootRoutes=setOf("HOME","PATIENTS","EXERCISES","BOOKINGS","PROGRESS","PROFILE","ADMIN")+(if(therapistRole) setOf("SCHEDULE") else emptySet())
    val activeTab=when(route) {
        "PATIENT_DETAIL","ASSIGN" -> "PATIENTS"
        "LOCAL_HISTORY" -> "PROFILE"
        "BOOK" -> "BOOKINGS"
        "SCHEDULE" -> if(therapistRole) "SCHEDULE" else "BOOKINGS"
        "NOTIFICATIONS" -> "HOME"
        else -> route
    }
    val accountName=overview.data?.displayName?.takeIf { it.isNotBlank() } ?: stringResource(R.string.your_account)
    fun refreshWorkspace() {
        rehabilitation.refreshNow()
        if(route=="PROGRESS" || route=="PATIENT_DETAIL") history.refresh()
        if(route=="BOOKINGS") booking.refresh()
        if(route=="SCHEDULE") schedule.open()
        notifications.refresh()
        vm.loadOverview()
    }
    // Pull-to-refresh only shows its indicator for a refresh the person started, and clears once that work settles.
    var pulled by remember {mutableStateOf(false)}
    val working=connected.busy || overview.busy
    LaunchedEffect(pulled) {
        if(pulled) withTimeoutOrNull(15_000) {
            snapshotFlow {connected.busy || overview.busy}.first {it}
            snapshotFlow {connected.busy || overview.busy}.first {!it}
        }
        pulled=false
    }
    val refreshable=auth.session!=null && route in setOf("HOME","PATIENTS","EXERCISES","BOOKINGS","SCHEDULE","NOTIFICATIONS","PROGRESS","PATIENT_DETAIL","PROFILE")
    Scaffold(
        containerColor=MaterialTheme.colorScheme.background,
        topBar={BrandHeader(onProfile=if(auth.session!=null && route!="PROFILE") ({route="PROFILE"}) else null,
            onBack=if(route !in rootRoutes) ({goBack()}) else null,photoUrl=profileState.profile?.photoUrl,name=accountName,
            onNotifications=if(inboxOwner!=null && route!="NOTIFICATIONS") ({route="NOTIFICATIONS"}) else null,unread=notificationState.inbox.unread)},
        bottomBar={if(auth.session!=null) {
            val destinations=when(actualRole) {
                UserRole.ADMIN -> listOf(Triple("HOME",R.string.nav_home,Icons.Default.Home),Triple("ADMIN",R.string.role_admin,Icons.Default.Settings),Triple("PROFILE",R.string.nav_profile,Icons.Default.AccountCircle))
                UserRole.SCHEDULER -> listOf(Triple("HOME",R.string.nav_home,Icons.Default.Home),Triple("PROFILE",R.string.nav_profile,Icons.Default.AccountCircle))
                UserRole.THERAPIST -> listOf(Triple("HOME",R.string.nav_home,Icons.Default.Home),Triple("SCHEDULE",R.string.nav_schedule,Icons.AutoMirrored.Filled.List),Triple("PATIENTS",R.string.nav_patients,Icons.Default.Person),Triple("PROGRESS",R.string.nav_progress,Icons.Default.DateRange),Triple("PROFILE",R.string.nav_profile,Icons.Default.AccountCircle))
                else -> listOf(Triple("HOME",R.string.nav_home,Icons.Default.Home),Triple("EXERCISES",R.string.nav_exercises,Icons.Default.PlayArrow),Triple("BOOKINGS",R.string.nav_bookings,Icons.Default.Place),Triple("PROGRESS",R.string.nav_progress,Icons.Default.DateRange),Triple("PROFILE",R.string.nav_profile,Icons.Default.AccountCircle))
            }
            Column {
                HorizontalDivider(color=MaterialTheme.colorScheme.outlineVariant)
                NavigationBar(containerColor=MaterialTheme.colorScheme.surface,tonalElevation=0.dp,windowInsets=WindowInsets(0,0,0,0)) {
                    destinations.forEach { (page,label,icon) -> NavigationBarItem(selected=activeTab==page,
                        onClick={if(route!=page) {haptics.tick(); route=page}},icon={Icon(icon,null)},
                        colors=NavigationBarItemDefaults.colors(indicatorColor=MaterialTheme.colorScheme.primaryContainer,
                            selectedIconColor=MaterialTheme.colorScheme.onPrimaryContainer,selectedTextColor=MaterialTheme.colorScheme.onSurface,
                            unselectedIconColor=MaterialTheme.colorScheme.onSurfaceVariant,unselectedTextColor=MaterialTheme.colorScheme.onSurfaceVariant),
                        label={Text(stringResource(label),fontWeight=if(activeTab==page) FontWeight.SemiBold else FontWeight.Medium)}) }
                }
            }
        }}
    ) { padding ->
        PullToRefreshBox(isRefreshing=pulled && working,onRefresh={pulled=true; refreshWorkspace()},
            modifier=Modifier.fillMaxSize().padding(padding),contentAlignment=Alignment.TopCenter) {
        AnimatedContent(targetState=route to selectedPatient,modifier=Modifier.fillMaxSize(),transitionSpec={
            val from=depth(initialState.first,therapistRole); val to=depth(targetState.first,therapistRole)
            when {
                to>from -> (slideInHorizontally(tween(260,easing=FastOutSlowInEasing)) {it/6}+fadeIn(tween(200,delayMillis=40))) togetherWith
                    (slideOutHorizontally(tween(220)) {-it/12}+fadeOut(tween(120)))
                to<from -> (slideInHorizontally(tween(260,easing=FastOutSlowInEasing)) {-it/6}+fadeIn(tween(200,delayMillis=40))) togetherWith
                    (slideOutHorizontally(tween(220)) {it/12}+fadeOut(tween(120)))
                else -> (fadeIn(tween(220,delayMillis=70))+scaleIn(tween(220,delayMillis=70),initialScale=.985f)) togetherWith fadeOut(tween(90))
            }
        },contentAlignment=Alignment.TopCenter,label="route") { (page,patientId) ->
        Box(Modifier.fillMaxSize(),contentAlignment=Alignment.TopCenter) {
        Column(Modifier.widthIn(max=720.dp).fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(horizontal=20.dp,vertical=12.dp),verticalArrangement=Arrangement.spacedBy(20.dp)) {
            when(page) {
                "SETUP" -> CameraSetup(local.rules) { route="CAMERA" }
                "CHECK_COMPLETE" -> SessionComplete(local.saved,local.metrics.completed,local.rules.targetRepetitions,local.metrics.romDegrees,
                    local.metrics.incomplete,local.metrics.durationMs,connected.outbox.firstOrNull {it.sessionId==local.id}?.state,
                    again={exercise.newSession(); route="SETUP"},history={route="LOCAL_HISTORY"},done={route=if(auth.session!=null) "HOME" else "LANDING"})
                "PROFILE" -> {
                    PageHeader(R.string.nav_profile,R.string.account_and_access)
                    PatientProfileEditor(profile,accountName,{StatusPill(stringResource(actualRole.title()),PillTone.PRIMARY)}) {vm.loadOverview();rehabilitation.refresh()}
                    // Only an account with more than one role has anywhere to switch to.
                    auth.session?.roles?.filter {it!=actualRole}?.takeIf {it.isNotEmpty()}?.let {others ->
                        ClinicalCard {others.forEach {allowed -> ActionButton(allowed.title(),{selectedRole=allowed.name;route="HOME"},outlined=true)}}
                    }
                    ClinicalCard {LanguagePicker()}
                    SectionHeading(R.string.ui_account_actions)
                    ClinicalCard {
                        Text(stringResource(R.string.memory_session_notice),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                        if(actualRole==UserRole.PATIENT) ActionButton(R.string.local_history,{route="LOCAL_HISTORY"},outlined=true)
                        ActionButton(R.string.sign_out,{vm.act(AuthAction.SIGN_OUT)},outlined=true,enabled=!auth.busy,busy=auth.activeAction==AuthAction.SIGN_OUT,busyLabel=R.string.ui_signing_out)
                    }
                    ConnectedStatus(connected,showRefresh=false) {rehabilitation.refreshNow(); vm.loadOverview()}
                    SyncAndPrivacy(connected,rehabilitation,actualRole==UserRole.PATIENT) {exercise.newSession(); rehabilitation.withdraw()}
                }
                "LOCAL_HISTORY" -> {
                    PageHeader(R.string.local_history,R.string.local_history_detail)
                    if(local.history.isEmpty()) EmptyState(R.string.no_sessions,R.string.no_sessions_detail)
                    local.history.forEach { row ->
                        val metrics=ExerciseJson.snapshot(row.snapshotJson)
                        val rules=ExerciseJson.rules(row.rulesJson)
                        val completed=row.status=="COMPLETED"
                        ClinicalCard {
                            Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(14.dp)) {
                                MotionArc(if(rules.targetRepetitions>0) metrics.completed/rules.targetRepetitions.toFloat() else 0f,Modifier.size(56.dp),stroke=6f,
                                    fill=if(completed) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.outline) {
                                    Text(metrics.completed.toString(),style=MaterialTheme.typography.titleMedium,fontFamily=DisplayFamily)
                                }
                                Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)) {
                                    Text(rules.displayName(),style=MaterialTheme.typography.titleMedium)
                                    Text(displayDate(Instant.ofEpochMilli(row.startedAt).atZone(ZoneId.systemDefault()).toLocalDate().toString()),
                                        style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                StatusPill(stringResource(if(completed) R.string.completed_session else R.string.interrupted_session),if(completed) PillTone.POSITIVE else PillTone.NEUTRAL)
                            }
                            Text(stringResource(R.string.completed_reps,metrics.completed,rules.targetRepetitions))
                            Text(stringResource(R.string.session_metrics,metrics.romDegrees?.let {"%.1f".format(it)} ?: "--",metrics.incomplete,metrics.durationMs/1000),
                                style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(stringResource(if(rules.demo) R.string.demo_assessment_notice else R.string.prescribed_assessment_notice),style=MaterialTheme.typography.bodySmall,
                                color=MaterialTheme.colorScheme.onSurfaceVariant)
                            connected.outbox.firstOrNull {it.sessionId==row.id}?.let {StatusPill(syncLabel(it.state))}
                        }
                    }
                }
                "ADMIN" -> if(actualRole==UserRole.ADMIN) AdministrationScreen(administration)
                "PATIENTS" -> {
                    PageHeader(R.string.patient_management,R.string.assigned_patients_only)
                    ConnectedStatus(connected) {rehabilitation.refreshNow(); vm.loadOverview()}
                    if(actualRole==UserRole.ADMIN) AdministrationScreen(administration)
                    else PatientManagement(connected,rehabilitation) {selectedPatient=it; route="PATIENT_DETAIL"}
                }
                "PATIENT_DETAIL" -> {
                    val patient=connected.workspace.patients.firstOrNull {it.id==patientId}
                    val plans=connected.workspace.prescriptions.filter {it.patientId==patientId}
                    PageHeader(R.string.patient_management,eyebrow=patient?.name?.ifBlank {null} ?: patientId?.take(8))
                    patient?.profile?.let {PatientProfileSummary(it)}
                    ConnectedStatus(connected) {rehabilitation.refreshNow(); vm.loadOverview()}
                    SectionHeading(R.string.ui_exercise_plan) {
                        FilledTonalButton({editingAssignment=null; route="ASSIGN"},enabled=!connected.busy,modifier=Modifier.heightIn(min=48.dp)) {
                            Icon(Icons.Default.Add,null,Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.assign_exercise))
                        }
                    }
                    if(plans.isEmpty() && !connected.busy) EmptyState(R.string.no_assignments,R.string.ui_plan_empty_detail)
                    plans.forEach {p -> AssignedPrescriptionCard(p,connected.workspace.catalogue.firstOrNull {it.id==p.exerciseId},!connected.busy) {
                        editingAssignment=p.assignmentId; route="ASSIGN"
                    } }
                    SectionHeading(R.string.recovery_progress)
                    ResultsDashboard(connected.workspace,connected.owner,patientId,history)
                }
                "ASSIGN" -> {
                    val existing=connected.workspace.prescriptions.firstOrNull {it.assignmentId==editingAssignment}
                    PageHeader(R.string.exercise_assignment,R.string.professional_targets)
                    ConnectedStatus(connected) {rehabilitation.refreshNow(); vm.loadOverview()}
                    // Leaving on success also retires the form's assignment ID: reusing it would turn the next exercise into a new
                    // version of this one and replace it on the patient's phone.
                    key(existing?.versionId ?: "new") {PrescriptionForm(connected,rehabilitation,patientId,existing) {if(route=="ASSIGN") route="PATIENT_DETAIL"}}
                }
                "EXERCISES" -> {
                    PageHeader(R.string.your_exercises,R.string.professional_targets)
                    ConnectedStatus(connected) {rehabilitation.refreshNow(); vm.loadOverview()}
                    CachedAssignments(local.cached,connected.workspace.prescriptions.any {p -> p.patientId==connected.owner && local.cached.none {it.versionId==p.versionId}},loading=connected.busy || connected.failed) {exercise.newSession(); exercise.usePrescription(it); route="SETUP"}
                    SectionHeading(R.string.ui_quick_actions)
                    QuickAction(Icons.Default.PlayArrow,R.string.camera_check,R.string.camera_preview_only) {route="SETUP"}
                    PatientInvitation(connected,rehabilitation)
                }
                "BOOKINGS" -> {
                    PageHeader(R.string.booking_my_title,R.string.booking_my_detail)
                    MyBookings(bookingState,booking,{route="SCHEDULE"}) {route="BOOK"}
                }
                "NOTIFICATIONS" -> {
                    PageHeader(R.string.nav_notifications,R.string.notifications_detail)
                    // A Scheduler's requests are on the web, so opening one only marks it read.
                    Notifications(notificationState,notifications) {
                        when(actualRole) {UserRole.PATIENT -> route="BOOKINGS";UserRole.THERAPIST -> route="SCHEDULE";else -> Unit}
                    }
                }
                "SCHEDULE" -> {
                    PageHeader(R.string.schedule_title,if(therapistRole) R.string.schedule_detail_therapist else R.string.schedule_detail_patient)
                    MySchedule(scheduleState,schedule,connected.workspace.patients.map {it.id}.toSet()) {selectedPatient=it; route="PATIENT_DETAIL"}
                }
                "BOOK" -> {
                    PageHeader(R.string.booking_title,R.string.booking_detail)
                    BookSession(bookingState,booking) {route="BOOKINGS"}
                }
                "PROGRESS" -> {
                    PageHeader(R.string.recovery_progress,R.string.valid_measurements_only)
                    ConnectedStatus(connected) {rehabilitation.refreshNow(); history.refresh()}
                    ResultsDashboard(connected.workspace,connected.owner,if(actualRole==UserRole.PATIENT) auth.session?.userId else null,history)
                }
                else -> if(actualRole==UserRole.SCHEDULER) SchedulerHome() else {
                    val patientRole=actualRole==UserRole.PATIENT
                    val greeting=overview.data?.displayName?.takeIf {it.isNotBlank()}?.let {stringResource(R.string.home_greeting,it.substringBefore(' '))}
                    PageHeader(if(patientRole) R.string.your_recovery else R.string.clinical_overview,
                        if(patientRole) R.string.personal_rehabilitation else R.string.assigned_patients_only,eyebrow=greeting)
                    OverviewStatus(overview) { vm.loadOverview() }
                    when(actualRole) {
                        UserRole.PATIENT -> {
                            val now=System.currentTimeMillis()
                            val ready=local.cached.filter {it.expiresAt>now && it.instructions.isNotBlank()}
                            ready.firstOrNull()?.let {next ->
                                TodayPlan(next,ready.size,{exercise.newSession(); exercise.usePrescription(next); route="SETUP"}) {route="EXERCISES"}
                            } ?: WorkspaceHero(actualRole) {route="EXERCISES"}
                            val days=remember(overview.data,local.history) {
                                overview.data?.sessions.orEmpty().filter {it.status=="completed"}.mapNotNull {runCatching {LocalDate.parse(it.startedAt.take(10))}.getOrNull()}.toSet() +
                                    local.history.filter {it.status=="COMPLETED"}.map {Instant.ofEpochMilli(it.startedAt).atZone(ZoneId.systemDefault()).toLocalDate()}
                            }
                            NextSessionCard(bookingState.bookings.nextSession(),{route="BOOKINGS"},{route="BOOK"})
                            WeekCard(days)
                        }
                        UserRole.THERAPIST -> {
                            MetricRow(R.string.total_patients,overview.data?.patientIds?.size?.toString() ?: "—",Icons.Default.Person,
                                R.string.recent_sessions,overview.data?.sessions?.size?.toString() ?: "—",Icons.Default.DateRange)
                            val patients=connected.workspace.patients.filter {it.id!=connected.owner}
                            if(patients.isEmpty()) WorkspaceHero(actualRole) {route="PATIENTS"}
                            else {
                                SectionHeading(R.string.nav_patients) {
                                    TextButton({route="PATIENTS"},Modifier.heightIn(min=48.dp)) {Text(stringResource(R.string.see_all))}
                                }
                                PatientList(patients.take(3),connected.workspace.prescriptions,!connected.busy,open={selectedPatient=it; route="PATIENT_DETAIL"})
                            }
                        }
                        else -> WorkspaceHero(actualRole) {route="ADMIN"}
                    }
                    SectionHeading(R.string.ui_quick_actions)
                    QuickAction(Icons.Default.PlayArrow,R.string.camera_check,R.string.single_camera_description) {route="SETUP"}
                    if(actualRole==UserRole.THERAPIST) QuickAction(Icons.Default.DateRange,R.string.nav_progress,R.string.valid_measurements_only) {route="PROGRESS"}
                    SessionCards(overview.data)
                }
            }
            Spacer(Modifier.height(8.dp))
        }
        }
        }
        }
    }
}

/** Navigation depth decides the direction of the page transition: deeper slides in from the end edge. */
private fun depth(route:String,therapist:Boolean)=when(route) {
    "ASSIGN" -> 2
    "PATIENT_DETAIL","LOCAL_HISTORY","SETUP","CHECK_COMPLETE","BOOK","NOTIFICATIONS" -> 1
    "SCHEDULE" -> if(therapist) 0 else 1
    else -> 0
}

internal fun parentRoute(route:String,signedIn:Boolean,therapist:Boolean=false)=when(route) {
    "AUTH" -> "LANDING"
    "CAMERA" -> "SETUP"
    "ASSIGN" -> "PATIENT_DETAIL"
    "PATIENT_DETAIL" -> "PATIENTS"
    "BOOK" -> "BOOKINGS"
    "SCHEDULE" -> if(therapist) "HOME" else "BOOKINGS"
    "LOCAL_HISTORY" -> if(signedIn) "PROFILE" else "CHECK_COMPLETE"
    "SETUP" -> if(signedIn) "HOME" else "LANDING"
    else -> if(signedIn) "HOME" else "LANDING"
}

@Composable internal fun Landing(onSignIn:()->Unit,onCamera:()->Unit) {
    // The one orchestrated moment in the app: the arc sweeps to a working range when the app first opens.
    var shown by rememberSaveable {mutableStateOf(false)}
    LaunchedEffect(Unit) {shown=true}
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),horizontalAlignment=Alignment.CenterHorizontally) {
        BrandHeader()
        Column(Modifier.widthIn(max=640.dp).weight(1f).verticalScroll(rememberScrollState()).padding(horizontal=20.dp,vertical=8.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
            // The open face leaves its lower quarter empty, so the frame is shorter than the arc.
            Box(Modifier.fillMaxWidth().height(164.dp).padding(top=4.dp),contentAlignment=Alignment.TopCenter) {
                MotionArc(if(shown) .72f else 0f,Modifier.size(196.dp),stroke=16f,band=20.0 to 120.0) {
                    Image(painterResource(R.drawable.motivance_logo),null,Modifier.size(92.dp))
                }
            }
            Text(stringResource(R.string.markerless_rehabilitation),style=MaterialTheme.typography.titleSmall,color=MaterialTheme.colorScheme.primary)
            Text(stringResource(R.string.welcome_motivance),style=MaterialTheme.typography.displaySmall,modifier=Modifier.semantics {heading()})
            Text(stringResource(R.string.welcome_description),style=MaterialTheme.typography.bodyLarge,color=MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(4.dp))
            ActionButton(R.string.sign_in,onSignIn)
            OutlinedButton(onCamera,modifier=Modifier.fillMaxWidth().heightIn(min=56.dp),shape=MaterialTheme.shapes.medium) {
                Icon(Icons.Default.PlayArrow,null); Spacer(Modifier.width(8.dp)); Text(stringResource(R.string.try_camera))
            }
            HorizontalDivider(color=MaterialTheme.colorScheme.outlineVariant)
            LanguagePicker()
            Text(stringResource(R.string.research_prototype),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(8.dp))
        }
    }
}

/**
 * The app bar sits on the page ground rather than on a white strip, so content reads as one surface. The
 * account button shows the person's own avatar, which is both a shortcut and a reminder of who is signed in.
 */
@Composable fun BrandHeader(onProfile:(()->Unit)?=null,onBack:(()->Unit)?=null,photoUrl:String?=null,name:String="",onNotifications:(()->Unit)?=null,unread:Int=0) {
    Row(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.background).heightIn(min=64.dp)
        .padding(start=if(onBack!=null) 4.dp else 20.dp,end=12.dp,top=6.dp,bottom=6.dp),
        verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)) {
        if(onBack!=null) IconButton(onBack) {Icon(Icons.AutoMirrored.Filled.ArrowBack,stringResource(R.string.back),tint=MaterialTheme.colorScheme.onSurface)}
        Image(painterResource(R.drawable.motivance_logo),null,modifier=Modifier.size(34.dp))
        Text(stringResource(R.string.app_name),style=MaterialTheme.typography.titleLarge,color=MaterialTheme.colorScheme.onSurface,
            modifier=Modifier.weight(1f).semantics {heading()})
        if(onNotifications!=null) IconButton(onNotifications,Modifier.size(48.dp)) {
            BadgedBox(badge={if(unread>0) Badge {Text(if(unread>9) "9+" else unread.toString())}}) {
                Icon(Icons.Default.Notifications,if(unread>0) stringResource(R.string.notifications_unread_count,unread) else stringResource(R.string.nav_notifications),tint=MaterialTheme.colorScheme.onSurface)
            }
        }
        if(onProfile!=null) IconButton(onProfile,Modifier.size(48.dp)) {
            PersonAvatar(photoUrl,name.ifBlank {"?"},36.dp,container=MaterialTheme.colorScheme.primaryContainer,
                content=MaterialTheme.colorScheme.onPrimaryContainer,description=stringResource(R.string.nav_profile))
        } else if(name.isBlank()) StatusPill(stringResource(R.string.development_badge),PillTone.NEUTRAL)
    }
}

@Composable private fun CameraSetup(rules:ExerciseRules,onStart:()->Unit) {
    PageHeader(R.string.prepare_camera,R.string.camera_setup_subtitle,eyebrow=stringResource(R.string.positioning_step))
    SetupIllustration(rules)
    ClinicalCard {
        Text(stringResource(R.string.position_checklist),style=MaterialTheme.typography.titleLarge,modifier=Modifier.semantics {heading()})
        listOf(R.string.position_stable,R.string.position_visible,R.string.position_lighting).forEachIndexed { index,label ->
            Row(horizontalArrangement=Arrangement.spacedBy(14.dp),verticalAlignment=Alignment.Top) {
                Surface(shape=CircleShape,color=MaterialTheme.colorScheme.primaryContainer,contentColor=MaterialTheme.colorScheme.onPrimaryContainer,modifier=Modifier.size(30.dp)) {
                    Box(contentAlignment=Alignment.Center) {Text((index+1).toString(),style=MaterialTheme.typography.labelLarge,fontWeight=FontWeight.Bold)}
                }
                Text(stringResource(label),style=MaterialTheme.typography.bodyLarge,modifier=Modifier.weight(1f).padding(top=2.dp))
            }
        }
    }
    ActionButton(R.string.start_camera_check,onStart)
    Row(horizontalArrangement=Arrangement.spacedBy(10.dp)) {
        Icon(Icons.Default.Lock,null,Modifier.size(18.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant)
        Text(stringResource(R.string.camera_privacy),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** A phone on a stand, a dashed sightline, and the model person showing the exercise to come: the setup in one glance. */
@Composable internal fun SetupIllustration(rules:ExerciseRules) {
    val description=stringResource(R.string.setup_figure)
    val motion=remember(rules) {guideMotion(rules)}
    Surface(Modifier.fillMaxWidth(),shape=MaterialTheme.shapes.large,color=Motion.Night) {
        Box(Modifier.fillMaxWidth().height(260.dp)) {
            Canvas(Modifier.matchParentSize().semantics {contentDescription=description}) {
                val ink=Motion.NightInk; val mint=Motion.SproutBright; val w=size.width; val h=size.height
                // On the same floor as the model person.
                val floor=h/2+((GuideBody.FLOOR-motion.frame.centerY)*minOf(w*.68f,h)/motion.frame.span).toFloat()
                drawLine(Motion.NightLine,Offset(w*.04f,floor),Offset(w*.96f,floor),2.dp.toPx(),StrokeCap.Round)
                val px=w*.15f; val top=h*.32f
                listOf(px-w*.05f,px,px+w*.05f).forEach {drawLine(ink,Offset(px,top+h*.2f),Offset(it,floor),2.5.dp.toPx(),StrokeCap.Round)}
                drawRoundRect(ink,Offset(px-12.dp.toPx(),top),androidx.compose.ui.geometry.Size(24.dp.toPx(),h*.22f),androidx.compose.ui.geometry.CornerRadius(5.dp.toPx()))
                drawCircle(Motion.Night,3.dp.toPx(),Offset(px,top+8.dp.toPx()))
                listOf(h*.08f,floor-4.dp.toPx()).forEach {y ->
                    drawLine(mint.copy(alpha=.55f),Offset(px+14.dp.toPx(),top+h*.08f),Offset(w*.56f,y),1.5.dp.toPx(),pathEffect=PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(),6.dp.toPx())))
                }
            }
            ExerciseGuide(motion,rules.displayName(),Modifier.align(Alignment.CenterEnd).fillMaxWidth(.68f).fillMaxHeight(),dark=true)
        }
    }
}

/** Closing screen for a camera session: the arc fills to the share of target repetitions completed. */
@Composable private fun SessionComplete(saved:Boolean,completed:Int,target:Int,rom:Double?,incomplete:Int,durationMs:Long,sync:String?,
    again:()->Unit,history:()->Unit,done:()->Unit) {
    val haptics=rememberHaptics()
    LaunchedEffect(saved) {if(saved) haptics.confirm()}
    PageHeader(R.string.camera_check_complete,if(saved) R.string.session_saved_local else R.string.camera_preview_only)
    ClinicalCard {
        Box(Modifier.fillMaxWidth(),contentAlignment=Alignment.Center) {
            MotionArc(if(saved && target>0) completed/target.toFloat() else if(saved) 0f else 1f,Modifier.size(208.dp),stroke=16f,
                fill=if(saved) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.primary) {
                if(saved) Column(horizontalAlignment=Alignment.CenterHorizontally) {
                    Text(completed.toString(),style=MaterialTheme.typography.displayLarge,color=MaterialTheme.colorScheme.onSurface)
                    Text(stringResource(R.string.reps_of_target,target),style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
                } else Icon(Icons.Default.CheckCircle,null,tint=MaterialTheme.colorScheme.primary,modifier=Modifier.size(64.dp))
            }
        }
        if(saved) {
            // Keeps the established accessible summary while the numbers above carry the visual weight.
            Text(stringResource(R.string.completed_reps,completed,target),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign=TextAlign.Center,modifier=Modifier.fillMaxWidth())
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min),horizontalArrangement=Arrangement.spacedBy(10.dp)) {
                StatBlock(R.string.calc_session_rom,rom?.let {"%.1f°".format(it)} ?: "—",Modifier.weight(1f))
                StatBlock(R.string.calc_not_counted,incomplete.toString(),Modifier.weight(1f))
                StatBlock(R.string.stat_active_time,stringResource(R.string.stat_seconds,(durationMs/1000).toInt()),Modifier.weight(1f))
            }
            sync?.let {Box(Modifier.fillMaxWidth(),contentAlignment=Alignment.Center) {StatusPill(syncLabel(it),if(it=="SYNCED") PillTone.POSITIVE else PillTone.NEUTRAL)}}
        } else Text(stringResource(R.string.no_clinical_record),style=MaterialTheme.typography.bodyMedium,textAlign=TextAlign.Center,modifier=Modifier.fillMaxWidth())
    }
    ActionButton(R.string.try_camera_again,again)
    ActionButton(R.string.local_history,history,outlined=true)
    TextButton(done,Modifier.fillMaxWidth().heightIn(min=48.dp)) { Text(stringResource(R.string.back)) }
}

@Composable private fun StatBlock(label:Int,value:String,modifier:Modifier) {
    Surface(modifier.fillMaxHeight(),shape=MaterialTheme.shapes.medium,color=MaterialTheme.colorScheme.surfaceContainerLow) {
        Column(Modifier.padding(12.dp).semantics(mergeDescendants=true) {},verticalArrangement=Arrangement.spacedBy(4.dp)) {
            Text(value,style=MaterialTheme.typography.titleLarge,color=MaterialTheme.colorScheme.onSurface)
            Text(stringResource(label),style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/**
 * The patient's next assigned exercise as the page's one bold element: the prescribed range drawn on the arc,
 * the reach angle as the number to aim for, and a single start action.
 */
@Composable private fun TodayPlan(next:CachedPrescription,count:Int,start:()->Unit,all:()->Unit) {
    val rules=remember(next.rulesJson) {ExerciseJson.rules(next.rulesJson)}
    val name=rules.displayName()
    val side=stringResource(if(rules.side==BodySide.LEFT) R.string.left_side else R.string.right_side)
    Surface(Modifier.fillMaxWidth(),shape=MaterialTheme.shapes.extraLarge,color=Motion.Ink,contentColor=Color.White) {
        Column(Modifier.padding(22.dp),verticalArrangement=Arrangement.spacedBy(14.dp)) {
            Text(stringResource(R.string.today_exercise),style=MaterialTheme.typography.titleSmall,color=Motion.NightInk)
            Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(16.dp)) {
                Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                    Text(name,style=MaterialTheme.typography.headlineSmall,modifier=Modifier.semantics {heading()})
                    Text(side,style=MaterialTheme.typography.bodyMedium,color=Motion.NightInk)
                    Surface(shape=CircleShape,color=Motion.NightPanel) {
                        Text(stringResource(R.string.ui_reps_value,rules.targetRepetitions),Modifier.padding(horizontal=12.dp,vertical=6.dp),
                            style=MaterialTheme.typography.labelLarge)
                    }
                }
                ExerciseGuide(remember(rules) {guideMotion(rules)},name,Modifier.size(136.dp),dark=true)
            }
            if(next.instructions.isNotBlank()) Text(next.instructions,style=MaterialTheme.typography.bodyMedium,color=Motion.NightInk,maxLines=3,
                overflow=androidx.compose.ui.text.style.TextOverflow.Ellipsis)
            Button(start,Modifier.fillMaxWidth().heightIn(min=56.dp),shape=MaterialTheme.shapes.medium,
                colors=ButtonDefaults.buttonColors(containerColor=Motion.SproutBright,contentColor=Motion.Ink)) {
                Icon(Icons.Default.PlayArrow,null); Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.start_exercise_named,name),fontWeight=FontWeight.Bold)
            }
            if(count>1) TextButton(all,Modifier.heightIn(min=48.dp),colors=ButtonDefaults.textButtonColors(contentColor=Color.White)) {
                Text(stringResource(R.string.today_more,count))
            }
        }
    }
}

@Composable private fun WeekCard(days:Set<LocalDate>) {
    val today=LocalDate.now()
    val monday=today.with(java.time.temporal.TemporalAdjusters.previousOrSame(java.time.DayOfWeek.MONDAY))
    val count=days.count {!it.isBefore(monday) && !it.isAfter(today)}
    ClinicalCard {
        Row(verticalAlignment=Alignment.CenterVertically) {
            Text(stringResource(R.string.week_title),style=MaterialTheme.typography.titleLarge,modifier=Modifier.weight(1f).semantics {heading()})
            StatusPill(stringResource(R.string.week_sessions,count),if(count>0) PillTone.POSITIVE else PillTone.NEUTRAL)
        }
        WeekStrip(days,stringResource(R.string.week_description,count),today=today)
    }
}

@Composable private fun SessionCards(data:WorkspaceOverview?) {
    SectionHeading(R.string.recent_sessions)
    if(data==null) return
    if(data.sessions.isEmpty()) EmptyState(R.string.no_sessions,R.string.no_sessions_detail)
    else Surface(Modifier.fillMaxWidth(),color=MaterialTheme.colorScheme.surface,shape=MaterialTheme.shapes.large,
        border=BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant)) {
        Column {
            data.sessions.forEachIndexed { index, session ->
                if(index>0) HorizontalDivider(Modifier.padding(start=74.dp),color=MaterialTheme.colorScheme.outlineVariant)
                val completed=session.status=="completed"
                Row(Modifier.fillMaxWidth().padding(horizontal=20.dp,vertical=14.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(14.dp)) {
                    IconBadge(if(completed) Icons.Default.CheckCircle else Icons.Default.DateRange,
                        if(completed) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.outline,40)
                    Text(displayDate(session.startedAt.take(10)),style=MaterialTheme.typography.titleSmall,modifier=Modifier.weight(1f))
                    StatusPill(stringResource(if(completed) R.string.completed_session else R.string.interrupted_session),if(completed) PillTone.POSITIVE else PillTone.NEUTRAL)
                }
            }
        }
    }
}

@Composable private fun QuickAction(icon:ImageVector,title:Int,description:Int,onClick:()->Unit) {
    TappableSurface(onClick,Modifier.fillMaxWidth()) {
        Row(Modifier.padding(18.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(14.dp)) {
            IconBadge(icon)
            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(2.dp)) {
                Text(stringResource(title),style=MaterialTheme.typography.titleMedium)
                Text(stringResource(description),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight,null,tint=MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable private fun OverviewStatus(state:OverviewState,retry:()->Unit) {
    if(state.busy) LoadingNotice(R.string.ui_loading_dashboard)
    if(state.failed) FeedbackNotice(R.string.dashboard_load_failed,error=true,retry=retry)
}

@Composable private fun MetricRow(first:Int,value:String,firstIcon:ImageVector,second:Int,other:String,secondIcon:ImageVector) {
    Row(Modifier.height(IntrinsicSize.Min),horizontalArrangement=Arrangement.spacedBy(12.dp)) {
        listOf(Triple(first,value,firstIcon),Triple(second,other,secondIcon)).forEach { (title,number,icon) ->
            Surface(Modifier.weight(1f).fillMaxHeight(),color=MaterialTheme.colorScheme.surface,shape=MaterialTheme.shapes.large,border=BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant)) {
                Column(Modifier.padding(18.dp).semantics(mergeDescendants=true) {},verticalArrangement=Arrangement.spacedBy(6.dp)) {
                    Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                        Icon(icon,null,Modifier.size(18.dp),tint=MaterialTheme.colorScheme.primary)
                        Text(stringResource(title),style=MaterialTheme.typography.labelLarge,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Text(number,style=MaterialTheme.typography.displaySmall,color=MaterialTheme.colorScheme.onSurface)
                }
            }
        }
    }
}

private fun UserRole.title()=when(this) { UserRole.PATIENT -> R.string.patient_title; UserRole.THERAPIST -> R.string.therapist_title; UserRole.SCHEDULER -> R.string.scheduler_title; UserRole.ADMIN -> R.string.role_admin }

/** Scheduling is built from large tables and exports, so it lives on the web. The phone says so rather than showing an empty workspace. */
@Composable private fun SchedulerHome() {
    PageHeader(R.string.scheduler_home,R.string.scheduler_home_detail)
    FeedbackNotice(R.string.scheduler_use_web)
}

/** Fallback hero when there is no assigned exercise to feature: a short orientation and the one next step. */
@Composable internal fun WorkspaceHero(role:UserRole,onOpen:()->Unit) {
    Surface(shape=MaterialTheme.shapes.extraLarge,color=Motion.Ink,contentColor=Color.White) {
        Row(Modifier.fillMaxWidth().padding(22.dp),horizontalArrangement=Arrangement.spacedBy(16.dp)) {
            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(14.dp)) {
                Text(stringResource(when(role) {UserRole.PATIENT->R.string.move_with_confidence;UserRole.THERAPIST->R.string.ui_care_overview;else->R.string.admin_title}),
                    style=MaterialTheme.typography.headlineSmall,modifier=Modifier.semantics {heading()})
                Text(stringResource(when(role) {UserRole.PATIENT->R.string.follow_therapist;UserRole.THERAPIST->R.string.ui_care_description;else->R.string.admin_scope}),
                    style=MaterialTheme.typography.bodyMedium,color=Motion.NightInk)
                Button(onOpen,modifier=Modifier.fillMaxWidth().heightIn(min=56.dp),shape=MaterialTheme.shapes.medium,
                    colors=ButtonDefaults.buttonColors(containerColor=Motion.SproutBright,contentColor=Motion.Ink)) {
                    Text(stringResource(when(role) {UserRole.PATIENT->R.string.view_exercises;UserRole.THERAPIST->R.string.patient_management;else->R.string.admin_title}),
                        modifier=Modifier.weight(1f),fontWeight=FontWeight.Bold)
                    Icon(Icons.AutoMirrored.Filled.ArrowForward,null)
                }
            }
        }
    }
}
