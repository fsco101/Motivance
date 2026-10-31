package com.motivance.domain

import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/** Date boundaries are inclusive calendar dates in UTC, independent of the phone time zone. */
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
