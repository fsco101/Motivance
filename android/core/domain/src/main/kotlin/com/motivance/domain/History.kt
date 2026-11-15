package com.motivance.domain

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

/** Date boundaries are inclusive calendar dates where the reader is, as on the web, so filters agree with the times on screen. */
data class HistoryQuery(
    val patientId: String,
    val exerciseVersionId: String? = null,
    val side: String? = null,
    val from: LocalDate? = null,
    val through: LocalDate? = null,
) {
    init {
        UUID.fromString(patientId)
        exerciseVersionId?.let(UUID::fromString)
        require(side == null || side in setOf("left", "right", "bilateral"))
        require(from == null || through == null || from <= through)
        require(through == null || through < LocalDate.MAX)
    }
}

data class HistoryCursor(val startedAt: String, val id: String) {
    init { Instant.parse(startedAt); UUID.fromString(id) }
}

data class HistoricalPrescription(
    val id: String, val assignmentId: String, val version: Int,
    val exerciseVersionId: String, val exerciseName: String, val algorithm: String,
    val side: String, val low: Double, val high: Double, val targetRepetitions: Int,
)

data class HistoricalMeasurement(
    val key: String, val side: String, val minimum: Double?, val maximum: Double?,
    val repetitions: Int, val incomplete: Int, val quality: String,
    val validFrames: Int, val invalidFrames: Int,
) {
    val rom: Double? get() = if (minimum != null && maximum != null && minimum.isFinite() &&
        maximum.isFinite() && maximum >= minimum) (maximum - minimum).takeIf { it.isFinite() } else null
    val chartable: Boolean get() = quality == "valid" && validFrames > 0 && rom != null
}

enum class HistoryStatus { COMPLETED, PARTIAL, INTERRUPTED, EMPTY, INVALID }

data class HistoricalSession(
    val id: String, val patientId: String, val startedAt: String, val endedAt: String,
    val status: String, val modelVersion: String, val algorithmVersion: String,
    val prescription: HistoricalPrescription?, val measurements: List<HistoricalMeasurement>,
) {
    val resultStatus: HistoryStatus get() = when {
        status == "interrupted" -> HistoryStatus.INTERRUPTED
        measurements.isEmpty() -> HistoryStatus.EMPTY
        measurements.none { it.quality in setOf("valid", "limited") && it.rom != null && it.validFrames > 0 } -> HistoryStatus.INVALID
        status != "completed" || prescription == null || measurements.any {
            !it.chartable || it.incomplete > 0 || it.repetitions < prescription.targetRepetitions
        } -> HistoryStatus.PARTIAL
        else -> HistoryStatus.COMPLETED
    }
}

data class HistoryPage(val sessions: List<HistoricalSession>, val next: HistoryCursor?)

/** A prescription change starts a separate series, even when its target values happen to match. */
data class ProgressKey(
    val patientId: String, val exerciseVersionId: String, val prescriptionId: String,
    val side: String, val metric: String, val model: String, val algorithm: String,
)
data class ProgressPoint(val session: HistoricalSession, val measurement: HistoricalMeasurement?) {
    val rom: Double? get() = measurement?.takeIf { session.status == "completed" && it.chartable }?.rom
    val repetitions: Int? get() = measurement?.takeIf { rom != null }?.repetitions
}
data class ProgressSeries(val key: ProgressKey, val prescription: HistoricalPrescription, val points: List<ProgressPoint>)

fun rehabilitationProgress(sessions: List<HistoricalSession>): List<ProgressSeries> = sessions
    .filter { it.prescription != null }
    .groupBy { s ->
        val p = requireNotNull(s.prescription)
        ProgressKey(s.patientId, p.exerciseVersionId, p.id, p.side, "", s.modelVersion, s.algorithmVersion)
    }.flatMap { (base, rows) ->
        rows.flatMap { it.measurements }.map { it.key to it.side }.distinct().map { (metric, side) ->
            ProgressSeries(base.copy(metric = metric, side = side), requireNotNull(rows.first().prescription),
                rows.sortedWith(compareBy<HistoricalSession> { Instant.parse(it.startedAt) }.thenBy { it.id })
                    .map { ProgressPoint(it, it.measurements.firstOrNull { m -> m.key == metric && m.side == side }) })
        }
    }.sortedWith(compareBy<ProgressSeries> { it.prescription.exerciseName }.thenBy { it.key.side }
        .thenBy { it.prescription.assignmentId }.thenBy { it.prescription.version }.thenBy { it.key.metric })

/** What one series says at a glance. A change needs two measured sessions, and never crosses a prescription version. */
data class SeriesOutcome(val first: Double?, val latest: Double?, val best: Double?, val change: Double?, val measured: Int)

/** Mirrors seriesOutcome on the web, including its one decimal place. */
fun ProgressSeries.outcome(): SeriesOutcome {
    val values = points.mapNotNull { it.rom }
    val change = if (values.size > 1) Math.round((values.last() - values.first()) * 10) / 10.0 else null
    return SeriesOutcome(values.firstOrNull(), values.lastOrNull(), values.maxOrNull(), change, values.size)
}

const val TRACKING_WINDOW = 10
const val TRACKING_CONCERN = 3
data class TrackingConcern(val unusable: Int, val of: Int)

/** Repeated sessions with nothing to measure usually mean the camera setup needs help. [sessions] must be newest first. */
fun trackingConcern(sessions: List<HistoricalSession>): TrackingConcern? {
    val recent = sessions.filter { it.status != "interrupted" }.take(TRACKING_WINDOW)
    val unusable = recent.count { it.resultStatus == HistoryStatus.INVALID || it.resultStatus == HistoryStatus.EMPTY }
    return if (unusable >= TRACKING_CONCERN) TrackingConcern(unusable, recent.size) else null
}

const val ACTIVITY_DAYS = 28
data class SessionActivity(val startedAt: String, val status: String)
data class ActivityDay(val date: LocalDate, val sessions: Int)

/** Completed sessions by calendar day over the last four weeks. [days] runs oldest first and ends today. */
data class ActivitySummary(
    val week: Int, val previousWeek: Int, val activeDays: Int, val streak: Int,
    val lastAt: String?, val daysSinceLast: Int?, val days: List<ActivityDay>,
)

/**
 * Mirrors activitySummary on the web. Days are calendar days where the reader is, as everywhere else on screen.
 * An interrupted session is not counted: it is an attempt, not a finished exercise.
 */
fun activitySummary(entries: List<SessionActivity>, today: LocalDate, zone: ZoneId): ActivitySummary {
    val completed = entries.filter { it.status == "completed" }
    val counts = completed.groupingBy { Instant.parse(it.startedAt).atZone(zone).toLocalDate() }.eachCount()
    val days = (ACTIVITY_DAYS - 1 downTo 0).map { today.minusDays(it.toLong()) }.map { ActivityDay(it, counts[it] ?: 0) }
    val newestFirst = days.reversed()
    // Today not done yet does not break a streak that ran through yesterday.
    val run = if (newestFirst.first().sessions > 0) newestFirst else newestFirst.drop(1)
    val sinceLast = newestFirst.indexOfFirst { it.sessions > 0 }.takeIf { it >= 0 }
    return ActivitySummary(
        week = days.takeLast(7).sumOf { it.sessions }, previousWeek = days.dropLast(7).takeLast(7).sumOf { it.sessions },
        activeDays = days.count { it.sessions > 0 }, streak = run.takeWhile { it.sessions > 0 }.size,
        lastAt = sinceLast?.let { completed.maxByOrNull { e -> Instant.parse(e.startedAt) }?.startedAt }, daysSinceLast = sinceLast, days = days,
    )
}
