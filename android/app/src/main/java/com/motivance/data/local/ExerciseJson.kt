package com.motivance.data.local

import com.motivance.domain.*
import org.json.JSONObject

object ExerciseJson {
    fun rules(r:ExerciseRules)=JSONObject().put("kind",r.kind.name).put("side",r.side.name).put("low",r.lowDegrees).put("high",r.highDegrees).put("target",r.targetRepetitions).put("confidence",r.confidence).put("stableFrames",r.stableFrames).put("minimumCycleMs",r.minimumCycleMs).put("maximumCycleMs",r.maximumCycleMs).put("peakHoldMs",r.peakHoldMs).put("maxTrunkLean",r.maxTrunkLeanDegrees).put("maxSpeed",r.maxSpeedDegreesPerSecond).put("version",r.version).put("prescription",r.prescriptionVersionId ?: JSONObject.NULL).put("demo",r.demo).put("focusJoint",r.focusJoint.name).toString()
    fun rules(value:String):ExerciseRules {
        val j=JSONObject(value)
        return ExerciseRules(ExerciseKind.valueOf(j.getString("kind")),BodySide.valueOf(j.getString("side")),j.getDouble("low"),j.getDouble("high"),j.getInt("target"),j.getDouble("confidence").toFloat(),j.getInt("stableFrames"),j.getLong("minimumCycleMs"),j.getLong("maximumCycleMs"),j.getLong("peakHoldMs"),j.getDouble("maxTrunkLean"),j.getDouble("maxSpeed"),j.getString("version"),if(j.isNull("prescription")) null else j.getString("prescription"),j.getBoolean("demo"),if(j.has("focusJoint")) BodyJoint.valueOf(j.getString("focusJoint")) else ExerciseKind.valueOf(j.getString("kind")).measurementJoint)
    }
    fun snapshot(s:AssessmentSnapshot)=JSONObject().put("time",s.timestampMs).put("angle",s.angleDegrees ?: JSONObject.NULL).put("min",s.minimumDegrees ?: JSONObject.NULL).put("max",s.maximumDegrees ?: JSONObject.NULL).put("completed",s.completed).put("incomplete",s.incomplete).put("duration",s.durationMs).put("valid",s.validFrames).put("invalid",s.invalidFrames).put("reasons",JSONObject(s.failureReasons.mapKeys {it.key.name})).toString()
    fun snapshot(value:String):AssessmentSnapshot {
        val j=JSONObject(value)
        val reasons=j.optJSONObject("reasons")
        return AssessmentSnapshot(timestampMs=j.getLong("time"),angleDegrees=if(j.isNull("angle")) null else j.getDouble("angle"),minimumDegrees=if(j.isNull("min")) null else j.getDouble("min"),maximumDegrees=if(j.isNull("max")) null else j.getDouble("max"),completed=j.getInt("completed"),incomplete=j.getInt("incomplete"),durationMs=j.getLong("duration"),validFrames=j.getInt("valid"),invalidFrames=j.getInt("invalid"),failureReasons=reasons?.keys()?.asSequence()?.associate {RepFeedback.valueOf(it) to reasons.getInt(it)} ?: emptyMap())
    }
}
