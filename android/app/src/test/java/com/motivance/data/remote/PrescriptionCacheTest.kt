package com.motivance.data.remote

import com.motivance.data.local.ExerciseJson
import com.motivance.domain.*
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test

class PrescriptionCacheTest {
    private fun fixture(owner:String="patient",algorithm:String="elbow-flexion-v1")=JSONArray("""[{"id":"assignment","patient_id":"$owner","prescription_versions":[{"id":"version1","version":1,"side":"left","minimum_degrees":20,"maximum_degrees":90,"target_repetitions":5,"exercise_versions":{"id":"exercise-v1","algorithm_key":"$algorithm","definition":{"measurement_convention":"2d_flexion_degrees","instructions_en":"Fixture instruction"}}}]}]""")
    @Test fun recognizedPrescriptionRetainsImmutableVersionAndInstructions() {
        val result=PrescriptionCache.decode("patient",fixture(),100).single()
        val rules=ExerciseJson.rules(result.rulesJson)
        assertFalse(rules.demo); assertEquals("version1",rules.prescriptionVersionId)
        assertEquals("Fixture instruction",result.instructions)
        assertEquals(100L+24*60*60*1000,result.expiresAt)
    }
    @Test fun crossAccountAndUnknownAlgorithmsAreNotCached() {
        assertTrue(PrescriptionCache.decode("other",fixture(),100).isEmpty())
        assertTrue(PrescriptionCache.decode("patient",fixture(algorithm="unsupported"),100).isEmpty())
    }
    @Test fun versionedTimingRulesAndDownloadTimeArePinnedIntoCache() {
        val rows=fixture();val version=rows.getJSONObject(0).getJSONArray("prescription_versions").getJSONObject(0)
        version.put("parameters",org.json.JSONObject().put("minimum_cycle_ms",1200).put("maximum_cycle_ms",20000).put("peak_hold_ms",500).put("max_trunk_lean_degrees",15))
        val cached=PrescriptionCache.decode("patient",rows,1234).single();val rules=ExerciseJson.rules(cached.rulesJson)
        assertEquals(1200L,rules.minimumCycleMs);assertEquals(500L,rules.peakHoldMs);assertEquals(15.0,rules.maxTrunkLeanDegrees,.001);assertEquals(1234L,cached.cachedAt)
    }
    @Test fun snapshotRoundTripPreservesUnknownAnglesAndTotals() {
        val initial=AssessmentSnapshot(completed=2,incomplete=1,durationMs=1234,minimumDegrees=null,maximumDegrees=null,failureReasons=mapOf(RepFeedback.TOO_FAST to 1))
        val decoded=ExerciseJson.snapshot(ExerciseJson.snapshot(initial))
        assertEquals(2,decoded.completed); assertEquals(1234L,decoded.durationMs); assertNull(decoded.romDegrees)
        assertEquals(initial.failureReasons,decoded.failureReasons)
    }
}
