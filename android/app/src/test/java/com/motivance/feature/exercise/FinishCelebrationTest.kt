package com.motivance.feature.exercise

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.abs

/** The finish tune and the words that go with it (#130). */
class FinishCelebrationTest {
    private val lines=FinishLines("Great work! Exercise finished.","Good effort today: %1\$d of %2\$d.","That was today's last exercise.")

    @Test fun reachingTheTargetIsCelebratedAndFallingShortIsSaidKindly() {
        assertEquals("Great work! Exercise finished.",lines.lineFor(10,10,lastOfDay=false))
        assertEquals("Great work! Exercise finished.",lines.lineFor(12,10,lastOfDay=false))
        assertEquals("Good effort today: 8 of 10.",lines.lineFor(8,10,lastOfDay=false))
    }

    @Test fun theLastExerciseOfTheDaySaysSo() {
        assertEquals("Great work! Exercise finished. That was today's last exercise.",lines.lineFor(10,10,lastOfDay=true))
        assertEquals("Good effort today: 3 of 10. That was today's last exercise.",lines.lineFor(3,10,lastOfDay=true))
    }

    @Test fun theTuneIsShortAudibleAndNeverClips() {
        val pcm=FinishChime.samples()
        val seconds=pcm.size.toDouble()/FinishChime.SAMPLE_RATE
        assertEquals(FinishChime.NOTES.sumOf {it.second}/1000.0,seconds,.01)
        assertTrue("under a second, so it never holds up the results",seconds<1.0)
        val peak=pcm.maxOf {abs(it.toInt())}
        assertTrue("loud enough to hear",peak>Short.MAX_VALUE*.15)
        assertTrue("with room to spare below clipping",peak<Short.MAX_VALUE*.5)
    }

    @Test fun eachNoteStartsAndEndsInSilenceSoNothingClicks() {
        val pcm=FinishChime.samples()
        var start=0
        for((_,ms) in FinishChime.NOTES) {
            val count=FinishChime.SAMPLE_RATE*ms/1000
            assertTrue(abs(pcm[start].toInt())<200)
            assertTrue(abs(pcm[start+count-1].toInt())<200)
            start+=count
        }
    }

    @Test fun theNotesRise() {
        val frequencies=FinishChime.NOTES.map {it.first}
        assertEquals(frequencies.sorted(),frequencies)
    }
}
