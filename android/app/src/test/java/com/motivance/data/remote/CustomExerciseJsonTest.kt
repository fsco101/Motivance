package com.motivance.data.remote

import com.motivance.data.local.ExerciseJson
import com.motivance.domain.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class CustomExerciseJsonTest {
    private fun assignment(definition:String,algorithm:String="joint-angle-v1")=JSONArray("""[{"id":"assignment","patient_id":"patient","prescription_versions":[{"id":"version1","version":1,"side":"right","minimum_degrees":15,"maximum_degrees":80,"target_repetitions":6,"exercise_versions":{"id":"exercise-v1","algorithm_key":"$algorithm","definition":$definition}}]}]""")
    private val knee="""{"name":"Seated knee extension","measurement_convention":"2d_joint_degrees","measured_joint":"KNEE","instructions_en":"Sit tall."}"""

    @Test fun aCustomAssignmentKeepsItsNameAndJointThroughTheCache() {
        val cached=PrescriptionCache.decode("patient",assignment(knee),100).single()
        val rules=ExerciseJson.rules(cached.rulesJson)
        assertEquals(ExerciseKind.CUSTOM,rules.kind)
        assertEquals("Seated knee extension",rules.exerciseName)
        assertEquals(BodyJoint.KNEE,rules.measuredJoint)
        assertEquals(BodyJoint.KNEE,rules.focusJoint)
        assertEquals(rules,ExerciseJson.rules(ExerciseJson.rules(rules)))
    }

    @Test fun aCustomAssignmentThatCannotBeMeasuredIsNotCached() {
        assertTrue(PrescriptionCache.decode("patient",assignment(knee.replace("KNEE","NECK")),100).isEmpty())
        assertTrue(PrescriptionCache.decode("patient",assignment(knee.replace("\"measured_joint\":\"KNEE\",","")),100).isEmpty())
        assertTrue(PrescriptionCache.decode("patient",assignment(knee.replace("2d_joint_degrees","2d_flexion_degrees")),100).isEmpty())
        assertTrue(PrescriptionCache.decode("patient",assignment(knee.replace("Seated knee extension"," ")),100).isEmpty())
    }

    /** The server rejects any recorded rule that is JSON null, so a built-in exercise must omit the custom name entirely. */
    @Test fun builtInRulesCarryNoCustomName() {
        val json=JSONObject(ExerciseJson.rules(ExerciseRules(kind=ExerciseKind.SHOULDER_ABDUCTION)))
        assertFalse(json.has("exerciseName"))
        assertEquals("SHOULDER",json.getString("measuredJoint"))
    }

    @Test fun rulesSavedBeforeCustomExercisesStillLoad() {
        val old=JSONObject(ExerciseJson.rules(ExerciseRules(kind=ExerciseKind.SHOULDER_ABDUCTION)))
        old.remove("measuredJoint"); old.remove("focusJoint")
        val rules=ExerciseJson.rules(old.toString())
        assertEquals(BodyJoint.SHOULDER,rules.measuredJoint)
        assertEquals(BodyJoint.SHOULDER,rules.focusJoint)
    }

    private fun catalogue(vararg rows:String)=JSONArray("[${rows.joinToString(",")}]")
    private fun row(id:String,algorithm:String,definition:String,parent:String)="""{"id":"$id","algorithm_key":"$algorithm","definition":$definition,"exercises":$parent}"""

    @Test fun theCatalogueOffersBuiltInsAndTheTherapistsOwnExercises() {
        val rows=catalogue(row("elbow","elbow-flexion-v1","""{"name":"Elbow flexion"}""","""{"id":"e1","owner_id":null}"""),
            row("mine","joint-angle-v1",knee,"""{"id":"e2","owner_id":"therapist"}"""))
        val list=CatalogueJson.decode(rows,"therapist")
        assertEquals(listOf(true,true),list.map {it.selectable})
        val custom=list.single {it.custom}
        assertEquals(BodyJoint.KNEE,custom.joint)
        assertEquals("e2",custom.exerciseId)
        assertNull(list.single {!it.custom}.joint)
    }

    @Test fun retiredAndOtherTherapistsExercisesStayNamedButCannotBeChosen() {
        val rows=catalogue(row("retired","joint-angle-v1",knee,"null"),row("theirs","joint-angle-v1",knee,"""{"id":"e3","owner_id":"someone-else"}"""))
        val list=CatalogueJson.decode(rows,"therapist")
        assertEquals(listOf("retired","theirs"),list.map {it.id})
        assertTrue(list.none {it.selectable})
        assertTrue(list.all {it.name=="Seated knee extension"})
    }

    @Test fun unsupportedCatalogueRowsAreDropped() {
        val rows=catalogue(row("future","gait-v9","""{"name":"Gait"}""","""{"id":"e4","owner_id":null}"""),
            row("broken","joint-angle-v1",knee.replace("KNEE","NECK"),"""{"id":"e5","owner_id":"therapist"}"""))
        assertTrue(CatalogueJson.decode(rows,"therapist").isEmpty())
    }
}
