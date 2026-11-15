package com.motivance.data.remote

import com.motivance.domain.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ChatJsonTest {
    private val conversation="30000000-0000-0000-0000-000000000001"
    private val me="10000000-0000-0000-0000-000000000001"

    @Test fun readsConversationsAsTheServerFunctionReturnsThem() {
        val list=ChatJson.conversations("""[{"id":"$conversation","side":"patient","other_id":"t1","other_name":"Dana Reyes","other_photo":null,"open":false,
            "last_message_at":"2026-11-15T07:20:00.123456+00:00","unread":2,
            "last_message":{"id":"m1","conversation_id":"$conversation","sender_id":"t1","kind":"text","body":"Hello","data":{},"created_at":"2026-11-15T07:20:00.123456+00:00","deleted":false}},
            {"id":"c2","side":"therapist","other_id":"p2","other_name":"","other_photo":"https://example.test/p.jpg","open":true,"last_message_at":null,"last_message":null,"unread":0}]""")
        assertEquals(Conversation(conversation,true,"t1","Dana Reyes",null,false,"2026-11-15T07:20:00.123456+00:00",
            ChatMessage("m1",conversation,"t1",MessageKind.TEXT,"Hello","2026-11-15T07:20:00.123456+00:00"),2),list[0])
        assertEquals(Conversation("c2",false,"p2","","https://example.test/p.jpg",true,null,null,0),list[1])
    }

    @Test fun readsAPageAndHowFarTheOtherPersonHasRead() {
        val page=ChatJson.page("""{"messages":[{"id":"m2","conversation_id":"c","sender_id":null,"kind":"system","body":"Daily practice reminder","data":{},"created_at":"2026-11-15T08:00:00+00:00","deleted":false},
            {"id":"m1","conversation_id":"c","sender_id":"$me","kind":"text","body":"","data":{},"created_at":"2026-11-15T07:00:00+00:00","deleted":true}],
            "more":true,"open":true,"other_read_at":"2026-11-15T07:30:00+00:00"}""")
        assertEquals(listOf("m2","m1"),page.messages.map {it.id})
        assertNull(page.messages[0].senderId)
        assertEquals(MessageKind.SYSTEM,page.messages[0].kind)
        assertTrue(page.messages[1].deleted)
        assertTrue(page.more && page.open)
        assertEquals("2026-11-15T07:30:00+00:00",page.otherReadAt)
    }

    @Test fun aLiveRowCarriesDeletedAtInsteadAndNeverItsWords() {
        val row=JSONObject("""{"id":"m1","conversation_id":"c","sender_id":"$me","kind":"text","body":"leaked?","data":{},"created_at":"2026-11-15 07:00:00.5+00","deleted_at":"2026-11-15 07:05:00+00"}""")
        val message=ChatJson.message(row)
        assertTrue(message.deleted)
        assertEquals("",message.body)
        assertEquals(java.time.Instant.parse("2026-11-15T07:00:00.5Z"),message.at)
        assertFalse(ChatJson.message(row.put("deleted_at",JSONObject.NULL).put("body","Hello")).deleted)
    }

    @Test fun readsTheAgreementAndWhetherAConversationWaitsForIt() {
        assertEquals(ChatConsent("care-chat-v1",true,"2026-11-15T07:00:00+00:00"),ChatJson.consent("""{"version":"care-chat-v1","granted":true,"at":"2026-11-15T07:00:00+00:00"}"""))
        assertEquals(ChatConsent("care-chat-v1",false,null),ChatJson.consent("""{"version":"care-chat-v1","granted":false,"at":null}"""))
        val waiting=ChatJson.conversations("""[{"id":"c","side":"therapist","other_id":"p","other_name":"Ana","other_photo":null,"open":false,"consented":false,"last_message_at":null,"last_message":null,"unread":0}]""").single()
        assertFalse(waiting.open); assertFalse(waiting.consented)
        assertFalse(ChatJson.page("""{"messages":[],"more":false,"open":false,"consented":false,"other_read_at":null}""").consented)
    }

    @Test fun aKindThisVersionDoesNotKnowIsKeptAndSaidToBeUnshowable() {
        val message=ChatJson.message(JSONObject("""{"id":"m","conversation_id":"c","sender_id":"x","kind":"poll","body":"","data":{},"created_at":"2026-11-15T07:00:00Z","deleted":false}"""))
        assertNull(message.kind)
    }
}

class RealtimeFramesTest {
    private val access=LiveAccess("http://10.0.2.2:54321","public-key","jwt-token")
    private val topic="realtime:chat-test"

    @Test fun opensAtTheSameHostAsTheRestOfTheApp() {
        val local=RealtimeFrames.socketUrl(access).toHttpUrl()
        assertEquals("10.0.2.2",local.host); assertEquals(54321,local.port); assertEquals("/realtime/v1/websocket",local.encodedPath)
        assertEquals("public-key",local.queryParameter("apikey")); assertEquals("1.0.0",local.queryParameter("vsn"))
        val hosted=RealtimeFrames.socketUrl(access.copy(baseUrl="https://project.supabase.co/")).toHttpUrl()
        assertTrue(hosted.isHttps); assertEquals("project.supabase.co",hosted.host)
    }

    @Test fun joinsWithTheReadersTokenForBothChatTables() {
        val join=JSONObject(RealtimeFrames.join(topic,"jwt-token","1"))
        assertEquals(topic,join.getString("topic")); assertEquals("phx_join",join.getString("event")); assertEquals("1",join.getString("join_ref"))
        val payload=join.getJSONObject("payload")
        assertEquals("jwt-token",payload.getString("access_token"))
        val changes=payload.getJSONObject("config").getJSONArray("postgres_changes")
        assertEquals(listOf("chat_messages","chat_reads"),(0 until changes.length()).map {changes.getJSONObject(it).getString("table")})
        assertEquals("phoenix",JSONObject(RealtimeFrames.heartbeat("7")).getString("topic"))
    }

    @Test fun isLiveOnlyOnceTheServerIsListeningToTheDatabase() {
        assertEquals(RealtimeFrames.Incoming.Ignored,RealtimeFrames.parse("""{"topic":"$topic","event":"phx_reply","payload":{"status":"ok","response":{}},"ref":"1"}""",topic))
        assertEquals(RealtimeFrames.Incoming.Listening,RealtimeFrames.parse("""{"topic":"$topic","event":"system","payload":{"extension":"postgres_changes","status":"ok","message":"Subscribed to PostgreSQL"}}""",topic))
        assertTrue(RealtimeFrames.parse("""{"topic":"$topic","event":"system","payload":{"extension":"postgres_changes","status":"error","message":"no"}}""",topic) is RealtimeFrames.Incoming.Ended)
        assertTrue(RealtimeFrames.parse("""{"topic":"$topic","event":"phx_reply","payload":{"status":"error","response":{"reason":"Token has expired"}},"ref":"1"}""",topic) is RealtimeFrames.Incoming.Ended)
        assertTrue(RealtimeFrames.parse("""{"topic":"$topic","event":"phx_close","payload":{}}""",topic) is RealtimeFrames.Incoming.Ended)
    }

    @Test fun readsMessagesAndReadMarksAndIgnoresEverythingElse() {
        val message=RealtimeFrames.parse("""{"topic":"$topic","event":"postgres_changes","payload":{"ids":[1],"data":{"type":"INSERT","table":"chat_messages","schema":"public",
            "record":{"id":"m1","conversation_id":"c","sender_id":"t","kind":"text","body":"Hi","data":{},"created_at":"2026-11-15T07:00:00+00:00","deleted_at":null}}}}""",topic)
        assertEquals("Hi",((message as RealtimeFrames.Incoming.Row).event as LiveEvent.Message).message.body)
        val read=RealtimeFrames.parse("""{"topic":"$topic","event":"postgres_changes","payload":{"data":{"type":"UPDATE","table":"chat_reads",
            "record":{"conversation_id":"c","user_id":"p","read_at":"2026-11-15T07:01:00+00:00"}}}}""",topic)
        assertEquals(ReadMark("c","p","2026-11-15T07:01:00+00:00"),((read as RealtimeFrames.Incoming.Row).event as LiveEvent.Read).mark)
        listOf(
            """{"topic":"realtime:someone-else","event":"system","payload":{"extension":"postgres_changes","status":"ok"}}""",
            """{"topic":"phoenix","event":"phx_reply","payload":{"status":"ok"},"ref":"2"}""",
            """{"topic":"$topic","event":"postgres_changes","payload":{"data":{"type":"DELETE","table":"chat_messages","old_record":{"id":"m1"}}}}""",
            """{"topic":"$topic","event":"postgres_changes","payload":{"data":{"type":"INSERT","table":"profiles","record":{}}}}""",
            """{"topic":"$topic","event":"postgres_changes","payload":{"data":{"type":"INSERT","table":"chat_messages","record":{"id":"broken"}}}}""",
            "not json",
        ).forEach {assertEquals(it,RealtimeFrames.Incoming.Ignored,RealtimeFrames.parse(it,topic))}
    }

    @Test fun waitsLongerAfterEachFailureUpToHalfAMinute() {
        assertEquals(listOf(1_000L,2_000L,4_000L,8_000L,16_000L,30_000L,30_000L),(0..6).map(RealtimeFrames::backoff))
        assertEquals(30_000L,RealtimeFrames.backoff(40))
    }
}
