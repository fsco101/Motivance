package com.motivance.domain

import java.time.Instant
import java.time.OffsetDateTime
import kotlinx.coroutines.flow.Flow

/** Mirrors CHAT_BODY_LIMIT on the web and the check in send_message on the server. */
const val CHAT_BODY_LIMIT=2000
/** How long a sender may take a message back. The server enforces the same quarter of an hour. */
const val CHAT_DELETE_WINDOW_MS=15*60_000L

enum class MessageKind(val key:String) {
    TEXT("text"),ATTACHMENT("attachment"),PROGRESS("progress"),EXERCISE("exercise"),SYSTEM("system");
    companion object {fun of(value:String)=entries.firstOrNull {it.key==value}}
}

/**
 * One message as both apps read it. [senderId] is null for a note the system wrote. A deleted message keeps its place
 * and loses its words. [createdAt] is kept exactly as the server sent it, because paging back asks for what came before it.
 * [kind] is null for a kind this version does not know, which the screen says it cannot show rather than dropping.
 */
data class ChatMessage(
    val id:String,val conversationId:String,val senderId:String?,val kind:MessageKind?,val body:String,
    val createdAt:String,val deleted:Boolean=false,
    /** A photo or video, for an attachment message; its words are the caption. */
    val attachment:Attachment?=null,
) {
    val at:Instant get()=parseServerTime(createdAt)
}

/**
 * [open] is whether anything can be sent: it is false when the link between the two has ended, and until the patient has
 * turned messages on, which [consented] says.
 */
data class Conversation(
    val id:String,val asPatient:Boolean,val otherId:String,val otherName:String,val otherPhoto:String?,val open:Boolean,
    val lastMessageAt:String?,val lastMessage:ChatMessage?,val unread:Int,val consented:Boolean=true,
    /** Whether the patient has agreed to photos and video, which needs the second version of the agreement. */
    val media:Boolean=true,
)

/** Newest first. [otherReadAt] is how far the other person has read, for "Seen". */
data class MessagePage(val messages:List<ChatMessage>,val more:Boolean,val open:Boolean,val otherReadAt:String?,val consented:Boolean=true,val media:Boolean=true)

/** The patient's answer to the messages agreement. [media] is whether they agreed to its current version, which allows photos and video. */
data class ChatConsent(val version:String,val granted:Boolean,val at:String?,val media:Boolean=false,val acceptedVersion:String?=null)

/** Mirrors MEDIA_LIMITS on the web and chat_media_limit on the server, which checks every stored file against these. */
object MediaLimits {
    const val IMAGE=1_048_576L
    const val VIDEO=6_291_456L
    const val PREVIEW=204_800L
    const val PHOTO_LONG_SIDE=1600
    const val PREVIEW_LONG_SIDE=320
    const val VIDEO_SHORT_SIDE=480
    const val VIDEO_LONG_SIDE=854
    const val VIDEO_MS=30_000L
    const val VIDEO_BITS=1_000_000
    const val LINK_SECONDS=300
}

enum class MediaKind(val key:String) { IMAGE("image"), VIDEO("video") }

/** A photo or video as its message describes it. */
data class Attachment(
    val kind:MediaKind,val mime:String,val width:Int,val height:Int,val durationMs:Long?,val bytes:Long,
    val mediaPath:String,val previewPath:String,val expiresAt:String,
) {
    /** After 15 days the server issues no link and the file is removed, whatever is still on screen. */
    fun expired(now:Long=System.currentTimeMillis())=parseServerTime(expiresAt).toEpochMilli()<=now
}

data class Size(val width:Int,val height:Int)

/** The largest even size inside the limits that keeps the shape. Even, because video encoders need it. Never enlarges. Mirrors fitWithin on the web. */
fun fitWithin(width:Int,height:Int,longSide:Int,shortSide:Int=longSide):Size {
    val scale=minOf(1.0,longSide.toDouble()/maxOf(width,height),shortSide.toDouble()/minOf(width,height))
    fun even(value:Int)=maxOf(2,(kotlin.math.floor(value*scale/2)*2).toInt())
    return Size(even(width),even(height))
}

/** What a video becomes: its size, and how much of it is kept. Longer clips keep their first 30 seconds. Mirrors videoPlan on the web. */
data class VideoPlan(val width:Int,val height:Int,val durationMs:Long,val trimmed:Boolean)
fun videoPlan(width:Int,height:Int,durationMs:Long):VideoPlan {
    require(width>0 && height>0 && durationMs>0) {"chat_media_invalid"}
    val size=fitWithin(width,height,MediaLimits.VIDEO_LONG_SIDE,MediaLimits.VIDEO_SHORT_SIDE)
    return VideoPlan(size.width,size.height,minOf(durationMs,MediaLimits.VIDEO_MS),durationMs>MediaLimits.VIDEO_MS+250)
}

/** A photo or video made smaller on this phone and waiting to be sent: its two files, and what the server is told about them. */
data class MediaDraft(val kind:MediaKind,val file:String,val mime:String,val preview:String,val width:Int,val height:Int,val durationMs:Long?)
data class MediaPlaces(val mediaPath:String,val previewPath:String)
data class ReadMark(val conversationId:String,val userId:String,val readAt:String)

/** Where and how this account may open the live connection. The token is fresh: an expired one is refused at join. */
data class LiveAccess(val baseUrl:String,val publicKey:String,val token:String)

interface ChatRepository {
    suspend fun loadConversations():List<Conversation>
    /** One page, newest first. Pass the oldest message on screen to read further back. */
    suspend fun loadMessages(conversationId:String,before:ChatMessage?=null):MessagePage
    /** [id] is made by the caller and kept across retries, so a send whose reply was lost cannot arrive twice. */
    suspend fun sendMessage(id:String,conversationId:String,body:String):ChatMessage
    suspend fun markConversationRead(conversationId:String)
    suspend fun deleteMessage(id:String):ChatMessage
    suspend fun liveAccess():LiveAccess
    suspend fun loadChatConsent():ChatConsent
    /** Turning messages on or off. Giving the same answer twice records nothing. */
    suspend fun setChatConsent(granted:Boolean):ChatConsent
    /** Step one of sending a photo or video: the server agrees to it and names where its files go. The same ID again gives the same places. */
    suspend fun startAttachment(id:String,conversationId:String,draft:MediaDraft):MediaPlaces {throw UnsupportedOperationException()}
    /** A file already there from an earlier try counts as stored: nothing can overwrite it. */
    suspend fun uploadMedia(path:String,bytes:ByteArray,mime:String) {throw UnsupportedOperationException()}
    /** Step two, once both files are stored. A file the server finds over its limit is refused and removed. */
    suspend fun sendAttachment(id:String,caption:String):ChatMessage {throw UnsupportedOperationException()}
    /** A short-lived link to one file, for the two people in the conversation only, and only until it expires. */
    suspend fun mediaLink(path:String,seconds:Int=MediaLimits.LINK_SECONDS):String {throw UnsupportedOperationException()}
}

/**
 * Functions send ISO times. The live connection sends rows as Postgres writes them, which may use a space and a bare hour offset
 * ("2026-11-15 07:20:00.1+00"), so both are read.
 */
fun parseServerTime(value:String):Instant {
    val iso=value.trim().replaceFirst(' ','T').replace(Regex("([+-]\\d{2})$"),"$1:00")
    return runCatching {OffsetDateTime.parse(iso).toInstant()}.getOrElse {Instant.parse(iso)}
}

private val newestFirst=compareByDescending<ChatMessage> {it.at}.thenByDescending {it.id}

/** Applies a live message to a newest-first list: adds it in order, or replaces the copy already there. Mirrors mergeMessage on the web. */
fun List<ChatMessage>.merge(incoming:ChatMessage):List<ChatMessage> = (filter {it.id!=incoming.id}+incoming).sortedWith(newestFirst)

fun ChatMessage.deletable(me:String,now:Long=System.currentTimeMillis())=
    senderId==me && !deleted && kind!=MessageKind.SYSTEM && now-at.toEpochMilli()<CHAT_DELETE_WINDOW_MS

/**
 * A message written on this phone and not yet confirmed by the server. It keeps its ID until it is, so it can never arrive twice.
 * [failed] means the server refused it, so it waits for the person to try again or discard it. Anything else is still going,
 * and goes again by itself when the connection returns.
 */
data class Outgoing(val id:String,val conversationId:String,val body:String,val createdAt:Long,val failed:Boolean=false,val media:MediaDraft?=null)

sealed interface ThreadItem {
    val key:String
    data class Day(override val key:String,val at:Instant):ThreadItem
    data class Message(val message:ChatMessage,val mine:Boolean,val state:SendState,val seen:Boolean):ThreadItem {override val key get()=message.id}
}
enum class SendState { SENT, SENDING, FAILED }

/**
 * What the thread shows, oldest first: a line for each new day, then every message, then whatever is still on its way.
 * "Seen" sits only on the reader's newest delivered message, and only once the other person has read that far.
 * [outgoing] is this conversation's only. Mirrors threadItems on the web.
 */
fun threadItems(messages:List<ChatMessage>,outgoing:List<Outgoing>,me:String,otherReadAt:String?,zone:java.time.ZoneId):List<ThreadItem> {
    val delivered=messages.sortedWith(newestFirst).reversed()
    val known=delivered.map {it.id}.toSet()
    val lastMine=delivered.lastOrNull {it.senderId==me && !it.deleted}
    val seen=lastMine!=null && otherReadAt!=null && parseServerTime(otherReadAt)>=lastMine.at
    val rows=delivered.map {ThreadItem.Message(it,it.senderId==me,SendState.SENT,seen && it.id==lastMine?.id)} +
        outgoing.filter {it.id !in known}.sortedBy {it.createdAt}
            .map {ThreadItem.Message(ChatMessage(it.id,it.conversationId,me,if(it.media!=null) MessageKind.ATTACHMENT else MessageKind.TEXT,it.body,Instant.ofEpochMilli(it.createdAt).toString()),true,
                if(it.failed) SendState.FAILED else SendState.SENDING,false)}
    val items=mutableListOf<ThreadItem>()
    var day:java.time.LocalDate?=null
    rows.forEach {row ->
        val at=row.message.at
        val date=at.atZone(zone).toLocalDate()
        if(date!=day) {items+=ThreadItem.Day("day-$date",at); day=date}
        items+=row
    }
    return items
}

/** Messages are sent strictly in the order they were written. A refused one waits for the person, and does not hold up the rest. */
fun List<Outgoing>.nextToSend():Outgoing?=filter {!it.failed}.minByOrNull {it.createdAt}

/** Why a send did not go. Only a server refusal needs the person; a lost connection just waits for the next chance. */
enum class SendFailure { OFFLINE, REFUSED, SIGNED_OUT }
fun sendFailure(error:Throwable)=when {
    error is RemoteFailure && error.authenticationRequired -> SendFailure.SIGNED_OUT
    error is RemoteFailure && !error.retryable -> SendFailure.REFUSED
    else -> SendFailure.OFFLINE
}

/** What the live connection reports. [Connection] is true only once rows are flowing, and false whenever they may not be. */
sealed interface LiveEvent {
    data class Connection(val live:Boolean):LiveEvent
    data class Message(val message:ChatMessage):LiveEvent
    data class Read(val mark:ReadMark):LiveEvent
}

/** One live connection for every conversation the reader has. Collecting holds it open, reconnecting as needed; cancelling closes it. */
fun interface ChatLive { fun events():Flow<LiveEvent> }

/** Messages written on this phone and not yet confirmed, kept across restarts and per account. */
interface ChatOutbox {
    fun observe(owner:String):Flow<List<Outgoing>>
    suspend fun add(owner:String,item:Outgoing)
    suspend fun setFailed(owner:String,id:String,failed:Boolean)
    suspend fun remove(owner:String,id:String)
}
