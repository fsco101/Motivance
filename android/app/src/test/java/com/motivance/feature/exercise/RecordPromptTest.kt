package com.motivance.feature.exercise

import org.junit.Assert.*
import org.junit.Test

/** #175: when to ask to record, the same cases as the web's prompt.test.ts. */
class RecordPromptTest {
    private val day=86_400_000L
    private val now=1_795_000_000_000L
    private fun after(prompt:RecordPrompt,sessions:Int)=(1..sessions).fold(prompt) {p,_ -> RecordPrompts.unrecorded(p)}

    @Test fun asksAPatientWhoWasNeverAsked() {assertTrue(RecordPrompts.shouldAsk(RecordPrompt(),now))}

    @Test fun afterNotNowAsksAgainOnlyAfterThreeSessionsWithoutRecording() {
        val once=RecordPrompts.declined(RecordPrompt(),now)
        assertFalse(RecordPrompts.shouldAsk(once,now))
        assertFalse(RecordPrompts.shouldAsk(after(once,2),now))
        assertTrue(RecordPrompts.shouldAsk(after(once,3),now))
    }

    @Test fun afterASecondNotNowAsksOnceMoreThirtyDaysLater() {
        val twice=RecordPrompts.declined(after(RecordPrompts.declined(RecordPrompt(),now),3),now)
        assertFalse(RecordPrompts.shouldAsk(after(twice,10),now+29*day))
        assertTrue(RecordPrompts.shouldAsk(twice,now+30*day))
    }

    @Test fun neverAsksAThirdTime() {
        val thrice=RecordPrompts.declined(RecordPrompts.declined(after(RecordPrompts.declined(RecordPrompt(),now),3),now),now+30*day)
        assertFalse(RecordPrompts.shouldAsk(after(thrice,50),now+400*day))
    }

    @Test fun stopsAtOnceOnDontAskAgainAndOnceAgreed() {
        assertFalse(RecordPrompts.shouldAsk(RecordPrompts.neverAsk(RecordPrompt()),now))
        assertFalse(RecordPrompts.shouldAsk(after(RecordPrompts.neverAsk(RecordPrompts.declined(RecordPrompt(),now)),5),now))
        assertFalse(RecordPrompts.shouldAsk(RecordPrompts.accepted(RecordPrompt()),now))
        assertEquals(0,RecordPrompts.unrecorded(RecordPrompts.accepted(RecordPrompt())).sessionsSince)
    }

    @Test fun anAgreementToTheOldTextIsAskedForAgain() {
        val stored=RecordPrompts.write(RecordPrompts.accepted(RecordPrompt()),"session-video-v1")
        assertFalse(RecordPrompts.read(stored,SessionVideoStore.CONSENT_VERSION).agreed)
        val current=RecordPrompts.write(RecordPrompts.declined(RecordPrompts.accepted(RecordPrompt()),now),SessionVideoStore.CONSENT_VERSION)
        assertEquals(RecordPrompt(agreed=true,declines=1,declinedAt=now),RecordPrompts.read(current,SessionVideoStore.CONSENT_VERSION))
        assertEquals(RecordPrompt(),RecordPrompts.read("{not json",SessionVideoStore.CONSENT_VERSION))
        assertEquals(RecordPrompt(),RecordPrompts.read(null,SessionVideoStore.CONSENT_VERSION))
    }
}
