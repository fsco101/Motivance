package com.motivance.feature.chat

import com.motivance.designsystem.Toaster
import com.motivance.domain.*
import java.io.IOException
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ChatViewModelTest {
    private val dispatcher=StandardTestDispatcher()
    private val me="10000000-0000-0000-0000-000000000001"
    private val other="10000000-0000-0000-0000-000000000002"
    private val remote=FakeChat()
    private val box=FakeOutbox()
    private val live=FakeLive()
    @Before fun setup() {Dispatchers.setMain(dispatcher)}
    @After fun teardown() {Dispatchers.resetMain()}

    private fun TestScope.started():ChatViewModel {
        val vm=ChatViewModel(remote,box,live,Toaster())
        vm.configure(me); vm.open("c"); advanceUntilIdle()
        return vm
    }
    private fun TestScope.connected(vm:ChatViewModel)=backgroundScope.launch {vm.stayLive()}.also {runCurrent()}
    /** The live connection is collected in the background, which advanceUntilIdle leaves alone, so it is run first. */
    private fun TestScope.settle() {runCurrent(); advanceUntilIdle()}

    @Test fun opensTheListAndAConversation() = runTest(dispatcher) {
        remote.stored+=remote.message("m1",other,"Hello")
        val vm=started()
        assertEquals(listOf("c"),vm.state.value.conversations.map {it.id})
        assertEquals(listOf("m1"),vm.state.value.messages.map {it.id})
        assertTrue(vm.state.value.threadLoaded)
    }

    @Test fun aMessageWrittenOfflineWaitsAndSendsOnceWhenTheConnectionReturns() = runTest(dispatcher) {
        val vm=started(); connected(vm)
        remote.offline=true
        vm.send("  Written in airplane mode  "); advanceUntilIdle()
        val waiting=vm.state.value.outgoing.single()
        assertEquals("Written in airplane mode",waiting.body)
        assertFalse("A lost connection is not a refusal",waiting.failed)
        assertEquals(1,box.rows.value.size)

        remote.offline=false
        live.emit(LiveEvent.Connection(true)); settle()
        assertEquals(listOf(waiting.id),remote.sent)
        assertTrue(box.rows.value.isEmpty())
        assertTrue(vm.state.value.outgoing.isEmpty())
        assertEquals(1,vm.state.value.messages.count {it.id==waiting.id})
        // The same message arriving again over the live connection replaces itself.
        live.emit(LiveEvent.Message(remote.stored.single {it.id==waiting.id})); settle()
        assertEquals(1,vm.state.value.messages.count {it.id==waiting.id})
    }

    @Test fun messagesGoInTheOrderWrittenAndSurviveTheAppClosing() = runTest(dispatcher) {
        remote.offline=true
        box.rows.value=listOf(Outgoing("b","c","second",2),Outgoing("a","c","first",1))
        val vm=started()
        assertEquals(2,vm.state.value.outgoing.size)
        remote.offline=false
        connected(vm); live.emit(LiveEvent.Connection(true)); settle()
        assertEquals(listOf("a","b"),remote.sent.distinct())
    }

    @Test fun aRefusedMessageWaitsForThePersonAndDoesNotHoldUpTheRest() = runTest(dispatcher) {
        val vm=started()
        remote.refuse+="first"
        vm.send("first"); advanceUntilIdle()
        vm.send("second"); advanceUntilIdle()
        val refused=vm.state.value.outgoing.single()
        assertTrue(refused.failed)
        assertEquals("first",refused.body)
        assertTrue(box.rows.value.single().failed)
        assertEquals(listOf("second"),remote.stored.map {it.body})

        remote.refuse.clear()
        vm.retry(refused.id); advanceUntilIdle()
        assertTrue(vm.state.value.outgoing.isEmpty())
        // The retry used the same ID, so the server would have stored it once whatever happened the first time.
        assertEquals(refused.id,remote.stored.single {it.body=="first"}.id)
    }

    @Test fun aDiscardedMessageIsNeverSent() = runTest(dispatcher) {
        val vm=started()
        remote.refuse+="oops"
        vm.send("oops"); advanceUntilIdle()
        vm.discard(vm.state.value.outgoing.single().id); advanceUntilIdle()
        assertTrue(vm.state.value.outgoing.isEmpty() && box.rows.value.isEmpty())
        assertTrue(remote.stored.none {it.body=="oops"})
    }

    @Test fun whatWasSaidWhileDisconnectedIsReadAgainWhenTheConnectionReturns() = runTest(dispatcher) {
        val vm=started(); connected(vm)
        live.emit(LiveEvent.Connection(false)); settle()
        assertFalse(vm.state.value.live)
        remote.stored+=remote.message("missed",other,"Sent while you were away")
        live.emit(LiveEvent.Connection(true)); settle()
        assertTrue(vm.state.value.live)
        assertEquals(1,vm.state.value.messages.count {it.id=="missed"})
    }

    @Test fun liveMessagesForOtherConversationsOnlyRefreshTheList() = runTest(dispatcher) {
        val vm=started(); connected(vm)
        val before=remote.listReads
        live.emit(LiveEvent.Message(ChatMessage("x","elsewhere",other,MessageKind.TEXT,"Hi","2026-11-15T07:00:00Z"))); settle()
        assertTrue(vm.state.value.messages.none {it.id=="x"})
        assertTrue(remote.listReads>before)
    }

    @Test fun theOtherPersonsReadMarkMovesSeenForwardOnly() = runTest(dispatcher) {
        val vm=started(); connected(vm)
        live.emit(LiveEvent.Read(ReadMark("c",other,"2026-11-15T07:05:00+00:00"))); settle()
        live.emit(LiveEvent.Read(ReadMark("c",other,"2026-11-15T07:01:00+00:00"))); settle()
        assertEquals("2026-11-15T07:05:00+00:00",vm.state.value.otherReadAt)
        live.emit(LiveEvent.Read(ReadMark("c",me,"2026-11-15T08:00:00+00:00"))); settle()
        assertEquals("2026-11-15T07:05:00+00:00",vm.state.value.otherReadAt)
    }

    @Test fun olderMessagesAreAddedBelowWithoutRepeats() = runTest(dispatcher) {
        repeat(3) {remote.stored+=remote.message("m$it",other,"Message $it","2026-11-1${it}T07:00:00Z")}
        remote.pageSize=2
        val vm=started()
        assertEquals(listOf("m2","m1"),vm.state.value.messages.map {it.id})
        assertTrue(vm.state.value.more)
        vm.loadOlder(); advanceUntilIdle()
        assertEquals(listOf("m2","m1","m0"),vm.state.value.messages.map {it.id})
        assertFalse(vm.state.value.more)
    }

    @Test fun aLinkFromARecordFindsThatPersonsConversation() = runTest(dispatcher) {
        val vm=ChatViewModel(remote,box,live,Toaster())
        vm.configure(me); vm.openWith(other); advanceUntilIdle()
        assertEquals("c",vm.state.value.openId)
        assertNull(vm.state.value.wantedOther)
        vm.openWith("nobody"); advanceUntilIdle()
        assertNull(vm.state.value.openId)
        assertNull(vm.state.value.wantedOther)
    }

    @Test fun anotherAccountStartsCleanAndALateReplyForTheLastOneIsDropped() = runTest(dispatcher) {
        val vm=started()
        val gate=CompletableDeferred<Unit>(); remote.gate=gate
        vm.refresh(); runCurrent()
        vm.configure(other); runCurrent()
        gate.complete(Unit); advanceUntilIdle()
        assertEquals(other,vm.state.value.owner)
        assertNull(vm.state.value.openId)
        assertTrue(vm.state.value.messages.isEmpty())
    }

    @Test fun nothingIsSentForAnAccountThatSignedOut() = runTest(dispatcher) {
        val vm=started()
        remote.offline=true
        vm.send("Unsent"); advanceUntilIdle()
        vm.configure(null); remote.offline=false; advanceUntilIdle()
        assertTrue(remote.sent.isEmpty())
        assertEquals("",vm.state.value.owner)
    }

    private class FakeLive:ChatLive {
        private val events=MutableSharedFlow<LiveEvent>(extraBufferCapacity=16)
        suspend fun emit(event:LiveEvent)=events.emit(event)
        override fun events():Flow<LiveEvent> = events
    }

    private class FakeOutbox:ChatOutbox {
        val rows=MutableStateFlow<List<Outgoing>>(emptyList())
        override fun observe(owner:String)=rows
        override suspend fun add(owner:String,item:Outgoing) {rows.update {it+item}}
        override suspend fun setFailed(owner:String,id:String,failed:Boolean) {rows.update {list -> list.map {if(it.id==id) it.copy(failed=failed) else it}}}
        override suspend fun remove(owner:String,id:String) {rows.update {list -> list.filter {it.id!=id}}}
    }

    private inner class FakeChat:ChatRepository {
        val stored=mutableListOf<ChatMessage>()
        val sent=mutableListOf<String>()
        val refuse=mutableSetOf<String>()
        var offline=false
        var pageSize=50
        var listReads=0
        var gate:CompletableDeferred<Unit>?=null
        private var clock=0L
        fun message(id:String,sender:String,body:String,at:String="2026-11-15T07:00:${(clock++).toString().padStart(2,'0')}Z")=ChatMessage(id,"c",sender,MessageKind.TEXT,body,at)
        override suspend fun loadConversations():List<Conversation> {
            listReads++
            gate?.let {withContext(NonCancellable) {it.await()}}
            if(offline) throw IOException("offline")
            return listOf(Conversation("c",true,other,"Dana Reyes",null,true,null,stored.maxByOrNull {it.at},0))
        }
        override suspend fun loadMessages(conversationId:String,before:ChatMessage?):MessagePage {
            gate?.let {withContext(NonCancellable) {it.await()}}
            if(offline) throw IOException("offline")
            val ordered=stored.filter {it.conversationId==conversationId}.sortedWith(compareByDescending<ChatMessage> {it.at}.thenByDescending {it.id})
                .filter {before==null || it.at<before.at || (it.at==before.at && it.id<before.id)}
            return MessagePage(ordered.take(pageSize),ordered.size>pageSize,true,null)
        }
        override suspend fun sendMessage(id:String,conversationId:String,body:String):ChatMessage {
            if(offline) throw IOException("offline")
            if(body in refuse) throw RemoteFailure(400,"chat_closed")
            sent+=id
            stored.firstOrNull {it.id==id}?.let {return it}
            return ChatMessage(id,conversationId,me,MessageKind.TEXT,body,"2026-11-15T09:00:${(clock++).toString().padStart(2,'0')}Z").also {stored+=it}
        }
        override suspend fun markConversationRead(conversationId:String) {}
        override suspend fun deleteMessage(id:String)=stored.first {it.id==id}.copy(deleted=true,body="")
        override suspend fun liveAccess()=LiveAccess("http://localhost:54321","key","token")
    }
}
