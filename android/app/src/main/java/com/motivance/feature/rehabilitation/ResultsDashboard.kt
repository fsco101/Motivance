package com.motivance.feature.rehabilitation

import com.motivance.feature.exercise.WatchSharedVideo
import com.motivance.feature.exercise.sharedUntil
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.motivance.R
import com.motivance.designsystem.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Warning
import com.motivance.domain.*
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** A therapist is told once a patient has gone this long without finishing a session. */
private const val QUIET_DAYS = 7

/**
 * One person's progress. [patientId] is null while a therapist still has to choose a patient. A patient reading their own
 * record sees it in plain terms; a therapist also sees what they need to judge the data: tracking quality and versions.
 */
@Composable
fun ColumnScope.ResultsDashboard(workspace: RehabWorkspace, owner: String, patientId: String?, vm: HistoryViewModel,
    /** Shares a progress card about the patient shown, into chat. Absent where there is no chat. */
    share: ((String, ChatCard.Progress) -> Unit)? = null,
    /** The video shared for a session, and a way to have a link to watch it (#129). */
    videoFor: (String) -> SharedVideo? = { null }, link: (suspend (SharedVideo) -> String?)? = null,
    /** Opens the chosen patient's record from the header above their results (#174). */
    openPatient: ((String) -> Unit)? = null) {
    val self = patientId == owner
    val zone = remember { ZoneId.systemDefault() }
    var patient by rememberSaveable(owner, patientId) { mutableStateOf(patientId.orEmpty()) }
    var exercise by rememberSaveable(owner, patientId) { mutableStateOf("") }
    var side by rememberSaveable(owner, patientId) { mutableStateOf("") }
    var from by rememberSaveable(owner, patientId) { mutableStateOf("") }
    var through by rememberSaveable(owner, patientId) { mutableStateOf("") }
    val state by vm.state.collectAsStateWithLifecycle()
    val validDates = runCatching {
        val start = from.takeIf { it.isNotBlank() }?.let(LocalDate::parse)
        val end = through.takeIf { it.isNotBlank() }?.let(LocalDate::parse)
        require(start == null || end == null || start <= end)
        require(end == null || end < LocalDate.MAX)
        start to end
    }.getOrNull()
    val query = if (patient.isNotBlank() && validDates != null) HistoryQuery(patient, exercise.ifBlank { null },
        side.ifBlank { null }, validDates.first, validDates.second) else null
    LaunchedEffect(owner, query) { if (query != null) vm.show(query) }
    val rows = if (state.owner == owner && state.query == query && query != null) state.rows else emptyList()

    var filtersExpanded by rememberSaveable(owner,patientId) {mutableStateOf(false)}
    val choosable = workspace.patients.filter { it.id != owner }
    ClinicalCard {
    Text(stringResource(R.string.history_filters), style = MaterialTheme.typography.titleLarge)
    if (patientId == null) PatientChoice(choosable, patient) { patient = it }
    TextButton({filtersExpanded=!filtersExpanded}) {Text(stringResource(if(filtersExpanded) R.string.ui_hide_filters else R.string.ui_show_filters)); Icon(Icons.Default.KeyboardArrowDown,null)}
    if(filtersExpanded) {
    val exercises = (workspace.catalogue.map { it.id to it.name } + rows.mapNotNull { it.prescription }
        .map { it.exerciseVersionId to it.exerciseName }).distinctBy { it.first }
    // A therapist may need to tell two versions of one exercise apart; a patient only needs its name.
    HistoryChoice(R.string.select_exercise, listOf("" to stringResource(R.string.history_all_exercises)) +
        exercises.map { it.first to (it.second.ifBlank { stringResource(R.string.history_unknown_exercise) } + if (self) "" else " · " + it.first.take(8)) }, exercise) { exercise = it }
    HistoryChoice(R.string.history_side, listOf("" to stringResource(R.string.history_all_sides),
        "left" to stringResource(R.string.left_side), "right" to stringResource(R.string.right_side),
        "bilateral" to stringResource(R.string.history_bilateral)), side) { side = it }
    DateInput(R.string.history_from,from) {from=it}
    DateInput(R.string.history_through,through) {through=it}
    if(from.isNotBlank() || through.isNotBlank()) TextButton({from="";through=""}) {Text(stringResource(R.string.form_clear_dates))}
    Text(stringResource(R.string.history_date_help), style = MaterialTheme.typography.bodySmall)
    }
    if (validDates == null) Text(stringResource(R.string.history_date_error), color = MaterialTheme.colorScheme.error)
    }
    if (patientId == null) choosable.firstOrNull { it.id == patient }?.let { chosen -> ProgressPatientHeader(chosen, openPatient?.let { { it(chosen.id) } }) }
    if (query == null) {
        if (patient.isBlank()) Text(stringResource(R.string.history_choose_patient))
        return
    }
    val current = state.owner == owner && state.query == query
    if (current && state.loading) LoadingNotice(if(state.loaded) R.string.ui_loading_older else R.string.ui_loading_history)
    ActionButton(R.string.history_refresh,{vm.refresh()},outlined=true,enabled=current && !state.loading)
    if (current && state.failed) FeedbackNotice(R.string.history_failed,error=true,retry={vm.refresh()})
    if (!current || !state.loaded) return
    val activity = state.activity
    // Nothing recorded and nothing recent: the empty state below says it better than a card of zeroes.
    if (activity != null && (rows.isNotEmpty() || activity.isNotEmpty())) {
        val summary = remember(activity) { activitySummary(activity, LocalDate.now(zone), zone) }
        ActivityCard(summary, self, zone, share?.let { {it(patient, summary.card())} })
    }
    if (rows.isEmpty()) EmptyState(R.string.no_sessions,R.string.history_empty)
    else {
        trackingConcern(rows)?.let { CautionNotice(stringResource(if (self) R.string.history_tracking_self else R.string.history_tracking, it.unusable, it.of)) }
        rehabilitationProgress(rows).forEach { series ->
            ClinicalCard {
                ExerciseHeading(series.prescription, series.key.side)
                val card = series.card()
                if (share != null && card != null) TextButton({ share(patient, card) }, Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.chat_cards_share)) }
                if (!self) Text(stringResource(R.string.history_technical, series.key.metric, series.key.model),
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (series.points.none { it.rom != null }) Text(stringResource(R.string.history_no_chart))
                else {
                    Outcome(series.outcome())
                    val first = shortDate(series.points.first().session.startedAt, zone)
                    val last = shortDate(series.points.last().session.startedAt, zone)
                    TrendChart(series.points.map { it.rom }, R.string.rom_progression, R.string.history_degrees, "°", first, last)
                    TrendChart(series.points.map { it.repetitions?.toDouble() }, R.string.history_rep_trend, R.string.history_repetitions, "", first, last)
                    Text(stringResource(R.string.history_chart_order), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        Text(stringResource(R.string.synced_results), style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
        Text(stringResource(R.string.history_loaded, rows.size), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        rows.forEach { SessionResult(it, self, zone, videoFor(it.id), link) }
        if (state.next != null) ActionButton(R.string.history_older,{vm.loadOlder()},busy=state.loading,busyLabel=R.string.ui_loading_older)
        else Text(stringResource(R.string.history_end), style = MaterialTheme.typography.bodySmall)
        Text(stringResource(R.string.history_comparability), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable private fun HistoryChoice(label: Int, options: List<Pair<String, String>>, selected: String, choose: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        OutlinedButton({ expanded = true }, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp), shape=MaterialTheme.shapes.small) {
            Text(stringResource(R.string.history_filter_value, stringResource(label),
                options.firstOrNull { it.first == selected }?.second ?: stringResource(R.string.history_select)))
        }
        DropdownMenu(expanded, { expanded = false }) {
            options.forEach { (id, name) -> DropdownMenuItem(text = { Text(name) }, onClick = { choose(id); expanded = false }) }
        }
    }
}

private fun LinkedPatient.shownName() = name.ifBlank { id.take(8) }

/** The patient choice, with each patient's face beside their name, or their initials (#174). The name is what is read. */
@Composable internal fun PatientChoice(patients: List<LinkedPatient>, selected: String, choose: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    val current = patients.firstOrNull { it.id == selected }
    Box {
        OutlinedButton({ expanded = true }, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp), shape = MaterialTheme.shapes.small) {
            if (current != null) {
                PersonAvatar(current.photoUrl, current.shownName(), 28.dp, decorative = true)
                Spacer(Modifier.width(8.dp))
            }
            Text(stringResource(R.string.history_filter_value, stringResource(R.string.select_patient),
                current?.shownName() ?: stringResource(R.string.history_select)), Modifier.weight(1f, fill = false))
        }
        DropdownMenu(expanded, { expanded = false }) {
            patients.forEach { person ->
                DropdownMenuItem(text = { Text(person.shownName()) }, onClick = { choose(person.id); expanded = false },
                    leadingIcon = { PersonAvatar(person.photoUrl, person.shownName(), 32.dp, decorative = true) })
            }
        }
    }
}

/** Whose results these are: the chosen patient's face and full name, opening their record when [open] is given (#174). */
@Composable internal fun ProgressPatientHeader(patient: LinkedPatient, open: (() -> Unit)?) {
    val body: @Composable RowScope.() -> Unit = {
        PersonAvatar(patient.photoUrl, patient.shownName(), 56.dp, decorative = true)
        Column(Modifier.weight(1f)) {
            Text(patient.shownName(), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            if (open != null) Text(stringResource(R.string.progress_open_record), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary)
        }
    }
    val row = Modifier.fillMaxWidth().heightIn(min = 56.dp).testTag("progress_patient")
    if (open != null) Surface(onClick = open, shape = MaterialTheme.shapes.medium, color = Color.Transparent, modifier = row) {
        Row(Modifier.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp), content = body)
    } else Row(row.semantics(mergeDescendants = true) {}.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp), content = body)
}

/** A large figure under a quiet label, read as one phrase by a screen reader. */
@Composable private fun Stat(label: String, value: String, detail: String?, modifier: Modifier = Modifier) {
    Column(modifier.semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        if (detail != null) Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** Amber is the design system's caution colour; the icon and the words carry the meaning without it. */
@Composable private fun CautionNotice(text: String) {
    Surface(color = Motion.Amber.copy(alpha = .16f), shape = MaterialTheme.shapes.medium) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(Icons.Default.Warning, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurface)
            Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
        }
    }
}

/**
 * How regularly someone has exercised lately. A patient reads it as encouragement, so it shows their streak.
 * A therapist reads it to decide who needs a call, so it shows how long ago the last session was.
 */
@Composable private fun ActivityCard(summary: ActivitySummary, self: Boolean, zone: ZoneId, share: (() -> Unit)? = null) {
    val difference = summary.week - summary.previousWeek
    val compared = when {
        difference == 0 -> stringResource(R.string.activity_week_same)
        difference > 0 -> stringResource(R.string.activity_week_more, difference)
        else -> stringResource(R.string.activity_week_fewer, -difference)
    }
    val since = summary.daysSinceLast
    val last = when (since) {
        null -> stringResource(R.string.activity_none)
        0 -> stringResource(R.string.activity_today)
        1 -> stringResource(R.string.activity_yesterday)
        else -> stringResource(R.string.activity_days_ago, since)
    }
    ClinicalCard {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(stringResource(if (self) R.string.activity_title_self else R.string.activity_title), style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.semantics { heading() })
            Text(stringResource(R.string.activity_detail), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Stat(stringResource(R.string.activity_week), summary.week.toString(), compared, Modifier.weight(1f))
            Stat(stringResource(R.string.activity_active_days), summary.activeDays.toString(),
                stringResource(R.string.activity_active_days_detail, ACTIVITY_DAYS), Modifier.weight(1f))
        }
        if (self) Stat(stringResource(R.string.activity_streak), summary.streak.toString(),
            if (summary.lastAt != null) stringResource(R.string.activity_last_on, last) else stringResource(R.string.activity_streak_start))
        else Stat(stringResource(R.string.activity_last), last, summary.lastAt?.let { date(it, zone) })
        if (share != null) TextButton(share, Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.chat_cards_share)) }
        DayStrip(summary)
        if (!self && (since == null || since >= QUIET_DAYS)) CautionNotice(
            if (since == null) stringResource(R.string.activity_quiet_none) else stringResource(R.string.activity_quiet, since))
    }
}

/** One bar a day, oldest first, in four weeks of seven. Height carries the count, so it reads without colour. */
@Composable private fun DayStrip(summary: ActivitySummary) {
    val bar = MaterialTheme.colorScheme.primary
    val rest = MaterialTheme.colorScheme.outline
    val description = stringResource(R.string.activity_strip, summary.activeDays, ACTIVITY_DAYS)
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Canvas(Modifier.fillMaxWidth().height(44.dp).semantics { contentDescription = description }) {
            val gap = 3.dp.toPx()
            val weekGap = 8.dp.toPx()
            val width = (size.width - weekGap * 3 - gap * 24) / ACTIVITY_DAYS
            summary.days.forEachIndexed { index, day ->
                val x = index * width + (index - index / 7) * gap + (index / 7) * weekGap
                val height = if (day.sessions == 0) 5.dp.toPx() else size.height * (minOf(day.sessions, 3) + 1) / 4f
                drawRoundRect(if (day.sessions == 0) rest else bar, Offset(x, size.height - height), Size(width, height), CornerRadius(2.dp.toPx()))
            }
        }
        Row(Modifier.fillMaxWidth().clearAndSetSemantics {}, horizontalArrangement = Arrangement.SpaceBetween) {
            Text(shortDate(summary.days.first().date), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(stringResource(R.string.activity_today), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** The answer before the chart: where this plan stands now, at its best, and against where it started. */
@Composable private fun Outcome(outcome: SeriesOutcome) {
    val change = outcome.change
    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Stat(stringResource(R.string.history_latest), number(outcome.latest) + "°", null, Modifier.weight(1f))
        Stat(stringResource(R.string.history_best), number(outcome.best) + "°", null, Modifier.weight(1f))
    }
    // A real minus sign, and a plus so that a gain is not read as a bare measurement.
    if (change == null) Stat(stringResource(R.string.history_change), "--", stringResource(R.string.history_change_none))
    else Stat(stringResource(R.string.history_change), (if (change > 0) "+" else if (change < 0) "−" else "") + number(kotlin.math.abs(change)) + "°",
        stringResource(R.string.history_change_help))
}

@Composable private fun ExerciseHeading(p: HistoricalPrescription, side: String = p.side) {
    val name = when (p.algorithm) {
        "elbow-flexion-v1" -> stringResource(R.string.elbow_flexion)
        "shoulder-abduction-v1" -> stringResource(R.string.shoulder_abduction)
        else -> p.exerciseName.ifBlank { stringResource(R.string.history_unknown_exercise) }
    }
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(name + " · " + sideLabel(side), style = MaterialTheme.typography.titleMedium)
        Text(stringResource(R.string.history_version, p.version, p.id.take(8)), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(stringResource(R.string.history_targets, number(p.low), number(p.high), p.targetRepetitions), style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable private fun SessionResult(s: HistoricalSession, self: Boolean, zone: ZoneId, video: SharedVideo? = null, link: (suspend (SharedVideo) -> String?)? = null) {
    val status = s.resultStatus
    ClinicalCard {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(date(s.startedAt, zone), style = MaterialTheme.typography.titleMedium)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (status == HistoryStatus.COMPLETED) StatusPill(stringResource(R.string.history_completed), PillTone.POSITIVE)
                else Text(stringResource(when (status) {
                    HistoryStatus.PARTIAL -> R.string.history_partial
                    HistoryStatus.INTERRUPTED -> R.string.history_interrupted
                    HistoryStatus.EMPTY -> R.string.history_no_measurements
                    else -> R.string.history_invalid
                }), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        s.prescription?.let { ExerciseHeading(it) } ?: Text(stringResource(R.string.history_missing_prescription))
        s.measurements.forEach { m ->
            HorizontalDivider()
            val usable = m.quality in setOf("valid", "limited") && m.validFrames > 0 && m.rom != null
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(if (self) sideLabel(m.side) else m.key + " · " + sideLabel(m.side), style = MaterialTheme.typography.labelLarge)
                Text(stringResource(R.string.history_rom_value, number(m.rom.takeIf { usable })), style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
                Text(stringResource(R.string.history_rep_value, m.repetitions, s.prescription?.targetRepetitions ?: 0))
                // What a therapist needs to judge the number: where the joint started and stopped, and how well it was tracked.
                if (!self) {
                    Text(stringResource(R.string.history_extrema, number(m.minimum.takeIf { usable }), number(m.maximum.takeIf { usable }), number(m.rom.takeIf { usable })),
                        style = MaterialTheme.typography.bodySmall)
                    Text(stringResource(when (m.quality) { "valid" -> R.string.result_valid; "limited" -> R.string.result_limited; else -> R.string.result_invalid }),
                        style = MaterialTheme.typography.bodySmall)
                    Text(stringResource(R.string.history_counts, m.repetitions, m.incomplete) + "\n" + stringResource(R.string.history_frames, m.validFrames, m.invalidFrames),
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        if (video != null && link != null) {
            HorizontalDivider()
            Text(stringResource(if (self) R.string.video_shared_until else R.string.video_shared_by_patient, sharedUntil(video)),
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            WatchSharedVideo(video, link)
        }
    }
}

/**
 * A plain line of measured values. Gaps stay gaps; nothing is smoothed or filled in, and there is no target band, as on the web.
 * The newest value is written out beside the title, and the axis is labelled, so the line never has to be read by eye alone.
 */
@Composable private fun TrendChart(values: List<Double?>, title: Int, unit: Int, suffix: String, first: String, last: String) {
    val maximum = maxOf(1.0, values.filterNotNull().maxOrNull() ?: 1.0)
    val color = MaterialTheme.colorScheme.primary
    val grid = MaterialTheme.colorScheme.outlineVariant
    val description = stringResource(R.string.history_chart_accessibility, stringResource(title), values.count { it != null }, stringResource(unit), first, last)
    val labels = MaterialTheme.typography.labelSmall
    val quiet = MaterialTheme.colorScheme.onSurfaceVariant
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.Bottom) {
            Text(stringResource(title), style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            values.lastOrNull { it != null }?.let { Text(number(it) + suffix, style = MaterialTheme.typography.titleSmall, color = quiet) }
        }
        Row(Modifier.height(130.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.fillMaxHeight().clearAndSetSemantics {}, verticalArrangement = Arrangement.SpaceBetween, horizontalAlignment = Alignment.End) {
                Text(number(maximum), style = labels, color = quiet)
                Text(number(maximum / 2), style = labels, color = quiet)
                Text("0", style = labels, color = quiet)
            }
            Canvas(Modifier.weight(1f).fillMaxHeight().semantics { contentDescription = description }) {
                val pad = 8.dp.toPx()
                val width = (size.width - 2 * pad).coerceAtLeast(1f)
                val height = (size.height - 2 * pad).coerceAtLeast(1f)
                listOf(0f, .5f, 1f).forEach { drawLine(grid, Offset(0f, pad + height * it), Offset(size.width, pad + height * it)) }
                fun point(index: Int, value: Double) = Offset(pad + if (values.size == 1) width / 2 else width * index / (values.size - 1),
                    pad + height * (1 - value / maximum).toFloat())
                val newest = values.indexOfLast { it != null }
                values.forEachIndexed { i, value ->
                    if (value != null) {
                        val here = point(i, value)
                        if (i > 0) values[i - 1]?.let { drawLine(color, point(i - 1, it), here, 2.5.dp.toPx()) }
                        drawCircle(color, (if (i == newest) 6 else 4).dp.toPx(), here)
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(start = 40.dp).clearAndSetSemantics {}, horizontalArrangement = Arrangement.SpaceBetween) {
            Text(first, style = labels, color = quiet)
            if (values.size > 1) Text(last, style = labels, color = quiet)
        }
    }
}

@Composable private fun sideLabel(side: String) = stringResource(when (side) {
    "left" -> R.string.left_side; "right" -> R.string.right_side; else -> R.string.history_bilateral
})
private fun number(value: Double?) = value?.let { String.format(Locale.getDefault(), "%.1f", it) } ?: "--"
/** The reader's own time, as on the web, so a session shows on the day they did it. */
private fun date(value: String, zone: ZoneId): String = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
    .withLocale(Locale.getDefault()).withZone(zone).format(Instant.parse(value))
private val SHORT_DATE get() = DateTimeFormatter.ofPattern("MMM d", Locale.getDefault())
private fun shortDate(value: String, zone: ZoneId): String = SHORT_DATE.withZone(zone).format(Instant.parse(value))
private fun shortDate(day: LocalDate): String = SHORT_DATE.format(day)
