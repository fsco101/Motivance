package com.motivance.domain

import java.util.Locale
import java.util.TimeZone
import org.junit.Assert.*
import org.junit.Test

class SessionFormatTest {
    private val format=SessionFormat(Locale.US)
    // Newer Java versions separate the time and AM with a narrow space.
    private fun plain(value:String)=value.replace(' ',' ')

    @Test fun nineInManilaReadsAsNine() {
        assertEquals("9:00 AM",plain(format.time("2026-12-07T01:00:00+00:00")))
        assertEquals("Mon, Dec 7, 2026",format.day("2026-12-07T01:00:00+00:00"))
    }

    @Test fun aSessionReadsWithItsSpecificStartAndEnd() {
        assertEquals("9:00 AM – 10:00 AM",plain(format.range("2026-12-07T01:00:00+00:00","2026-12-07T02:00:00+00:00")))
        assertEquals("Mon, Dec 7, 2026, 9:00 AM – 10:00 AM",plain(format.whenAt("2026-12-07T01:00:00+00:00","2026-12-07T02:00:00+00:00")))
    }

    /** The promise that matters: a phone set elsewhere still shows the real session time. */
    @Test fun thePhonesOwnZoneChangesNothing() {
        val original=TimeZone.getDefault()
        try {
            TimeZone.setDefault(TimeZone.getTimeZone("America/New_York"))
            assertEquals("9:00 AM",plain(SessionFormat(Locale.US).time("2026-12-07T01:00:00+00:00")))
            assertEquals("Mon, Dec 7, 2026",SessionFormat(Locale.US).day("2026-12-07T01:00:00+00:00"))
        } finally {TimeZone.setDefault(original)}
    }

    @Test fun theWeekStartsOnMonday() {
        assertEquals(listOf("Mon","Tue","Wed","Thu","Fri","Sat","Sun"),format.weekdays)
    }

    @Test fun aSessionNearMidnightStaysOnTheCentersDate() {
        assertEquals("Sat, Dec 5, 2026",format.day("2026-12-04T17:00:00+00:00"))
    }
}
