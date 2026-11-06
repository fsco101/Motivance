package com.motivance.domain

import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import org.junit.Assert.*
import org.junit.Test

class BookingTest {
    private fun booking(starts:String,status:BookingStatus=BookingStatus.CONFIRMED)=Booking(starts,"BK",status,null,starts,starts.replace("01:00","02:00"),null,null)
    private val now=Instant.parse("2026-12-01T00:00:00Z")

    @Test fun readsTheOffsetPostgresWrites() {
        assertEquals(Instant.parse("2026-12-07T01:00:00Z"),bookingInstant("2026-12-07T01:00:00+00:00"))
        assertEquals(Instant.parse("2026-12-07T01:00:00Z"),bookingInstant("2026-12-07T09:00:00+08:00"))
    }

    @Test fun todayFollowsTheCenterRatherThanThePhone() {
        assertEquals(LocalDate.parse("2026-11-07"),centerToday(Instant.parse("2026-11-06T20:00:00Z")))
    }

    @Test fun onlyActiveBookingsStillToComeAreUpcoming() {
        assertTrue(booking("2026-12-07T01:00:00+00:00").upcoming(now))
        assertTrue(booking("2026-12-07T01:00:00+00:00",BookingStatus.PENDING).upcoming(now))
        assertTrue(booking("2026-12-07T01:00:00+00:00",BookingStatus.RESCHEDULED).upcoming(now))
        assertFalse(booking("2026-12-07T01:00:00+00:00",BookingStatus.CANCELLED).upcoming(now))
        assertFalse(booking("2026-12-07T01:00:00+00:00",BookingStatus.REJECTED).upcoming(now))
        assertFalse(booking("2026-11-07T01:00:00+00:00").upcoming(now))
    }

    @Test fun theNextSessionIsTheSoonestWhateverTheOrder() {
        val list=listOf(booking("2026-12-09T01:00:00+00:00"),booking("2026-12-07T01:00:00+00:00"),booking("2026-11-07T01:00:00+00:00"),booking("2026-12-02T01:00:00+00:00",BookingStatus.REJECTED))
        assertEquals("2026-12-07T01:00:00+00:00",list.nextSession(now)?.id)
        assertNull(emptyList<Booking>().nextSession(now))
    }

    @Test fun aSlotIsBookableOnlyWithPlacesAndNotAlreadyHeld() {
        assertTrue(BookingSlot("a","b",1).bookable)
        assertFalse(BookingSlot("a","b",0).bookable)
        assertFalse(BookingSlot("a","b",2,mine=true).bookable)
    }

    @Test fun aDayHasPlacesOnlyWhenOpenWithAFreeSlot() {
        assertTrue(BookingDay("d",BookingDayStatus.OPEN,slots=listOf(BookingSlot("a","b",1))).hasPlaces)
        assertFalse(BookingDay("d",BookingDayStatus.OPEN,slots=listOf(BookingSlot("a","b",0))).hasPlaces)
        assertFalse(BookingDay("d",BookingDayStatus.HOLIDAY).hasPlaces)
    }

    @Test fun anUnknownDayStatusIsTreatedAsClosed() {
        assertEquals(BookingDayStatus.TOO_SOON,BookingDayStatus.of("too_soon"))
        assertEquals(BookingDayStatus.CLOSED,BookingDayStatus.of("something_new"))
    }

    @Test fun aMonthStartsOnMondayAndFillsWholeWeeks() {
        val weeks=YearMonth.of(2026,11).calendarWeeks()
        assertTrue(weeks.all {it.size==7})
        assertEquals("November 2026 begins on a Sunday",List(6) {null}+LocalDate.of(2026,11,1),weeks.first())
        assertEquals(30,weeks.flatten().count {it!=null})
    }
}
