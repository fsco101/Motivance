package com.motivance.data.remote

import com.motivance.domain.*
import java.time.LocalDate
import java.util.UUID
import kotlinx.coroutines.runBlocking
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class HistoryRepositoryTest {
    private val owner = "10000000-0000-0000-0000-000000000001"
    private val exercise = "21000000-0000-0000-0000-000000000001"

    private fun row(id: String = UUID.randomUUID().toString()) = JSONObject("""{
        "id":"$id","patient_id":"$owner","started_at":"2026-01-01T12:00:00+00:00","ended_at":"2026-01-01T12:01:00+00:00",
        "status":"completed","model_version":"model-v1","algorithm_version":"algorithm-v1",
        "prescription":{"id":"old-version","assignment_id":"assignment","version":1,"exercise_version_id":"$exercise",
        "side":"left","minimum_degrees":20,"maximum_degrees":90,"target_repetitions":5,
        "exercise":{"algorithm_key":"elbow-flexion-v1","definition":{"name":"Elbow"}}},
        "session_measurements":[{"metric_key":"elbow","side":"left","minimum_degrees":10,"maximum_degrees":100,
        "completed_repetitions":3,"incomplete_repetitions":1,"quality":"valid","valid_frames":40,"invalid_frames":2},
        {"metric_key":"second","side":"right","minimum_degrees":null,"maximum_degrees":null,
        "completed_repetitions":0,"incomplete_repetitions":0,"quality":"invalid","valid_frames":0,"invalid_frames":20}]}""")

    @Test fun queryScopesPatientAndFiltersPrescriptionWithInclusiveUtcDateBoundaries() {
        val q = HistoryQuery(owner, exercise, "left", LocalDate.parse("2026-01-01"), LocalDate.parse("2026-01-31"))
        val cursor = HistoryCursor("2026-01-15T12:00:00+00:00", UUID.randomUUID().toString())
        val url = ("https://fixture.invalid" + HistoryJson.path(q, cursor)).toHttpUrl()
        assertEquals("eq.$owner", url.queryParameter("patient_id"))
        assertEquals("eq.$exercise", url.queryParameter("prescription.exercise_version_id"))
        assertEquals("eq.left", url.queryParameter("prescription.side"))
        assertEquals(listOf("gte.2026-01-01T00:00:00Z", "lt.2026-02-01T00:00:00Z"), url.queryParameterValues("started_at"))
        assertEquals("started_at.desc,id.desc", url.queryParameter("order"))
        assertEquals("51", url.queryParameter("limit"))
        assertTrue(url.queryParameter("or")!!.contains("id.lt.${cursor.id}"))
        assertTrue(url.queryParameter("select")!!.contains("!sessions_prescription_version_id_patient_id_fkey!inner"))
    }

    @Test fun pagesKeepAllMeasurementsAndThePinnedHistoricalTargets() {
        val page = HistoryJson.decode(JSONArray().put(row()).toString())
        val s = page.sessions.single()
        assertEquals(2, s.measurements.size)
        assertEquals(90.0, s.prescription!!.high, 0.0)
        assertEquals(1, s.prescription!!.version)
        assertEquals(HistoryStatus.PARTIAL, s.resultStatus)
        assertEquals(90.0, s.measurements.first().rom!!, 0.0)
        assertNull(s.measurements.last().rom)
        assertNull(page.next)
    }

    @Test fun lookaheadIsNotConsumedAndCursorUsesTheLastVisibleRow() {
        val array = JSONArray()
        repeat(51) { array.put(row()) }
        val page = HistoryJson.decode(array.toString())
        assertEquals(50, page.sessions.size)
        assertEquals(array.getJSONObject(49).getString("id"), page.next!!.id)
        assertFalse(page.sessions.any { it.id == array.getJSONObject(50).getString("id") })
        assertNull(HistoryJson.decode("[]").next)
    }

    @Test fun sessionsWithoutMeasurementsOrReadableExerciseDetailsRemainVisible() {
        val raw = row().put("session_measurements", JSONArray())
        raw.getJSONObject("prescription").put("exercise", JSONObject.NULL)
        val s = HistoryJson.decode(JSONArray().put(raw).toString()).sessions.single()
        assertEquals(HistoryStatus.EMPTY, s.resultStatus)
        assertEquals(90.0, s.prescription!!.high, 0.0)
        assertEquals("", s.prescription!!.exerciseName)
    }

    @Test fun repositoryUsesAuthenticatedHistoryAndPropagatesDeniedAccess() = runBlocking {
        val requests = mutableListOf<Request>()
        var denied = false
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val r = chain.request(); requests += r
            val body = when (r.url.encodedPath) {
                "/rest/v1/user_roles" -> """[{"role":"therapist"}]"""
                "/rest/v1/sessions" -> JSONArray().put(row()).toString()
                else -> """{"access_token":"a","refresh_token":"r","user":{"id":"$owner"}}"""
            }
            Response.Builder().request(r).protocol(Protocol.HTTP_1_1).code(if (denied) 403 else 200).message("fixture")
                .body(body.toResponseBody("application/json".toMediaType())).build()
        }.build()
        val repository = SupabaseAuthRepository(client, "https://fixture.invalid", "public-fixture")
        repository.signIn("fixture@example.test", "fixture")
        assertEquals(1, repository.loadHistory(HistoryQuery(owner)).sessions.size)
        assertEquals("Bearer a", requests.last().header("Authorization"))
        denied = true
        val error = runCatching { repository.loadHistory(HistoryQuery(owner)) }.exceptionOrNull()
        assertTrue(error is RemoteFailure && error.status == 403)
    }
}
