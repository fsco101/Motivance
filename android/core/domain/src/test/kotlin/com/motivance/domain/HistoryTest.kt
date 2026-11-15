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

    @Test fun outcomeComparesLatestWithFirstAndNeedsTwoMeasuredSessions() {
        fun at(id: String, day: String, maximum: Double?) = session(id, listOf(if (maximum == null) m.copy(quality = "limited") else m.copy(maximum = maximum)))
            .copy(startedAt = "2026-01-${day}T10:00:00Z")
        val outcome = rehabilitationProgress(listOf(at("a", "01", 80.0), at("b", "02", 120.0), at("c", "03", null), at("d", "04", 100.25))).single().outcome()
        assertEquals(SeriesOutcome(70.0, 90.25, 110.0, 20.3, 3), outcome)
        assertNull(rehabilitationProgress(listOf(at("a", "01", 80.0))).single().outcome().change)
        assertEquals(SeriesOutcome(null, null, null, null, 0), rehabilitationProgress(listOf(at("a", "01", null))).single().outcome())
    }

    @Test fun trackingConcernNeedsThreeUnusableAmongTheNewestTenAndIgnoresInterrupted() {
        val bad = session("bad", listOf(m.copy(quality = "invalid")))
        assertNull(trackingConcern(listOf(bad, session(), bad)))
        assertEquals(TrackingConcern(3, 4), trackingConcern(listOf(bad, session(), bad, session("empty", emptyList()))))
        assertNull(trackingConcern(List(5) { session("i$it", emptyList()).copy(status = "interrupted") }))
        assertNull(trackingConcern(List(10) { session("g$it") } + listOf(bad, bad, bad)))
    }

    @Test fun activityCountsCompletedSessionsByLocalDayOverFourWeeks() {
        val zone = java.time.ZoneId.of("Asia/Manila")
        val today = LocalDate.parse("2026-11-15")
        fun on(daysAgo: Long, status: String = "completed", hour: Int = 9) =
            SessionActivity(today.minusDays(daysAgo).atTime(hour, 0).atZone(zone).toInstant().toString(), status)
        val summary = activitySummary(listOf(on(0), on(0, hour = 11), on(1), on(2, "interrupted"), on(8), on(27), on(28)), today, zone)
        assertEquals(ACTIVITY_DAYS, summary.days.size)
        assertEquals(ActivityDay(today, 2), summary.days.last())
        assertEquals(ActivityDay(LocalDate.parse("2026-10-19"), 1), summary.days.first())
        assertEquals(listOf(3, 1, 4, 2, 0), listOf(summary.week, summary.previousWeek, summary.activeDays, summary.streak, summary.daysSinceLast))
        assertEquals(on(0, hour = 11).startedAt, summary.lastAt)
        // 01:00 in Manila is still the day before in UTC: the reader's calendar decides.
        assertEquals(1, activitySummary(listOf(on(0, hour = 1)), today, zone).days.last().sessions)
        activitySummary(listOf(on(1), on(2), on(3)), today, zone).let { assertEquals(3 to 1, it.streak to it.daysSinceLast) }
        activitySummary(listOf(on(2), on(3)), today, zone).let { assertEquals(0 to 2, it.streak to it.daysSinceLast) }
        activitySummary(listOf(on(3, "interrupted"), on(40)), today, zone).let {
            assertEquals(listOf(0, 0, 0, 0), listOf(it.week, it.previousWeek, it.activeDays, it.streak)); assertNull(it.lastAt); assertNull(it.daysSinceLast)
        }
    }
}
