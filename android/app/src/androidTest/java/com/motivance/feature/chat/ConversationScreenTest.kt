package com.motivance.feature.chat

import androidx.compose.material3.Surface
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import com.motivance.R
import com.motivance.designsystem.MotivanceTheme
import com.motivance.designsystem.Toaster
import com.motivance.domain.*
import java.io.IOException
import java.time.Instant
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.update
import org.junit.Rule
import org.junit.Test

/** The conversation screen on a device, with the server replaced so each state can be shown on demand. */
class ConversationScreenTest {
    @get:Rule val compose=createComposeRule()
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private val me="10000000-0000-0000-0000-000000000001"
    private val therapist="10000000-0000-0000-0000-000000000002"

    private fun show(remote:Remote,box:Box=Box()):ChatViewModel {
        val vm=ChatViewModel(remote,box,{emptyFlow<LiveEvent>()},Toaster())
        compose.runOnUiThread {vm.configure(me)}
        compose.waitUntil(10_000) {vm.state.value.listLoaded}
        compose.runOnUiThread {vm.open("c")}
        compose.setContent {MotivanceTheme {Surface {
            val state by vm.state.collectAsState()
            ConversationScreen(state,me,vm)
        }}}
        compose.waitUntil(10_000) {vm.state.value.threadLoaded}
        return vm
    }

    @Test fun showsTheThreadAndSendsWhatIsWritten() {
        val remote=Remote(open=true)
        show(remote)
        compose.onNodeWithText("How is the elbow today?").assertExists()
        compose.onNodeWithText(context.getString(R.string.chat_your_therapist)).assertExists()
        compose.onNodeWithContentDescription(context.getString(R.string.chat_send)).assertIsNotEnabled()
        compose.onNodeWithContentDescription(context.getString(R.string.chat_write_to,"Dana Reyes")).performTextInput("Better, thank you.")
        compose.onNodeWithContentDescription(context.getString(R.string.chat_send)).assertIsEnabled().performClick()
        compose.waitUntil(10_000) {remote.sent.isNotEmpty()}
        compose.waitUntil(10_000) {compose.onAllNodes(hasText("Better, thank you.")).fetchSemanticsNodes().isNotEmpty()}
    }

    @Test fun aMessageWrittenOfflineSaysItIsWaiting() {
        val remote=Remote(open=true,offline=true)
        show(remote)
        compose.onNodeWithContentDescription(context.getString(R.string.chat_write_to,"Dana Reyes")).performTextInput("Written offline")
        compose.onNodeWithContentDescription(context.getString(R.string.chat_send)).performClick()
        compose.waitUntil(10_000) {compose.onAllNodes(hasText(context.getString(R.string.chat_waiting))).fetchSemanticsNodes().isNotEmpty()}
        compose.onNodeWithText(context.getString(R.string.chat_reconnecting)).assertExists()
    }

    @Test fun aClosedConversationCanBeReadButNotWrittenIn() {
        show(Remote(open=false))
        compose.onNodeWithText("How is the elbow today?").assertExists()
        compose.onNodeWithText(context.getString(R.string.chat_closed)).assertExists()
        compose.onAllNodesWithContentDescription(context.getString(R.string.chat_send)).assertCountEquals(0)
    }

    private class Box:ChatOutbox {
        val rows=MutableStateFlow<List<Outgoing>>(emptyList())
        override fun observe(owner:String):Flow<List<Outgoing>> = rows
        override suspend fun add(owner:String,item:Outgoing) {rows.update {it+item}}
        override suspend fun setFailed(owner:String,id:String,failed:Boolean) {rows.update {list -> list.map {if(it.id==id) it.copy(failed=failed) else it}}}
        override suspend fun remove(owner:String,id:String) {rows.update {list -> list.filter {it.id!=id}}}
    }

    private inner class Remote(val open:Boolean,val offline:Boolean=false):ChatRepository {
        val sent=mutableListOf<String>()
        private val first=ChatMessage("m1","c",therapist,MessageKind.TEXT,"How is the elbow today?",Instant.now().minusSeconds(600).toString())
        override suspend fun loadConversations()=listOf(Conversation("c",true,therapist,"Dana Reyes",null,open,first.createdAt,first,0))
        override suspend fun loadMessages(conversationId:String,before:ChatMessage?)=MessagePage(if(before==null) listOf(first) else emptyList(),false,open,null)
        override suspend fun sendMessage(id:String,conversationId:String,body:String):ChatMessage {
            if(offline) throw IOException("offline")
            sent+=id
            return ChatMessage(id,conversationId,me,MessageKind.TEXT,body,Instant.now().toString())
        }
        override suspend fun markConversationRead(conversationId:String) {}
        override suspend fun deleteMessage(id:String)=error("unused")
        override suspend fun liveAccess()=error("unused")
        override suspend fun loadChatConsent()=ChatConsent("care-chat-v1",true,null)
        override suspend fun setChatConsent(granted:Boolean)=ChatConsent("care-chat-v1",granted,null)
    }
}
