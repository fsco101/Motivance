package com.motivance.feature.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.motivance.R
import com.motivance.designsystem.ToastTone
import com.motivance.designsystem.Toaster
import com.motivance.domain.*
import dagger.hilt.android.lifecycle.HiltViewModel
import java.util.UUID
import javax.inject.Inject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ChatState(
    val owner:String="",
    val conversations:List<Conversation> = emptyList(),
    val listLoading:Boolean=false,val listFailed:Boolean=false,val listLoaded:Boolean=false,
    val openId:String?=null,
    /** The person whose conversation is being looked for, for a link from their record. */
    val wantedOther:String?=null,
    /** Newest first, as it is loaded. */
    val messages:List<ChatMessage> = emptyList(),
    val more:Boolean=false,val olderLoading:Boolean=false,
    val threadLoading:Boolean=false,val threadFailed:Boolean=false,val threadLoaded:Boolean=false,
    val otherReadAt:String?=null,val threadOpen:Boolean=true,
    /** Every message this account has not yet had confirmed, in every conversation. */
    val outgoing:List<Outgoing> = emptyList(),
    /** True only while rows are flowing. Sending still works without it; new messages wait for it. */
    val live:Boolean=false,
    /** Whether the open conversation's patient has turned messages on. */
    val consented:Boolean=true,
    /** A patient's own answer to the messages agreement. Null until read, and always null for a therapist. */
    val consent:ChatConsent?=null,
    val consentBusy:Boolean=false,
) {
    val unread get()=conversations.sumOf {it.unread}
    val conversation get()=conversations.firstOrNull {it.id==openId}
    val waiting get()=outgoing.filter {it.conversationId==openId}
}

@HiltViewModel class ChatViewModel @Inject constructor(
    private val repository:ChatRepository,private val outbox:ChatOutbox,private val live:ChatLive,private val toasts:Toaster=Toaster(),
):ViewModel() {
    private val mutable=MutableStateFlow(ChatState())
    val state=mutable.asStateFlow()
    private var outboxJob:Job?=null
    private var listJob:Job?=null
    private var threadJob:Job?=null
    private var flushJob:Job?=null
    @Volatile private var flushAgain=false

    /** Only a patient answers the messages agreement, so only a patient's answer is read. */
    private var asPatient=false

    /** Everything belongs to one account. A result that arrives for an account that has since signed out is dropped. */
    fun configure(owner:String?,patient:Boolean) {
        asPatient=patient
        configure(owner)
        if(patient) loadConsent()
    }

    fun configure(owner:String?) {
        val id=owner.orEmpty()
        if(id==mutable.value.owner) return
        listOf(outboxJob,listJob,threadJob,flushJob).forEach {it?.cancel()}
        mutable.value=ChatState(owner=id)
        if(id.isBlank()) return
        outboxJob=viewModelScope.launch {
            outbox.observe(id).collect {items -> if(current(id)) {mutable.update {it.copy(outgoing=items)}; flush()}}
        }
        refreshList()
    }

    private fun current(owner:String)=owner.isNotBlank() && mutable.value.owner==owner

    /** Holds the live connection open while the caller is active, which is while the app is in front. */
    suspend fun stayLive() {
        val owner=mutable.value.owner
        if(owner.isBlank()) return
        try {
            live.events().collect {event ->
                if(!current(owner)) return@collect
                when(event) {
                    is LiveEvent.Connection -> {
                        mutable.update {it.copy(live=event.live)}
                        // Whatever was said while the connection was down never arrived, so everything is read again, and what waited is sent.
                        if(event.live) {refresh(); flush()}
                    }
                    is LiveEvent.Message -> {place(event.message); refreshList()}
                    is LiveEvent.Read -> if(event.mark.userId==owner) refreshList()
                        else if(event.mark.conversationId==mutable.value.openId) mutable.update {
                            val known=it.otherReadAt
                            it.copy(otherReadAt=if(known==null || parseServerTime(event.mark.readAt)>parseServerTime(known)) event.mark.readAt else known)
                        }
                }
            }
        } finally {
            if(current(owner)) mutable.update {it.copy(live=false)}
        }
    }

    fun refresh() {refreshList(); if(mutable.value.openId!=null) loadThread(); if(asPatient) loadConsent()}

    private fun loadConsent() {
        val owner=mutable.value.owner
        if(owner.isBlank()) return
        viewModelScope.launch {
            try {val found=repository.loadChatConsent(); if(current(owner)) mutable.update {it.copy(consent=found)}}
            catch(e:CancellationException) {throw e}
            catch(_:Exception) {}
        }
    }

    /** Turns messages on or off for this patient, then reads everything again, because every conversation opens or closes with it. */
    fun setConsent(granted:Boolean) {
        val owner=mutable.value.owner
        if(owner.isBlank() || mutable.value.consentBusy) return
        mutable.update {it.copy(consentBusy=true)}
        viewModelScope.launch {
            try {
                val saved=repository.setChatConsent(granted)
                if(!current(owner)) return@launch
                mutable.update {it.copy(consent=saved,consentBusy=false)}
                toasts.show(if(saved.granted) R.string.chat_agreement_turned_on else R.string.chat_agreement_turned_off)
                refresh()
                flush()
            } catch(e:CancellationException) {throw e}
            catch(e:Exception) {
                if(current(owner)) {mutable.update {it.copy(consentBusy=false)}; toasts.show(refusal(e),ToastTone.ERROR)}
            }
        }
    }

    fun refreshList() {
        val owner=mutable.value.owner
        if(owner.isBlank()) return
        listJob?.cancel()
        mutable.update {it.copy(listLoading=true,listFailed=false)}
        listJob=viewModelScope.launch {
            try {
                val found=repository.loadConversations()
                if(!current(owner)) return@launch
                mutable.update {it.copy(conversations=found,listLoading=false,listLoaded=true)}
                mutable.value.wantedOther?.let {other ->
                    val match=found.firstOrNull {it.otherId==other}
                    mutable.update {it.copy(wantedOther=null)}
                    if(match!=null) open(match.id)
                }
            } catch(e:CancellationException) {throw e}
            catch(_:Exception) {
                // What is on screen stays. The list only says it failed when there is nothing to show.
                if(current(owner)) mutable.update {it.copy(listLoading=false,listFailed=true,wantedOther=null)}
            }
        }
    }

    fun open(conversationId:String) {
        if(mutable.value.openId==conversationId && (mutable.value.threadLoaded || mutable.value.threadLoading)) return
        threadJob?.cancel()
        mutable.update {it.copy(openId=conversationId,wantedOther=null,messages=emptyList(),more=false,olderLoading=false,threadLoaded=false,
            threadFailed=false,otherReadAt=null,threadOpen=it.conversations.firstOrNull {c -> c.id==conversationId}?.open ?: true,
            consented=it.conversations.firstOrNull {c -> c.id==conversationId}?.consented ?: true)}
        loadThread()
    }

    /** Opens the conversation with [otherId], once the list says which one that is. */
    fun openWith(otherId:String) {
        val match=mutable.value.conversations.firstOrNull {it.otherId==otherId}
        if(match!=null) {open(match.id); return}
        threadJob?.cancel()
        mutable.update {it.copy(openId=null,wantedOther=otherId,messages=emptyList(),threadLoaded=false)}
        refreshList()
    }

    fun close() {
        threadJob?.cancel()
        mutable.update {it.copy(openId=null,wantedOther=null,messages=emptyList(),more=false,threadLoaded=false,threadLoading=false,threadFailed=false,otherReadAt=null)}
    }

    /** The newest page. Older pages already on screen stay, and anything in both is replaced by the newer copy. */
    private fun loadThread() {
        val owner=mutable.value.owner
        val id=mutable.value.openId ?: return
        threadJob?.cancel()
        mutable.update {it.copy(threadLoading=true,threadFailed=false)}
        threadJob=viewModelScope.launch {
            try {
                val page=repository.loadMessages(id)
                if(!current(owner) || mutable.value.openId!=id) return@launch
                mutable.update {
                    val messages=if(it.threadLoaded) page.messages.fold(it.messages) {list,message -> list.merge(message)} else page.messages
                    it.copy(messages=messages,more=if(it.threadLoaded && it.messages.size>page.messages.size) it.more else page.more,otherReadAt=page.otherReadAt,
                        threadOpen=page.open,consented=page.consented,threadLoading=false,threadLoaded=true)
                }
            } catch(e:CancellationException) {throw e}
            catch(_:Exception) {
                if(current(owner) && mutable.value.openId==id) mutable.update {it.copy(threadLoading=false,threadFailed=true)}
            }
        }
    }

    fun loadOlder() {
        val owner=mutable.value.owner
        val snapshot=mutable.value
        val id=snapshot.openId ?: return
        val oldest=snapshot.messages.lastOrNull() ?: return
        if(snapshot.olderLoading || !snapshot.more) return
        mutable.update {it.copy(olderLoading=true)}
        viewModelScope.launch {
            try {
                val page=repository.loadMessages(id,oldest)
                if(current(owner) && mutable.value.openId==id) mutable.update {
                    it.copy(messages=page.messages.fold(it.messages) {list,message -> list.merge(message)},more=page.more,olderLoading=false)
                }
            } catch(e:CancellationException) {throw e}
            catch(_:Exception) {
                if(current(owner)) {mutable.update {it.copy(olderLoading=false)}; toasts.show(R.string.chat_older_failed,ToastTone.ERROR)}
            }
        }
    }

    /** Told to the server once for each new message from the other person, by the screen, only while the person can see it. */
    fun markRead() {
        val owner=mutable.value.owner
        val id=mutable.value.openId ?: return
        viewModelScope.launch {
            try {repository.markConversationRead(id); if(current(owner)) refreshList()}
            catch(e:CancellationException) {throw e}
            catch(_:Exception) {}
        }
    }

    /** The words go into the outbox first, so they survive a closed app or a lost connection and are sent in order. */
    fun send(body:String) {
        val owner=mutable.value.owner
        val id=mutable.value.openId ?: return
        val words=body.trim()
        if(owner.isBlank() || words.isEmpty() || words.length>CHAT_BODY_LIMIT) return
        viewModelScope.launch {outbox.add(owner,Outgoing(UUID.randomUUID().toString(),id,words,System.currentTimeMillis()))}
    }

    /** The same ID goes again, so a message that did arrive the first time is not sent twice. */
    fun retry(id:String) {
        val owner=mutable.value.owner
        mutable.update {it.copy(outgoing=it.outgoing.map {o -> if(o.id==id) o.copy(failed=false) else o})}
        viewModelScope.launch {outbox.setFailed(owner,id,false); flush()}
    }

    fun discard(id:String) {
        val owner=mutable.value.owner
        mutable.update {it.copy(outgoing=it.outgoing.filter {o -> o.id!=id})}
        viewModelScope.launch {outbox.remove(owner,id)}
    }

    fun delete(id:String) {
        val owner=mutable.value.owner
        viewModelScope.launch {
            try {
                val stored=repository.deleteMessage(id)
                if(current(owner)) {place(stored); refreshList()}
            } catch(e:CancellationException) {throw e}
            catch(e:Exception) {if(current(owner)) toasts.show(refusal(e),ToastTone.ERROR)}
        }
    }

    private fun place(message:ChatMessage) {
        if(mutable.value.openId==message.conversationId && mutable.value.threadLoaded) mutable.update {it.copy(messages=it.messages.merge(message))}
    }

    /**
     * Sends what waits, one at a time and in the order written. A lost connection stops the run until the next one; a refusal
     * marks that message for the person and moves on. Only one run goes at a time, and anything added meanwhile is picked up.
     */
    private fun flush() {
        if(flushJob?.isActive==true) {flushAgain=true; return}
        val owner=mutable.value.owner
        if(owner.isBlank()) return
        flushJob=viewModelScope.launch {
            do {
                flushAgain=false
                while(current(owner)) {
                    val next=mutable.value.outgoing.nextToSend() ?: break
                    try {
                        val stored=repository.sendMessage(next.id,next.conversationId,next.body)
                        if(!current(owner)) return@launch
                        mutable.update {it.copy(outgoing=it.outgoing.filter {o -> o.id!=next.id})}
                        outbox.remove(owner,next.id)
                        place(stored)
                        refreshList()
                    } catch(e:CancellationException) {throw e}
                    catch(e:Exception) {
                        if(!current(owner)) return@launch
                        if(sendFailure(e)!=SendFailure.REFUSED) {flushAgain=false; break}
                        mutable.update {it.copy(outgoing=it.outgoing.map {o -> if(o.id==next.id) o.copy(failed=true) else o})}
                        outbox.setFailed(owner,next.id,true)
                        toasts.show(refusal(e),ToastTone.ERROR)
                        // A closed conversation is the usual reason, and the next read shows it.
                        refresh()
                    }
                }
            } while(flushAgain && current(owner))
        }
    }

    private fun refusal(e:Exception)=when((e as? RemoteFailure)?.code) {
        "chat_closed" -> R.string.chat_error_closed
        "chat_consent_required" -> R.string.chat_error_consent_required
        "chat_rate_limited" -> R.string.chat_error_rate_limited
        "chat_too_late" -> R.string.chat_error_too_late
        else -> if(e is RemoteFailure) R.string.chat_error_request else R.string.chat_error_offline
    }
}
