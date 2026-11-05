package com.motivance.data.remote

import com.motivance.domain.BodyJoint
import com.motivance.domain.CatalogueExercise
import org.json.JSONArray
import org.json.JSONObject

/** The therapist's exercise list. The embedded parent row is hidden by row-level security once an exercise is retired. */
internal object CatalogueJson {
    const val CUSTOM_ALGORITHM="joint-angle-v1"
    const val SELECT="id,algorithm_key,definition,exercises(id,owner_id)"
    private val supported=setOf("elbow-flexion-v1","shoulder-abduction-v1",CUSTOM_ALGORITHM)

    fun joint(definition:JSONObject)=runCatching {BodyJoint.valueOf(definition.optString("measured_joint"))}.getOrNull()

    fun decode(rows:JSONArray,account:String):List<CatalogueExercise> = (0 until rows.length()).mapNotNull {index ->
        val row=rows.getJSONObject(index)
        val algorithm=row.getString("algorithm_key")
        val definition=row.getJSONObject("definition")
        val custom=algorithm==CUSTOM_ALGORITHM
        val measured=if(custom) joint(definition) else null
        if(algorithm !in supported || (custom && measured==null)) return@mapNotNull null
        val parent=row.optJSONObject("exercises")
        val owner=parent?.takeUnless {it.isNull("owner_id")}?.getString("owner_id")
        CatalogueExercise(row.getString("id"),definition.optString("name",algorithm),algorithm,definition.optString("instructions_en"),
            parent?.optString("id").orEmpty(),custom,parent!=null && (owner==null || owner==account),measured)
    }
}
