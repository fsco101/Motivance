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
        return ChatMessage(j.getString("id"),j.getString("conversation_id"),j.text("sender_id"),kind,
            if(deleted) "" else j.optString("body"),j.getString("created_at"),deleted,
            if(deleted || kind!=MessageKind.ATTACHMENT) null else j.optJSONObject("data")?.let(::attachment))
    }

    /** What an attachment message's data says about its file. Anything unreadable leaves the message without one, never broken. */
    fun attachment(d:JSONObject):Attachment? = runCatching {
        Attachment(if(d.getString("attachment_kind")=="video") MediaKind.VIDEO else MediaKind.IMAGE,d.getString("mime"),d.getInt("width"),d.getInt("height"),
            if(d.isNull("duration_ms")) null else d.getLong("duration_ms"),d.optLong("bytes"),d.getString("media_path"),d.getString("preview_path"),d.getString("expires_at"))
    }.getOrNull()

    fun conversations(raw:String):List<Conversation> {
        val rows=JSONArray(raw)
        return (0 until rows.length()).map {index ->
            val j=rows.getJSONObject(index)
            Conversation(j.getString("id"),j.getString("side")=="patient",j.getString("other_id"),j.optString("other_name"),j.text("other_photo"),
                j.getBoolean("open"),j.text("last_message_at"),j.optJSONObject("last_message")?.let(::message),j.optInt("unread"),j.optBoolean("consented",true),j.optBoolean("media",true))
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
