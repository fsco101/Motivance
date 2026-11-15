package com.motivance.data.local

import com.motivance.domain.ChatOutbox
import com.motivance.domain.MediaDraft
import com.motivance.domain.MediaKind
import com.motivance.domain.Outgoing
import org.json.JSONObject
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/** The chat outbox in the same database as unsent exercise results, so it survives the app being closed. */
@Singleton class RoomChatOutbox @Inject constructor(private val store:SessionStore):ChatOutbox {
    override fun observe(owner:String):Flow<List<Outgoing>> = store.dao.observeChat(owner).map {rows -> rows.map {Outgoing(it.id,it.conversationId,it.body,it.createdAt,it.failed,it.mediaJson?.let(::draft))}}
    override suspend fun add(owner:String,item:Outgoing) {
        require(owner.isNotBlank())
        store.dao.addChat(ChatOutboxEntry(item.id,owner,item.conversationId,item.body,item.createdAt,item.failed,item.media?.let(::json)))
    }
    override suspend fun setFailed(owner:String,id:String,failed:Boolean)=store.dao.chatFailed(owner,id,failed)
    override suspend fun remove(owner:String,id:String)=store.dao.removeChat(owner,id)

    internal companion object {
        fun json(d:MediaDraft):String=JSONObject().put("kind",d.kind.key).put("file",d.file).put("mime",d.mime).put("preview",d.preview)
            .put("width",d.width).put("height",d.height).put("duration_ms",d.durationMs ?: JSONObject.NULL).toString()
        /** A row whose media cannot be read is sent as words alone rather than lost. */
        fun draft(raw:String):MediaDraft? = runCatching {
            val j=JSONObject(raw)
            MediaDraft(if(j.getString("kind")=="video") MediaKind.VIDEO else MediaKind.IMAGE,j.getString("file"),j.getString("mime"),j.getString("preview"),
                j.getInt("width"),j.getInt("height"),if(j.isNull("duration_ms")) null else j.getLong("duration_ms"))
        }.getOrNull()
    }
}
