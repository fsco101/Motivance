package com.motivance.data.remote

import com.motivance.data.local.CachedPrescription
import com.motivance.data.local.ExerciseJson
import com.motivance.domain.*
import org.json.JSONArray

object PrescriptionCache {
    fun decode(owner:String,rows:JSONArray,now:Long):List<CachedPrescription> = (0 until rows.length()).mapNotNull { index ->
        val assignment=rows.getJSONObject(index)
        if(assignment.getString("patient_id")!=owner) return@mapNotNull null
        val versions=assignment.optJSONArray("prescription_versions") ?: return@mapNotNull null
        val version=(0 until versions.length()).map {versions.getJSONObject(it)}.maxByOrNull {it.getInt("version")} ?: return@mapNotNull null
        val exercise=version.optJSONObject("exercise_versions") ?: return@mapNotNull null
        val definition=exercise.optJSONObject("definition") ?: return@mapNotNull null
        val kind=when(exercise.getString("algorithm_key")) {
            "elbow-flexion-v1" -> ExerciseKind.ELBOW_FLEXION
            "shoulder-abduction-v1" -> ExerciseKind.SHOULDER_ABDUCTION
            else -> return@mapNotNull null
        }
        val convention=if(kind==ExerciseKind.ELBOW_FLEXION) "2d_flexion_degrees" else "2d_abduction_degrees"
        if(definition.optString("measurement_convention")!=convention) return@mapNotNull null
        val side=when(version.getString("side")) { "left" -> BodySide.LEFT; "right" -> BodySide.RIGHT; else -> return@mapNotNull null }
        val english=definition.optString("instructions_en").ifBlank {definition.optJSONObject("instructions")?.optString("en").orEmpty()}
        if(english.isBlank()) return@mapNotNull null
        // Keep both authored translations in the same immutable cached text, available offline
        // even after a language change. Legacy English-only versions remain identifiable as such.
        val filipino=definition.optString("instructions_fil")
        val instructions=if(filipino.isBlank()) english else "English:\n$english\n\nFilipino:\n$filipino"
        val parameters=version.optJSONObject("parameters") ?: org.json.JSONObject()
        val rules=runCatching {ExerciseRules(kind=kind,side=side,lowDegrees=version.getDouble("minimum_degrees"),highDegrees=version.getDouble("maximum_degrees"),targetRepetitions=version.getInt("target_repetitions"),confidence=parameters.optDouble("confidence",.7).toFloat(),minimumCycleMs=parameters.optLong("minimum_cycle_ms",600),maximumCycleMs=parameters.optLong("maximum_cycle_ms",30000),peakHoldMs=parameters.optLong("peak_hold_ms",100),maxTrunkLeanDegrees=parameters.optDouble("max_trunk_lean_degrees",20.0),version=exercise.getString("id"),prescriptionVersionId=version.getString("id"),demo=false,focusJoint=if(parameters.has("focus_joint")) BodyJoint.valueOf(parameters.getString("focus_joint")) else kind.measurementJoint)}.getOrNull() ?: return@mapNotNull null
        CachedPrescription(owner,version.getString("id"),assignment.getString("id"),owner,ExerciseJson.rules(rules),instructions,now+24*60*60*1000,now)
    }
}
