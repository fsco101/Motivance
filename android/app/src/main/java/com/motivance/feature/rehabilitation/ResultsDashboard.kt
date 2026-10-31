package com.motivance.feature.rehabilitation

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.motivance.R
import com.motivance.domain.*
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

@Composable
fun ColumnScope.ResultsDashboard(workspace: RehabWorkspace, owner: String, patientId: String?, vm: HistoryViewModel) {
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

    Text(stringResource(R.string.history_filters), style = MaterialTheme.typography.titleLarge)
    if (patientId == null) HistoryChoice(R.string.select_patient,
        workspace.patients.filter { it.id != owner }.map { it.id to it.name.ifBlank { it.id.take(8) } }, patient) { patient = it }
    val exercises = (workspace.catalogue.map { it.id to it.name } + rows.mapNotNull { it.prescription }
        .map { it.exerciseVersionId to it.exerciseName }).distinctBy { it.first }
    HistoryChoice(R.string.select_exercise, listOf("" to stringResource(R.string.history_all_exercises)) +
        exercises.map { it.first to (it.second.ifBlank { stringResource(R.string.history_unknown_exercise) } + " · " + it.first.take(8)) }, exercise) { exercise = it }
    HistoryChoice(R.string.history_side, listOf("" to stringResource(R.string.history_all_sides),
        "left" to stringResource(R.string.left_side), "right" to stringResource(R.string.right_side),
        "bilateral" to stringResource(R.string.history_bilateral)), side) { side = it }
    OutlinedTextField(from, { from = it }, label = { Text(stringResource(R.string.history_from)) },
        singleLine = true, isError = validDates == null, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(through, { through = it }, label = { Text(stringResource(R.string.history_through)) },
        singleLine = true, isError = validDates == null, modifier = Modifier.fillMaxWidth())
    Text(stringResource(R.string.history_date_help), style = MaterialTheme.typography.bodySmall)
    if (validDates == null) Text(stringResource(R.string.history_date_error), color = MaterialTheme.colorScheme.error)
    if (query == null) {
        if (patient.isBlank()) Text(stringResource(R.string.history_choose_patient))
        return
    }
    val current = state.owner == owner && state.query == query
    if (current && state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
    OutlinedButton({ vm.refresh() }, enabled = current && !state.loading) { Text(stringResource(R.string.history_refresh)) }
    if (current && state.failed) Text(stringResource(R.string.history_failed), color = MaterialTheme.colorScheme.error)
    if (!current || !state.loaded) return
    Text(stringResource(R.string.history_loaded, rows.size), style = MaterialTheme.typography.bodySmall)
    if (rows.isEmpty()) Text(stringResource(R.string.history_empty))
    else {
        Text(stringResource(R.string.history_comparability), style = MaterialTheme.typography.bodySmall)
        rehabilitationProgress(rows).forEach { series ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    ExerciseHeading(series.prescription)
                    Text(stringResource(R.string.history_series, series.key.metric, series.key.model, series.key.algorithm),
                        style = MaterialTheme.typography.bodySmall)
                    if (series.points.none { it.rom != null }) Text(stringResource(R.string.history_no_chart))
                    else {
                        TrendChart(series.points.map { it.rom }, R.string.rom_progression, R.string.history_degrees)
                        TrendChart(series.points.map { it.repetitions?.toDouble() }, R.string.history_rep_trend, R.string.history_repetitions)
                        Text(stringResource(R.string.history_chart_dates, date(series.points.first().session.startedAt),
                            date(series.points.last().session.startedAt)), style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
        Text(stringResource(R.string.synced_results), style = MaterialTheme.typography.titleLarge)
        rows.forEach { SessionResult(it) }
        if (state.next != null) Button({ vm.loadOlder() }, enabled = !state.loading) { Text(stringResource(R.string.history_older)) }
        else Text(stringResource(R.string.history_end), style = MaterialTheme.typography.bodySmall)
    }
}

@Composable private fun HistoryChoice(label: Int, options: List<Pair<String, String>>, selected: String, choose: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        OutlinedButton({ expanded = true }, modifier = Modifier.heightIn(min = 48.dp)) {
            Text(stringResource(R.string.history_filter_value, stringResource(label),
                options.firstOrNull { it.first == selected }?.second ?: stringResource(R.string.history_select)))
        }
        DropdownMenu(expanded, { expanded = false }) {
            options.forEach { (id, name) -> DropdownMenuItem(text = { Text(name) }, onClick = { choose(id); expanded = false }) }
        }
    }
}

@Composable private fun ExerciseHeading(p: HistoricalPrescription) {
    val name = when (p.algorithm) {
        "elbow-flexion-v1" -> stringResource(R.string.elbow_flexion)
        "shoulder-abduction-v1" -> stringResource(R.string.shoulder_abduction)
        else -> p.exerciseName.ifBlank { stringResource(R.string.history_unknown_exercise) }
    }
    Text(name + " · " + sideLabel(p.side), style = MaterialTheme.typography.titleMedium)
    Text(stringResource(R.string.history_version, p.version, p.id.take(8)), style = MaterialTheme.typography.labelLarge)
    Text(stringResource(R.string.history_targets, number(p.low), number(p.high), p.targetRepetitions))
}

@Composable private fun SessionResult(s: HistoricalSession) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(date(s.startedAt), style = MaterialTheme.typography.titleMedium)
            Text(stringResource(when (s.resultStatus) {
                HistoryStatus.COMPLETED -> R.string.history_completed
                HistoryStatus.PARTIAL -> R.string.history_partial
                HistoryStatus.INTERRUPTED -> R.string.history_interrupted
                HistoryStatus.EMPTY -> R.string.history_no_measurements
                HistoryStatus.INVALID -> R.string.history_invalid
            }))
            s.prescription?.let { ExerciseHeading(it) } ?: Text(stringResource(R.string.history_missing_prescription))
            s.measurements.forEach { m ->
                HorizontalDivider()
                Text(m.key + " · " + sideLabel(m.side), style = MaterialTheme.typography.labelLarge)
                Text(stringResource(when (m.quality) { "valid" -> R.string.result_valid; "limited" -> R.string.result_limited; else -> R.string.result_invalid }))
                val usable = m.quality in setOf("valid", "limited") && m.validFrames > 0 && m.rom != null
                Text(stringResource(R.string.history_extrema, number(m.minimum.takeIf { usable }), number(m.maximum.takeIf { usable }), number(m.rom.takeIf { usable })))
                Text(stringResource(R.string.history_counts, m.repetitions, m.incomplete))
                Text(stringResource(R.string.history_frames, m.validFrames, m.invalidFrames), style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable private fun TrendChart(values: List<Double?>, title: Int, unit: Int) {
    val maximum = maxOf(1.0, values.filterNotNull().maxOrNull() ?: 1.0)
    val color = MaterialTheme.colorScheme.primary
    val axis = MaterialTheme.colorScheme.outline
    val description = stringResource(R.string.history_chart_accessibility, stringResource(title), values.count { it != null }, stringResource(unit))
    Text(stringResource(title), style = MaterialTheme.typography.titleSmall)
    Text(stringResource(R.string.history_chart_scale, number(maximum), stringResource(unit)), style = MaterialTheme.typography.bodySmall)
    Canvas(Modifier.fillMaxWidth().height(130.dp).semantics { contentDescription = description }) {
        val pad = 8.dp.toPx()
        val width = (size.width - 2 * pad).coerceAtLeast(1f)
        val height = (size.height - 2 * pad).coerceAtLeast(1f)
        drawLine(axis, Offset(pad, pad), Offset(pad, height + pad))
        drawLine(axis, Offset(pad, height + pad), Offset(width + pad, height + pad))
        fun point(index: Int, value: Double) = Offset(pad + if (values.size == 1) width / 2 else width * index / (values.size - 1),
            pad + height * (1 - value / maximum).toFloat())
        values.forEachIndexed { i, value ->
            if (value != null) {
                val here = point(i, value)
                if (i > 0) values[i - 1]?.let { drawLine(color, point(i - 1, it), here, 2.dp.toPx()) }
                drawCircle(color, 4.dp.toPx(), here)
            }
        }
    }
    Text(stringResource(R.string.history_chart_order), style = MaterialTheme.typography.bodySmall)
}

@Composable private fun sideLabel(side: String) = stringResource(when (side) {
    "left" -> R.string.left_side; "right" -> R.string.right_side; else -> R.string.history_bilateral
})
private fun number(value: Double?) = value?.let { String.format(Locale.getDefault(), "%.1f", it) } ?: "--"
private fun date(value: String): String = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM)
    .withLocale(Locale.getDefault()).withZone(ZoneOffset.UTC).format(Instant.parse(value)) + " UTC"
