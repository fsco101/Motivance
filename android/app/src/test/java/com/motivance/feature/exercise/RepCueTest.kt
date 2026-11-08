package com.motivance.feature.exercise

import com.motivance.assessment.RepOutcome
import com.motivance.domain.RepFeedback
import java.util.Locale
import kotlin.random.Random
import org.junit.Assert.*
import org.junit.Test

/** Issue #96: what the voice says after each repetition, and in which language. */
class RepCueTest {
    private val missed=mapOf(RepFeedback.INCOMPLETE_RANGE to "Reach and hold",RepFeedback.TOO_FAST to "Slower",RepFeedback.TIMED_OUT to "From the start")

    @Test fun praiseVariesAndNeverRepeatsTheLineJustSpoken() {
        val script=RepCueScript(listOf("Great!","Nice!","Well done!"),missed,Random(7))
        val lines=(1..60).map {script.lineFor(RepOutcome.Counted(it))}
        lines.zipWithNext().forEach {(a,b) -> assertNotEquals(a,b)}
        assertEquals(setOf("Great!","Nice!","Well done!"),lines.toSet())
    }
    @Test fun aSinglePraiseLineStillPlaysEveryTime() {
        val script=RepCueScript(listOf("Great!"),missed,Random(1))
        assertEquals(listOf("Great!","Great!"),listOf(script.lineFor(RepOutcome.Counted(1)),script.lineFor(RepOutcome.Counted(2))))
    }
    @Test fun aMissedAttemptSaysWhatToTryForItsReason() {
        val script=RepCueScript(listOf("Great!"),missed,Random(1))
        assertEquals("Slower",script.lineFor(RepOutcome.Missed(RepFeedback.TOO_FAST)))
        assertEquals("From the start",script.lineFor(RepOutcome.Missed(RepFeedback.TIMED_OUT)))
        assertEquals("Reach and hold",script.lineFor(RepOutcome.Missed(RepFeedback.INCOMPLETE_RANGE)))
    }
    @Test fun filipinoIsSpokenWhenThePhoneHasAFilipinoVoice() {
        assertEquals(CueVoice.Choice(Locale.forLanguageTag("fil-PH"),"fil"),CueVoice.choose("fil") {it.toLanguageTag()=="fil-PH" || it.language=="en"})
        // Some engines still name Filipino by its older Tagalog code.
        assertEquals(CueVoice.Choice(Locale.forLanguageTag("tl-PH"),"fil"),CueVoice.choose("fil") {it.toLanguageTag()=="tl-PH"})
    }
    @Test fun withoutAFilipinoVoiceTheEnglishPhraseIsSpoken() {
        assertEquals(CueVoice.Choice(Locale.US,"en"),CueVoice.choose("fil") {it.language=="en"})
    }
    @Test fun englishStaysEnglishEvenWhereFilipinoExists() {
        assertEquals(CueVoice.Choice(Locale.US,"en"),CueVoice.choose("en") {true})
    }
    @Test fun aPhoneWithNoUsableVoiceGetsNoVoice() {
        assertNull(CueVoice.choose("fil") {false})
        assertNull(CueVoice.choose("en") {false})
    }
}
