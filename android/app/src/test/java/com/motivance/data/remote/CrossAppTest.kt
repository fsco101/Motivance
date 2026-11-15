package com.motivance.data.remote

import com.motivance.domain.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/**
 * Android reads what the web writes, and the web reads what Android writes. The fixtures in `resources/cross-app` are kept by
 * the web's `chat-cross-app.test.ts` from real server rows, so a change in shape on either side fails one of the two tests.
 */
class CrossAppTest {
    private fun fixture(name:String)=javaClass.classLoader!!.getResource("cross-app/$name")!!.readText()

    @Test fun everyKindTheWebWritesIsReadByAndroid() {
        val page=ChatJson.page(fixture("web-thread.json"))
        assertTrue(page.open && page.consented && page.media && !page.more)
        assertNotNull(page.otherReadAt)
        val byBody=page.messages.associateBy {it.body}
        assertEquals(8,page.messages.size)
        assertEquals(MessageKind.TEXT,byBody.getValue("Hello from the web").kind)
        assertEquals(MessageKind.TEXT,byBody.getValue("A scheduled hello").kind)

        val photo=byBody.getValue("My setup").attachment!!
        assertEquals(MediaKind.IMAGE,photo.kind); assertEquals("image/jpeg",photo.mime)
        assertEquals(1600,photo.width); assertEquals(1200,photo.height); assertNull(photo.durationMs); assertEquals(50_000L,photo.bytes)
        assertTrue(photo.mediaPath.endsWith("/media.jpg") && photo.previewPath.endsWith("/preview.jpg"))
        val video=page.messages.single {it.attachment?.kind==MediaKind.VIDEO}.attachment!!
        assertEquals("video/webm",video.mime); assertEquals(12_000L,video.durationMs); assertEquals(640,video.width)

        val activity=byBody.getValue("My month").card as ChatCard.Activity
        assertEquals(ChatCard.Activity(4,2,9,3,0,activity.asOf),activity); assertNotNull(activity.asOf)
        val series=page.messages.single {it.card is ChatCard.Series}.card as ChatCard.Series
        assertEquals(ChatCard.Series("Elbow flexion","left",98.5,101.0,-2.5,7,20.0,90.0,series.asOf),series)
        val exercise=byBody.getValue("Tonight").card as ChatCard.Exercise
        assertEquals(1,exercise.version); assertEquals("Elbow flexion",exercise.exercise); assertEquals(8,exercise.repetitions); assertEquals(20.0,exercise.low,0.0)

        val line=page.messages.single {it.kind==MessageKind.SYSTEM}
        assertNull(line.senderId); assertEquals(SystemLine.PracticeReminder("2026-11-15"),line.line)
        // Every time the server wrote is one Android can read.
        page.messages.forEach {parseServerTime(it.createdAt)}
    }

    @Test fun theWebsConversationListIsReadByAndroid() {
        val conversation=ChatJson.conversations(fixture("web-conversations.json")).single()
        assertTrue(conversation.asPatient); assertTrue(conversation.open); assertTrue(conversation.media); assertFalse(conversation.muted)
        assertEquals("Cross Therapist",conversation.otherName)
        // Lines are never unread and never the last line shown.
        assertEquals(3,conversation.unread)
        assertEquals("A scheduled hello",conversation.lastMessage?.body)
    }

    @Test fun theProgressFactsAndroidWritesAreTheOnesTheWebReads() {
        val written=JSONObject(fixture("android-progress.json"))
        fun same(expected:JSONObject,actual:JSONObject) {
            assertEquals(expected.keys().asSequence().toSet(),actual.keys().asSequence().toSet())
            expected.keys().forEach {key -> assertEquals(key,expected.get(key).toString(),actual.get(key).toString())}
        }
        same(written.getJSONObject("activity"),ChatJson.progressFacts(ChatCard.Activity(4,2,9,3,null)))
        same(written.getJSONObject("series"),ChatJson.progressFacts(ChatCard.Series("Elbow flexion","left",90.3,90.3,20.3,2,20.0,120.0)))
    }
}
