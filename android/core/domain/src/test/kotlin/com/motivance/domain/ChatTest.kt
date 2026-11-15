package com.motivance.domain

import java.time.LocalDateTime
import java.time.ZoneId
import org.junit.Assert.*
import org.junit.Test

/** The same cases as web/src/features/chat/thread.test.ts, so both apps draw a thread the same way. */
class ChatTest {
    private val zone=ZoneId.of("Asia/Manila")
    private fun local(day:Int,hour:Int)=LocalDateTime.of(2026,11,day,hour,0).atZone(zone).toOffsetDateTime().toString()
    private fun message(id:String,createdAt:String,sender:String?="me",deleted:Boolean=false,kind:MessageKind?=MessageKind.TEXT)=
        ChatMessage(id,"c",sender,kind,if(deleted) "" else id,createdAt,deleted)
    private fun waiting(id:String,failed:Boolean=false,at:Long=java.time.Instant.parse("2026-11-03T04:00:00Z").toEpochMilli())=Outgoing(id,"c",id,at,failed)
    private fun List<ThreadItem>.ids()=map {if(it is ThreadItem.Message) it.message.id else "day"}

    @Test fun runsOldestFirstWithALineWhereEachDayStarts() {
        val items=threadItems(listOf(message("c",local(3,9),"them"),message("b",local(2,18)),message("a",local(2,9),"them")),emptyList(),"me",null,zone)
        assertEquals(listOf("day","a","b","day","c"),items.ids())
        assertEquals(listOf(false,true,false),items.filterIsInstance<ThreadItem.Message>().map {it.mine})
    }

    @Test fun daysFollowTheReadersCalendarNotUtc() {
        // 07:00 in Manila is still the day before in UTC.
        val items=threadItems(listOf(message("b",local(3,7)),message("a",local(2,20))),emptyList(),"me",null,zone)
        assertEquals(listOf("day","a","day","b"),items.ids())
    }

    @Test fun marksOnlyMyNewestDeliveredMessageSeenOnceReadThatFar() {
        val messages=listOf(message("b",local(2,10)),message("a",local(2,9)))
        fun seen(readAt:String?)=threadItems(messages,emptyList(),"me",readAt,zone).filterIsInstance<ThreadItem.Message>().filter {it.seen}.map {it.message.id}
        assertEquals(emptyList<String>(),seen(null))
        assertEquals(emptyList<String>(),seen(local(2,9)))
        assertEquals(listOf("b"),seen(local(2,11)))
        // A message I took back is not what they saw.
        val taken=threadItems(listOf(message("b",local(2,10),deleted=true),message("a",local(2,9))),emptyList(),"me",local(2,11),zone)
        assertEquals(listOf("a"),taken.filterIsInstance<ThreadItem.Message>().filter {it.seen}.map {it.message.id})
    }

    @Test fun showsWhatIsOnItsWayAfterEverythingDeliveredAndDropsItOnceTheServerHasIt() {
        val items=threadItems(listOf(message("a",local(3,9))),listOf(waiting("y",true,2),waiting("x",at=1),waiting("a")),"me",null,zone)
        assertEquals(listOf("a" to SendState.SENT,"x" to SendState.SENDING,"y" to SendState.FAILED),
            items.filterIsInstance<ThreadItem.Message>().map {it.message.id to it.state})
    }

    @Test fun readsServerTimesWithMicrosecondsAndOffsets() {
        assertEquals(java.time.Instant.parse("2026-11-15T07:20:00.123456Z"),parseServerTime("2026-11-15T07:20:00.123456+00:00"))
        assertEquals(java.time.Instant.parse("2026-11-15T07:20:00Z"),parseServerTime("2026-11-15T15:20:00+08:00"))
        assertEquals(java.time.Instant.parse("2026-11-15T07:20:00Z"),parseServerTime("2026-11-15T07:20:00Z"))
        assertEquals(java.time.Instant.parse("2026-11-15T07:20:00.1Z"),parseServerTime("2026-11-15 07:20:00.1+00"))
        assertEquals(java.time.Instant.parse("2026-11-15T07:20:00Z"),parseServerTime("2026-11-15 15:20:00+08"))
    }

    @Test fun takingAMessageBackIsOfferedOnlyForMyOwnWordsForAQuarterOfAnHour() {
        val now=java.time.Instant.parse("2026-11-03T04:00:00Z").toEpochMilli()
        fun ago(minutes:Long)=java.time.Instant.ofEpochMilli(now-minutes*60_000).toString()
        assertTrue(message("a",ago(14)).deletable("me",now))
        assertFalse(message("a",ago(16)).deletable("me",now))
        assertFalse(message("a",ago(1),"them").deletable("me",now))
        assertFalse(message("a",ago(1),deleted=true).deletable("me",now))
        assertFalse(message("a",ago(1),kind=MessageKind.SYSTEM).deletable("me",now))
    }

    @Test fun liveMessagesAreAddedInOrderOrReplaceTheirEarlierCopy() {
        val list=listOf(message("b",local(2,10)),message("a",local(2,9)))
        assertEquals(listOf("c","b","a"),list.merge(message("c",local(2,11))).map {it.id})
        assertEquals(listOf("b" to false,"a" to true),list.merge(message("a",local(2,9),deleted=true)).map {it.id to it.deleted})
        // Two messages in the same instant keep one order on every phone.
        assertEquals(listOf("y","x"),emptyList<ChatMessage>().merge(message("x",local(2,9))).merge(message("y",local(2,9))).map {it.id})
    }

    @Test fun messagesGoInTheOrderWrittenAndARefusedOneDoesNotHoldUpTheRest() {
        assertEquals("x",listOf(waiting("y",at=2),waiting("x",at=1)).nextToSend()?.id)
        assertEquals("y",listOf(waiting("y",at=2),waiting("x",true,1)).nextToSend()?.id)
        assertNull(listOf(waiting("x",true)).nextToSend())
    }

    @Test fun onlyAServerRefusalNeedsThePerson() {
        assertEquals(SendFailure.OFFLINE,sendFailure(java.io.IOException("airplane mode")))
        assertEquals(SendFailure.OFFLINE,sendFailure(RemoteFailure(503)))
        assertEquals(SendFailure.OFFLINE,sendFailure(RemoteFailure(429)))
        assertEquals(SendFailure.REFUSED,sendFailure(RemoteFailure(400,"chat_closed")))
        assertEquals(SendFailure.SIGNED_OUT,sendFailure(RemoteFailure(401)))
    }
}
