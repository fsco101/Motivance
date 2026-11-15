package com.motivance.data.remote

import com.motivance.domain.*
import org.json.JSONArray
import org.json.JSONObject

/** Reads chat as the server's functions return it, and as rows arrive over the live connection. Mirrors web/src/data/chat.ts. */
internal object ChatJson {
    private fun JSONObject.text(key:String):String?=if(!has(key) || isNull(key)) null else getString(key)

    /** A function returns `deleted`; a live row has `deleted_at` instead. A deleted message never carries its words. */
    fun message(j:JSONObject):ChatMessage {
        val deleted=if(j.has("deleted")) j.optBoolean("deleted") else j.text("deleted_at")!=null
        val kind=MessageKind.of(j.getString("kind"))
        val data=j.optJSONObject("data")
        return ChatMessage(j.getString("id"),j.getString("conversation_id"),j.text("sender_id"),kind,
            if(deleted) "" else j.optString("body"),j.getString("created_at"),deleted,
            if(deleted || kind!=MessageKind.ATTACHMENT) null else data?.let(::attachment),
            if(deleted) null else data?.let {card(kind,it)},
            if(kind==MessageKind.SYSTEM) line(data ?: JSONObject()) else null)
    }

    /** What an attachment message's data says about its file. Anything unreadable leaves the message without one, never broken. */
    fun attachment(d:JSONObject):Attachment? = runCatching {
        Attachment(if(d.getString("attachment_kind")=="video") MediaKind.VIDEO else MediaKind.IMAGE,d.getString("mime"),d.getInt("width"),d.getInt("height"),
            if(d.isNull("duration_ms")) null else d.getLong("duration_ms"),d.optLong("bytes"),d.getString("media_path"),d.getString("preview_path"),d.getString("expires_at"))
    }.getOrNull()

    private fun JSONObject.double(key:String)=if(!has(key) || isNull(key)) null else optDouble(key).takeIf {it.isFinite()}
    private fun JSONObject.int(key:String)=double(key)?.toInt()

    /** A card's facts. A card whose facts are unreadable is left out, never shown wrong. */
    fun card(kind:MessageKind?,d:JSONObject):ChatCard? = runCatching {
        when {
            kind==MessageKind.PROGRESS && d.optString("scope")=="activity" -> ChatCard.Activity(d.int("week")!!,d.int("previous_week")!!,d.int("active_days")!!,d.int("streak")!!,
                d.int("days_since_last"),d.text("as_of"))
            kind==MessageKind.PROGRESS && d.optString("scope")=="series" -> ChatCard.Series(d.getString("exercise"),d.getString("side"),d.double("latest")!!,d.double("best")!!,
                d.double("change"),d.int("measured")!!,d.double("low")!!,d.double("high")!!,d.text("as_of"))
            kind==MessageKind.EXERCISE -> ChatCard.Exercise(d.getString("assignment_id"),d.int("version")!!,d.optString("exercise"),d.getString("side"),
                d.double("low")!!,d.double("high")!!,d.int("repetitions")!!)
            else -> null
        }
    }.getOrNull()

    fun line(d:JSONObject):SystemLine=when(d.optString("event")) {
        "practice_reminder" -> SystemLine.PracticeReminder(d.optString("date"))
        "session_finished" -> SystemLine.SessionFinished(d.int("completed") ?: 0,d.int("target") ?: 0)
        else -> SystemLine.Unknown
    }

    fun progressFacts(card:ChatCard.Progress):JSONObject=when(card) {
        is ChatCard.Activity -> JSONObject().put("scope","activity").put("week",card.week).put("previous_week",card.previousWeek).put("active_days",card.activeDays)
            .put("streak",card.streak).put("days_since_last",card.daysSinceLast ?: JSONObject.NULL)
        is ChatCard.Series -> JSONObject().put("scope","series").put("exercise",card.exercise).put("side",card.side).put("latest",card.latest).put("best",card.best)
            .put("change",card.change ?: JSONObject.NULL).put("measured",card.measured).put("low",card.low).put("high",card.high)
    }

    fun scheduled(raw:String):List<ScheduledMessage> = JSONArray(raw).let {rows ->
        (0 until rows.length()).map {rows.getJSONObject(it).let {row -> ScheduledMessage(row.getString("id"),row.getString("body"),row.getString("send_at"))}}
    }

    fun conversations(raw:String):List<Conversation> {
        val rows=JSONArray(raw)
        return (0 until rows.length()).map {index ->
            val j=rows.getJSONObject(index)
            Conversation(j.getString("id"),j.getString("side")=="patient",j.getString("other_id"),j.optString("other_name"),j.text("other_photo"),
                j.getBoolean("open"),j.text("last_message_at"),j.optJSONObject("last_message")?.let(::message),j.optInt("unread"),j.optBoolean("consented",true),j.optBoolean("media",true),j.optBoolean("muted"))
        }
    }

    fun page(raw:String):MessagePage {
        val j=JSONObject(raw)
        val rows=j.getJSONArray("messages")
        return MessagePage((0 until rows.length()).map {message(rows.getJSONObject(it))},j.optBoolean("more"),j.optBoolean("open"),j.text("other_read_at"),j.optBoolean("consented",true),j.optBoolean("media",true))
    }

    fun consent(raw:String)=JSONObject(raw).let {ChatConsent(it.getString("version"),it.getBoolean("granted"),it.text("at"),it.optBoolean("media"),it.text("accepted_version"))}

    fun places(raw:String)=JSONObject(raw).let {MediaPlaces(it.getString("media_path"),it.getString("preview_path"))}

    fun read(j:JSONObject)=ReadMark(j.getString("conversation_id"),j.getString("user_id"),j.getString("read_at"))
}
