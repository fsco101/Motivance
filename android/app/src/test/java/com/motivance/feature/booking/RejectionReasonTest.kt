package com.motivance.feature.booking

import com.motivance.R
import com.motivance.data.remote.BookingJson
import com.motivance.domain.BookingStatus
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

/** #172: a Scheduler's common reason reads as a sentence in the patient's language; their own words read as written. */
class RejectionReasonTest {
    @Test fun eachCommonReasonHasItsOwnSentence() {
        val sentences=REJECTION_CODES.map {bookingReasonRes(it)}
        assertTrue(sentences.none {it==null})
        assertEquals(REJECTION_CODES.size,sentences.toSet().size)
        assertEquals(R.string.booking_reject_therapist_away,bookingReasonRes("therapist_away"))
        assertEquals(R.string.booking_reason_expired,bookingReasonRes("request_expired"))
    }

    @Test fun aSchedulersOwnWordsAreNotACode() {
        assertNull(bookingReasonRes("The therapy room is being repaired."))
        assertNull(bookingReasonRes("Therapist_Away"))
    }

    /** The same five codes as the server's rejection_codes() and the web's REJECTION_CODES, so no app shows a raw code. */
    @Test fun theCodesMatchTheServerAndTheWeb() {
        val root=generateSequence(File("").absoluteFile) {it.parentFile}.first {File(it,"supabase/migrations").isDirectory}
        val migration=File(root,"supabase/migrations/202611240001_rejection_reasons.sql").readText()
        val web=File(root,"web/src/data/booking.ts").readText()
        REJECTION_CODES.forEach {
            assertTrue("server lacks $it",migration.contains("'$it'"))
            assertTrue("web lacks $it",web.contains("'$it'"))
        }
    }

    @Test fun eachSentenceIsWrittenInEnglishAndFilipino() {
        val root=generateSequence(File("").absoluteFile) {it.parentFile}.first {File(it,"app/src/main/res").isDirectory || File(it,"android/app/src/main/res").isDirectory}
        val res=if(File(root,"app/src/main/res").isDirectory) File(root,"app/src/main/res") else File(root,"android/app/src/main/res")
        val english=File(res,"values/strings.xml").readText()
        val filipino=File(res,"values-fil/strings.xml").readText()
        REJECTION_CODES.forEach {
            assertTrue(english.contains("name=\"booking_reject_$it\""))
            assertTrue(filipino.contains("name=\"booking_reject_$it\""))
        }
    }

    @Test fun aRejectedBookingCarriesTheCodeAndTheNote() {
        val booking=BookingJson.booking(JSONObject("""{"id":"b1","reference_no":"BK-1","status":"rejected","status_reason":"therapist_away","status_note":"Back on Monday.",
            "starts_at":"2026-12-07T01:00:00+00:00","ends_at":"2026-12-07T02:00:00+00:00","previous_starts_at":null,"therapist_name":null,"visit_reason":"Knee pain"}"""))
        assertEquals(BookingStatus.REJECTED,booking.status)
        assertEquals("therapist_away",booking.reason)
        assertEquals("Back on Monday.",booking.note)
        assertEquals("Knee pain",booking.visitReason)
        // An older server sends no note.
        assertNull(BookingJson.booking(JSONObject("""{"id":"b1","reference_no":"BK-1","status":"rejected","status_reason":"Too late","starts_at":"2026-12-07T01:00:00+00:00",
            "ends_at":"2026-12-07T02:00:00+00:00","previous_starts_at":null,"therapist_name":null}""")).note)
    }

    @Test fun theRejectedNotificationCarriesTheNote() {
        val inbox=BookingJson.inbox(JSONObject("""{"unread":1,"rows":[{"id":"n1","kind":"rejected","booking_id":"b1","read_at":null,"created_at":"2026-12-01T02:00:00+00:00",
            "data":{"reference_no":"BK-1","starts_at":"2026-12-07T01:00:00+00:00","ends_at":"2026-12-07T02:00:00+00:00","reason":"outside_hours","note":"Open 8 to 5."}}]}"""))
        assertEquals("outside_hours",inbox.items.single().reason)
        assertEquals("Open 8 to 5.",inbox.items.single().note)
    }
}
