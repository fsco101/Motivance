package com.motivance.feature.exercise

import com.motivance.domain.BodySide
import org.junit.Assert.*
import org.junit.Test

/** What the voice says between the sides of a set. */
class SetCueLinesTest {
    private val lines=SetCueLines("Target reached. Keep going until the time is up.","%1\$s done. Next: %2\$s, %3\$s.","Start.","Exercise complete.",
        mapOf(BodySide.LEFT to "Left side",BodySide.RIGHT to "Right side"))

    @Test fun theNextSideIsNamedWithTheExercise() {
        assertEquals("Left side done. Next: Right side, Elbow flexion.",lines.lineFor(SetCue.SideDone(BodySide.LEFT,BodySide.RIGHT),"Elbow flexion"))
    }
    @Test fun theCountdownSpeaksEachNumberThenStart() {
        assertEquals("3",lines.lineFor(SetCue.Count(3),"Elbow flexion"))
        assertEquals("Start.",lines.lineFor(SetCue.Go,"Elbow flexion"))
    }
    @Test fun theTargetAndTheEndAreAnnounced() {
        assertEquals("Target reached. Keep going until the time is up.",lines.lineFor(SetCue.TargetReached,"Elbow flexion"))
        assertEquals("Exercise complete.",lines.lineFor(SetCue.Complete,"Elbow flexion"))
    }
}
