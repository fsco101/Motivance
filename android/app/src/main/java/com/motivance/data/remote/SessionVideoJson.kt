package com.motivance.data.remote

import com.motivance.domain.SharedVideo
import org.json.JSONArray
import org.json.JSONObject

/** Reads shared session videos, the same fields web/src/data/sessionVideos.ts reads. */
object SessionVideoJson {
    const val SELECT="id,session_id,patient_id,therapist_id,width,height,duration_ms,media_path,preview_path,shared_at,expires_at"
    private fun JSONObject.text(key:String):String=if(!has(key) || isNull(key)) "" else getString(key)

    fun video(j:JSONObject)=SharedVideo(j.getString("id"),j.getString("session_id"),j.getString("patient_id"),j.getString("therapist_id"),
        j.getInt("width"),j.getInt("height"),j.getLong("duration_ms"),j.getString("media_path"),j.getString("preview_path"),j.text("shared_at"),j.text("expires_at"))

    fun list(rows:JSONArray)=(0 until rows.length()).map {video(rows.getJSONObject(it))}
}
