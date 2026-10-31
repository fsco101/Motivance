package com.motivance.domain

import java.time.LocalDate
import org.junit.Assert.*
import org.junit.Test

class HistoryTest {
    private val patient = "10000000-0000-0000-0000-000000000001"
    private val p = HistoricalPrescription("v1", "assignment", 1, "elbow-v1", "Elbow", "elbow-flexion-v1", "left", 20.0, 90.0, 5)
    private val m = HistoricalMeasurement("elbow", "left", 10.0, 100.0, 5, 0, "valid", 40, 2)
    private fun session(id: String = "one", measurement: List<HistoricalMeasurement> = listOf(m)) = HistoricalSession(
        id, patient, "2026-01-01T10:00:00Z", "2026-01-01T10:01:00Z", "completed", "model-v1", "algorithm-v1", p, measurement)

    @Test fun datesAreInclusiveAndInvalidFiltersAreRejected() {
        val day = LocalDate.parse("2026-01-01")
        assertEquals(day, HistoryQuery(patient, from = day, through = day).through)
        assertTrue(runCatching { HistoryQuery(patient, from = day.plusDays(1), through = day) }.isFailure)
        assertTrue(runCatching { HistoryQuery("invalid") }.isFailure)
        assertTrue(runCatching { HistoryQuery(patient, side = "injected") }.isFailure)
        assertTrue(runCatching { HistoryQuery(patient, exerciseVersionId = "x&patient_id=eq.other") }.isFailure)
    }

    @Test fun emptyInterruptedInvalidAndPartialAreDistinct() {
        assertEquals(HistoryStatus.COMPLETED, session().resultStatus)
        assertEquals(HistoryStatus.EMPTY, session(measurement = emptyList()).resultStatus)
        assertEquals(HistoryStatus.INTERRUPTED, session().copy(status = "interrupted").resultStatus)
        assertEquals(HistoryStatus.INVALID, session(measurement = listOf(m.copy(quality = "invalid"))).resultStatus)
        assertEquals(HistoryStatus.PARTIAL, session(measurement = listOf(m.copy(repetitions = 2))).resultStatus)
        assertEquals(HistoryStatus.PARTIAL, session(measurement = listOf(m.copy(incomplete = 1))).resultStatus)
        assertEquals(HistoryStatus.PARTIAL, session(measurement = listOf(m.copy(quality = "limited"))).resultStatus)
    }

    @Test fun invalidExtremaAndZeroTrackingNeverCreateRomPoints() {
        listOf(m.copy(minimum = null, maximum = null), m.copy(minimum = Double.NaN),
            m.copy(maximum = Double.POSITIVE_INFINITY), m.copy(minimum = 101.0),
            m.copy(validFrames = 0), m.copy(quality = "invalid"), m.copy(quality = "limited")).forEach {
            assertFalse(it.chartable)
            assertNull(rehabilitationProgress(listOf(session(measurement = listOf(it)))).single().points.single().rom)
        }
    }

    @Test fun incompatiblePrescriptionsExercisesSidesModelsAlgorithmsAndPatientsNeverShareSeries() {
        val base = session()
        val rows = listOf(base,
            base.copy(id = "new-prescription", prescription = p.copy(id = "v2", version = 2, high = 120.0)),
            base.copy(id = "new-exercise", prescription = p.copy(exerciseVersionId = "shoulder-v1")),
            base.copy(id = "right", prescription = p.copy(side = "right"), measurements = listOf(m.copy(side = "right"))),
            base.copy(id = "model", modelVersion = "model-v2"),
            base.copy(id = "algorithm", algorithmVersion = "algorithm-v2"),
            base.copy(id = "patient", patientId = "patient-b"))
        assertEquals(7, rehabilitationProgress(rows).size)
        assertTrue(rehabilitationProgress(rows).all { it.points.size == 1 })
    }

    @Test fun prescriptionEditsDoNotReplaceHistoricalTargets() {
        val rows = listOf(session(), session("two").copy(prescription = p.copy(id = "v2", version = 2, high = 120.0, targetRepetitions = 10)))
        val series = rehabilitationProgress(rows)
        assertEquals(90.0, series.first { it.prescription.id == "v1" }.prescription.high, 0.0)
        assertEquals(5, series.first { it.prescription.id == "v1" }.prescription.targetRepetitions)
        assertEquals(120.0, series.first { it.prescription.id == "v2" }.prescription.high, 0.0)
    }

    @Test fun chronologicalSeriesRetainGapsAndEveryMetric() {
        val early = session("a").copy(startedAt = "2026-01-01T10:00:00+08:00", measurements = listOf(m, m.copy(key = "second")))
        val missing = session("b", emptyList()).copy(startedAt = "2026-01-01T03:00:00Z")
        val invalid = session("c", listOf(m.copy(quality = "limited"))).copy(startedAt = "2026-01-01T04:00:00Z")
        val interrupted = session("d").copy(startedAt = "2026-01-01T05:00:00Z", status = "interrupted")
        val late = session("e").copy(startedAt = "2026-01-01T06:00:00Z")
        val series = rehabilitationProgress(listOf(late, invalid, early, missing, interrupted))
        assertEquals(2, series.size)
        val elbow = series.single { it.key.metric == "elbow" }.points
        assertEquals(listOf("a", "b", "c", "d", "e"), elbow.map { it.session.id })
        assertEquals(listOf(90.0, null, null, null, 90.0), elbow.map { it.rom })
        assertEquals(listOf(5, null, null, null, 5), elbow.map { it.repetitions })
        assertEquals(listOf(90.0, null, null, null, null), series.single { it.key.metric == "second" }.points.map { it.rom })
    }
}
