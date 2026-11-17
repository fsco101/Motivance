package com.motivance.data.remote

import com.motivance.domain.BackendDay
import com.motivance.domain.BackendJob
import com.motivance.domain.BackendStatus
import com.motivance.domain.SizedItem
import org.json.JSONArray
import org.json.JSONObject

/** Reads admin_backend(), the same fields the web app's loadBackend reads. */
object BackendJson {
    private fun JSONObject.text(key:String):String?=if(isNull(key)) null else getString(key)
    private fun <T> JSONArray?.rows(read:(JSONObject)->T):List<T> = if(this==null) emptyList() else (0 until length()).map {read(getJSONObject(it))}

    fun status(j:JSONObject):BackendStatus {
        val plan=j.getJSONObject("plan");val database=j.getJSONObject("database");val storage=j.getJSONObject("storage")
        val deliveries=j.getJSONObject("deliveries");val accounts=j.getJSONObject("accounts")
        return BackendStatus(
            j.getString("generated_at"),plan.getString("name"),plan.getLong("database_bytes"),plan.getLong("storage_bytes"),
            database.getLong("bytes"),database.optJSONArray("tables").rows {SizedItem(it.getString("name"),it.getLong("bytes"))},
            storage.getLong("bytes"),storage.getLong("files"),storage.optJSONArray("buckets").rows {SizedItem(it.getString("bucket"),it.getLong("bytes"),it.getLong("files"))},
            deliveries.getInt("waiting"),deliveries.text("oldest_waiting"),deliveries.getInt("failed_week"),deliveries.getInt("sent_day"),
            accounts.getInt("signed_in_week"),accounts.getInt("new_week"),accounts.getInt("devices"),
            j.optJSONArray("activity").rows {BackendDay(it.getString("day"),it.getInt("sessions"),it.getInt("messages"),it.getInt("bookings"),it.getInt("accounts"))},
            if(j.isNull("jobs")) null else j.getJSONArray("jobs").rows {BackendJob(it.getString("name"),it.getString("schedule"),it.text("last_status"),it.text("last_run"),it.getInt("failures_day"))},
        )
    }
}
