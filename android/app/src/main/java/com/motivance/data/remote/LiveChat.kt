package com.motivance.data.remote

import com.motivance.domain.*
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.launch
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject

/**
 * The frames of Supabase Realtime's channel protocol (Phoenix, version 1.0.0) that chat needs: join with the reader's token,
 * keep the socket alive, and read the database rows the server decides this reader may see.
 */
internal object RealtimeFrames {
    const val HEARTBEAT_MS=25_000L
    private val TABLES=listOf("chat_messages","chat_reads")

    /** At the same host the rest of the app talks to. OkHttp opens a websocket from an http or https address, as ws or wss. */
    fun socketUrl(access:LiveAccess):String=access.baseUrl.trimEnd('/').toHttpUrl().newBuilder().encodedPath("/realtime/v1/websocket")
        .addQueryParameter("apikey",access.publicKey).addQueryParameter("vsn","1.0.0").build().toString()

    fun join(topic:String,token:String,ref:String):String=JSONObject()
        .put("topic",topic).put("event","phx_join").put("ref",ref).put("join_ref",ref)
        .put("payload",JSONObject().put("access_token",token).put("config",JSONObject()
            .put("broadcast",JSONObject().put("ack",false).put("self",false))
            .put("presence",JSONObject().put("key","").put("enabled",false))
            .put("private",false)
            .put("postgres_changes",JSONArray(TABLES.map {JSONObject().put("event","*").put("schema","public").put("table",it)}))))
        .toString()

    fun heartbeat(ref:String):String=JSONObject().put("topic","phoenix").put("event","heartbeat").put("payload",JSONObject()).put("ref",ref).toString()

    sealed interface Incoming {
        /** The server is listening to the database for this channel, so rows will now arrive. */
        data object Listening:Incoming
        /** The channel was refused or ended: an expired token, a server restart, or a join the server did not accept. */
        data class Ended(val reason:String):Incoming
        data class Row(val event:LiveEvent):Incoming
        data object Ignored:Incoming
    }

    fun parse(raw:String,topic:String):Incoming {
        val frame=runCatching {JSONObject(raw)}.getOrNull() ?: return Incoming.Ignored
        if(frame.optString("topic")!=topic) return Incoming.Ignored
        val payload=frame.optJSONObject("payload") ?: JSONObject()
        return when(frame.optString("event")) {
            "phx_reply" -> if(payload.optString("status")=="ok") Incoming.Ignored else Incoming.Ended("join_refused")
            "phx_error","phx_close" -> Incoming.Ended(frame.optString("event"))
            // Joining is not enough: rows only start once the server says it is listening, and a failed listen is an ending.
            "system" -> when {
                payload.optString("extension")!="postgres_changes" -> Incoming.Ignored
                payload.optString("status")=="ok" -> Incoming.Listening
                else -> Incoming.Ended("listen_failed")
            }
            "postgres_changes" -> {
                val data=payload.optJSONObject("data") ?: return Incoming.Ignored
                if(data.optString("type")=="DELETE") return Incoming.Ignored
                val record=data.optJSONObject("record") ?: return Incoming.Ignored
                runCatching {
                    when(data.optString("table")) {
                        "chat_messages" -> Incoming.Row(LiveEvent.Message(ChatJson.message(record)))
                        "chat_reads" -> Incoming.Row(LiveEvent.Read(ChatJson.read(record)))
                        else -> Incoming.Ignored
                    }
                }.getOrDefault(Incoming.Ignored)
            }
            else -> Incoming.Ignored
        }
    }

    /** 1, 2, 4, 8, 16 then 30 seconds between tries, so a server that is down is not hammered by every phone. */
    fun backoff(attempt:Int):Long=minOf(30_000L,1_000L shl minOf(attempt,5))
}

/**
 * The live connection, on the OkHttp the app already uses. It connects while collected, says when rows are flowing,
 * and reconnects after any drop with a fresh token. OkHttp's pings find a connection that died without closing.
 */
class LiveChat internal constructor(private val http:OkHttpClient,private val access:suspend ()->LiveAccess,private val backoff:(Int)->Long=RealtimeFrames::backoff):ChatLive {
    @Inject constructor(repository:ChatRepository):this(OkHttpClient.Builder().pingInterval(20,TimeUnit.SECONDS).build(),{repository.liveAccess()})

    override fun events():Flow<LiveEvent> = channelFlow {
        val attempt=AtomicInteger()
        while(true) {
            val granted=try {access()} catch(e:CancellationException) {throw e} catch(_:Exception) {null}
            if(granted!=null) {
                val topic="realtime:chat-${UUID.randomUUID()}"
                val ended=CompletableDeferred<Unit>()
                var refs=1
                val socket=http.newWebSocket(Request.Builder().url(RealtimeFrames.socketUrl(granted)).build(),object:WebSocketListener() {
                    override fun onOpen(webSocket:WebSocket,response:Response) {webSocket.send(RealtimeFrames.join(topic,granted.token,"1"))}
                    override fun onMessage(webSocket:WebSocket,text:String) {
                        when(val incoming=RealtimeFrames.parse(text,topic)) {
                            RealtimeFrames.Incoming.Listening -> {attempt.set(0); trySend(LiveEvent.Connection(true))}
                            is RealtimeFrames.Incoming.Row -> trySend(incoming.event)
                            is RealtimeFrames.Incoming.Ended -> webSocket.close(1000,null)
                            RealtimeFrames.Incoming.Ignored -> Unit
                        }
                    }
                    override fun onClosing(webSocket:WebSocket,code:Int,reason:String) {webSocket.close(1000,null); ended.complete(Unit)}
                    override fun onClosed(webSocket:WebSocket,code:Int,reason:String) {ended.complete(Unit)}
                    override fun onFailure(webSocket:WebSocket,t:Throwable,response:Response?) {ended.complete(Unit)}
                })
                val beat=launch {while(true) {delay(RealtimeFrames.HEARTBEAT_MS); if(!socket.send(RealtimeFrames.heartbeat((++refs).toString()))) ended.complete(Unit)}}
                try {ended.await()} finally {beat.cancel(); socket.cancel()}
            }
            // Whatever was said meanwhile never arrived, so whoever listens must read again when this turns true.
            trySend(LiveEvent.Connection(false))
            delay(backoff(attempt.getAndIncrement()))
        }
    }
}
