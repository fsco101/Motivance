package com.motivance.data.remote

import com.motivance.data.local.ExerciseJson
import com.motivance.domain.*
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test

/**
 * What the web app publishes must run on the phone unchanged. The fixture is the real server response for prescriptions
 * published through the web code, with IDs normalised; web/tests/contract/crossApp.test.ts fails if it goes stale.
 */
class WebPublishedPrescriptionTest {
    private val rows=JSONArray(javaClass.classLoader!!.getResource("web-published-prescriptions.json")!!.readText())
    private val cached=PrescriptionCache.decode("patient",rows,100)
    private fun rules(version:String)=ExerciseJson.rules(cached.single {it.versionId==version}.rulesJson)

    @Test fun androidDecodesEveryPrescriptionTheWebPublished() {
        assertEquals(setOf("standard-version","custom-version"),cached.map {it.versionId}.toSet())
    }

    @Test fun aStandardExerciseKeepsItsTargetsAndTiming() {
        val r=rules("standard-version")
        assertEquals(ExerciseKind.ELBOW_FLEXION,r.kind)
        assertEquals(BodySide.RIGHT,r.side)
        assertEquals(25.0,r.lowDegrees,.001)
        assertEquals(110.0,r.highDegrees,.001)
        assertEquals(6,r.targetRepetitions)
        assertEquals(750L,r.minimumCycleMs)
        assertEquals(20000L,r.maximumCycleMs)
        assertEquals(250L,r.peakHoldMs)
        assertEquals(15.0,r.maxTrunkLeanDegrees,.001)
        assertEquals(.7f,r.confidence,.001f)
        assertEquals(BodyJoint.KNEE,r.focusJoint)
        assertFalse(r.demo)
    }

    @Test fun aCustomExerciseKeepsItsNameAndJoint() {
        val r=rules("custom-version")
        assertEquals(ExerciseKind.CUSTOM,r.kind)
        assertEquals("Seated knee extension",r.exerciseName)
        assertEquals(BodyJoint.KNEE,r.measuredJoint)
        assertEquals(BodyJoint.KNEE,r.focusJoint)
        // Published by the web as both sides with a time per side: the phone starts on the left.
        assertEquals(BodySide.LEFT,r.side)
        assertTrue(r.bilateral)
        assertEquals(90,r.sideSeconds)
    }

    @Test fun bothLanguagesReachThePatient() {
        val text=cached.single {it.versionId=="custom-version"}.instructions
        assertTrue(text.contains("Sit tall"))
        assertTrue(text.contains("Umupo nang tuwid"))
    }
}
