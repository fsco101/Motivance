package com.motivance.data.remote

import com.motivance.domain.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId

internal object HistoryJson {
    const val PAGE_SIZE = 50
    // Name the composite FK explicitly. Never join against an assignment's current version.
    const val SELECT = "id,patient_id,started_at,ended_at,status,model_version,algorithm_version," +
        "prescription:prescription_versions!sessions_prescription_version_id_patient_id_fkey!inner(" +
        "id,assignment_id,version,exercise_version_id,side,minimum_degrees,maximum_degrees,target_repetitions," +
        "exercise:exercise_versions(algorithm_key,definition))," +
        "session_measurements(metric_key,side,minimum_degrees,maximum_degrees,completed_repetitions," +
        "incomplete_repetitions,quality,valid_frames,invalid_frames)"

    /** Filtering by side means the side measured, so a both-sides plan's sessions each file under their own side. */
    fun select(query: HistoryQuery) = if (query.side == null) SELECT else "$SELECT,measured:session_measurements!inner(side)"

    /** Dates are calendar days in [zone], the reader's own, so a filter agrees with the local times on screen, as on the web. */
    fun path(query: HistoryQuery, cursor: HistoryCursor?, zone: ZoneId = ZoneId.systemDefault()): String {
        val url = "https://history.invalid/rest/v1/sessions".toHttpUrl().newBuilder()
            .addQueryParameter("select", select(query))
            .addQueryParameter("patient_id", "eq.${query.patientId}")
            .addQueryParameter("order", "started_at.desc,id.desc")
            .addQueryParameter("limit", (PAGE_SIZE + 1).toString())
        query.exerciseVersionId?.let { url.addQueryParameter("prescription.exercise_version_id", "eq.$it") }
        query.side?.let { url.addQueryParameter("measured.side", "eq.$it") }
        query.from?.let { url.addQueryParameter("started_at", "gte.${it.atStartOfDay(zone).toInstant()}") }
        query.through?.let { url.addQueryParameter("started_at", "lt.${it.plusDays(1).atStartOfDay(zone).toInstant()}") }
        cursor?.let { url.addQueryParameter("or", "(started_at.lt.${it.startedAt},and(started_at.eq.${it.startedAt},id.lt.${it.id}))") }
        val built = url.build()
        return built.encodedPath + "?" + built.encodedQuery
    }

    /** A patient exercising three times a day for four weeks stays well inside this. */
    const val ACTIVITY_LIMIT = 500

    fun activityPath(patientId: String, since: Instant): String {
        java.util.UUID.fromString(patientId)
        val built = "https://history.invalid/rest/v1/sessions".toHttpUrl().newBuilder()
            .addQueryParameter("select", "started_at,status")
            .addQueryParameter("patient_id", "eq.$patientId")
            .addQueryParameter("started_at", "gte.$since")
            .addQueryParameter("order", "started_at.desc")
            .addQueryParameter("limit", ACTIVITY_LIMIT.toString()).build()
        return built.encodedPath + "?" + built.encodedQuery
    }

    fun decodeActivity(raw: String): List<SessionActivity> = JSONArray(raw).let { rows ->
        (0 until rows.length()).map { rows.getJSONObject(it).let { row -> SessionActivity(row.getString("started_at"), row.getString("status")) } }
    }

    fun decode(raw: String): HistoryPage {
        val array = JSONArray(raw)
        val rows = (0 until minOf(array.length(), PAGE_SIZE)).map { index ->
            val s = array.getJSONObject(index)
            val p = s.optJSONObject("prescription")
            val exercise = p?.optJSONObject("exercise")
            val prescription = p?.let {
                HistoricalPrescription(it.getString("id"), it.getString("assignment_id"), it.getInt("version"),
                    it.getString("exercise_version_id"), exercise?.optJSONObject("definition")?.optString("name").orEmpty(),
                    exercise?.optString("algorithm_key").orEmpty(), it.getString("side"), it.getDouble("minimum_degrees"),
                    it.getDouble("maximum_degrees"), it.getInt("target_repetitions"))
            }
            val measurements = s.getJSONArray("session_measurements")
            HistoricalSession(s.getString("id"), s.getString("patient_id"), s.getString("started_at"),
                s.getString("ended_at"), s.getString("status"), s.getString("model_version"), s.getString("algorithm_version"),
                prescription, (0 until measurements.length()).map { m ->
                    val v = measurements.getJSONObject(m)
                    HistoricalMeasurement(v.getString("metric_key"), v.getString("side"), v.numberOrNull("minimum_degrees"),
                        v.numberOrNull("maximum_degrees"), v.getInt("completed_repetitions"), v.getInt("incomplete_repetitions"),
                        v.getString("quality"), v.getInt("valid_frames"), v.getInt("invalid_frames"))
                })
        }
        return HistoryPage(rows, rows.lastOrNull()?.takeIf { array.length() > PAGE_SIZE }?.let { HistoryCursor(it.startedAt, it.id) })
    }

    private fun JSONObject.numberOrNull(key: String): Double? = if (isNull(key)) null else getDouble(key).takeIf { it.isFinite() }
}
