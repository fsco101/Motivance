package com.motivance.data.remote

import com.motivance.domain.*
import org.json.JSONArray
import org.json.JSONObject

/** Reads the colleague functions' JSON (#173), the same fields web/src/data/colleagues.ts reads. */
object ColleagueJson {
    private fun JSONObject.text(key:String):String?=if(!has(key) || isNull(key)) null else getString(key)
    private fun JSONArray.objects()=(0 until length()).map {getJSONObject(it)}

    fun colleague(j:JSONObject)=Colleague(j.getString("id"),ColleagueState.of(j.getString("state")) ?: ColleagueState.REQUESTED,j.optBoolean("incoming"),
        j.getString("other_id"),j.text("other_name").orEmpty(),j.text("other_photo"),j.text("created_at").orEmpty(),j.text("started_at"))
    fun colleagues(rows:JSONArray)=rows.objects().map(::colleague)

    fun patients(rows:JSONArray)=rows.objects().map {ColleaguePatient(it.getString("id"),it.text("name").orEmpty(),it.text("photo"),it.getString("therapist_id"),it.text("therapist_name").orEmpty())}

    fun opened(j:JSONObject)=OpenedColleaguePatient(j.getString("id"),j.text("name").orEmpty(),j.text("photo"),
        j.optJSONArray("therapists")?.let {a -> (0 until a.length()).map {a.getString(it)}} ?: emptyList())

    fun access(j:JSONObject)=ColleagueAccess(j.optBoolean("sharing"),j.getJSONArray("colleagues").objects().map {
        ColleagueViewer(it.getString("id"),it.text("name").orEmpty(),it.text("photo"),it.text("last_viewed_at"))})

    /** Each active exercise at its newest version, as the plan stands. */
    fun plan(rows:JSONArray)=rows.objects().mapNotNull {row ->
        val latest=row.getJSONArray("prescription_versions").objects().maxByOrNull {it.getInt("version")} ?: return@mapNotNull null
        val name=latest.optJSONObject("exercise")?.optJSONObject("definition")?.optString("name").orEmpty()
        ColleaguePlanItem(row.getString("id"),name,latest.getString("side"),latest.getDouble("minimum_degrees"),latest.getDouble("maximum_degrees"),latest.getInt("target_repetitions"))
    }

    fun links(rows:JSONArray)=rows.objects().map {ColleagueLink(it.getString("id"),ColleagueState.of(it.getString("state")) ?: ColleagueState.REQUESTED,
        it.getString("first_id"),it.text("first_name").orEmpty(),it.getString("second_id"),it.text("second_name").orEmpty())}
}
