package com.motivance.data.local

import com.motivance.domain.ChatOutbox
import com.motivance.domain.Outgoing
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/** The chat outbox in the same database as unsent exercise results, so it survives the app being closed. */
@Singleton class RoomChatOutbox @Inject constructor(private val store:SessionStore):ChatOutbox {
    override fun observe(owner:String):Flow<List<Outgoing>> = store.dao.observeChat(owner).map {rows -> rows.map {Outgoing(it.id,it.conversationId,it.body,it.createdAt,it.failed)}}
    override suspend fun add(owner:String,item:Outgoing) {
        require(owner.isNotBlank())
        store.dao.addChat(ChatOutboxEntry(item.id,owner,item.conversationId,item.body,item.createdAt,item.failed))
    }
    override suspend fun setFailed(owner:String,id:String,failed:Boolean)=store.dao.chatFailed(owner,id,failed)
    override suspend fun remove(owner:String,id:String)=store.dao.removeChat(owner,id)
}
