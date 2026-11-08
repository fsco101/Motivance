package com.motivance.domain

import org.junit.Assert.*
import org.junit.Test

/** Issue #97: timing is stored in milliseconds but shown and typed in seconds. */
class SecondsTest {
    @Test fun storedMillisecondsReadAsPlainSeconds() {
        val cases=mapOf(600L to "0.6",1000L to "1",1250L to "1.25",30_000L to "30",100L to "0.1",0L to "0",5L to "0.005",300_000L to "300")
        cases.forEach {(ms,text) -> assertEquals("$ms ms",text,Seconds.text(ms))}
    }
    @Test fun typedSecondsBecomeExactMilliseconds() {
        val cases=mapOf("0.6" to 600L,"1" to 1000L,"1.25" to 1250L," 30 " to 30_000L,"0,5" to 500L,".5" to 500L,"0" to 0L,"0.005" to 5L,"2." to 2000L)
        cases.forEach {(text,ms) -> assertEquals("'$text'",ms,Seconds.parseMs(text))}
    }
    @Test fun unreadableOrUnstorableSecondsAreRefused() {
        listOf("","  ","-1","abc","1.2.3","0.0005","1e3","∞","NaN","1 000").forEach {assertNull("'$it'",Seconds.parseMs(it))}
    }
    @Test fun everyStoredValueSurvivesARoundTrip() {
        listOf(0L,1L,99L,100L,600L,1001L,29_999L,30_000L,300_000L).forEach {assertEquals(it,Seconds.parseMs(Seconds.text(it)))}
    }
}
