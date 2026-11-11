package com.motivance.domain

import org.junit.Assert.*
import org.junit.Test

/** Both sides of one exercise, and a time per side: when a side ends, and what comes next. */
class SideSetTest {
    private val both=ExerciseRules(bilateral=true,sideSeconds=60,targetRepetitions=5)
    private fun snap(done:Int,ms:Long,running:Boolean=true)=AssessmentSnapshot(completed=done,durationMs=ms,running=running)

    @Test fun bothSidesRunLeftThenRight() {
        assertEquals(listOf(BodySide.LEFT,BodySide.RIGHT),SideSet.sides(both))
        assertEquals(BodySide.RIGHT,SideSet.next(both))
        assertNull(SideSet.next(both.copy(side=BodySide.RIGHT)))
        assertEquals(listOf(BodySide.RIGHT),SideSet.sides(ExerciseRules(side=BodySide.RIGHT)))
        assertNull(SideSet.next(ExerciseRules(side=BodySide.LEFT)))
    }

    @Test fun timeUpOnTheLeftMovesToTheRight() {
        assertEquals(SetEvent.SideEnded(BodySide.RIGHT),SideSet.evaluate(both,snap(3,59_990),snap(3,60_000)))
    }

    @Test fun timeUpOnTheLastSideCompletesTheSet() {
        assertEquals(SetEvent.SetComplete,SideSet.evaluate(both.copy(side=BodySide.RIGHT),snap(3,59_990),snap(3,60_000)))
        assertEquals(SetEvent.SetComplete,SideSet.evaluate(ExerciseRules(sideSeconds=60),snap(3,59_990),snap(3,60_000)))
    }

    @Test fun reachingTheTargetWithTimeLeftKeepsGoing() {
        assertEquals(SetEvent.TargetReached,SideSet.evaluate(both,snap(4,10_000),snap(5,10_050)))
        assertNull(SideSet.evaluate(both,snap(5,11_000),snap(6,11_050)))
    }

    @Test fun timeUpBeforeTheTargetStillMovesOn() {
        assertEquals(SetEvent.SideEnded(BodySide.RIGHT),SideSet.evaluate(both,snap(2,59_999),snap(2,60_001)))
    }

    @Test fun untimedBothSidesSwitchAtTheTarget() {
        val untimed=both.copy(sideSeconds=null)
        assertEquals(SetEvent.SideEnded(BodySide.RIGHT),SideSet.evaluate(untimed,snap(4,10_000),snap(5,10_050)))
        assertNull(SideSet.evaluate(untimed.copy(side=BodySide.RIGHT),snap(4,10_000),snap(5,10_050)))
    }

    @Test fun untimedSingleSideBehavesAsBefore() {
        assertNull(SideSet.evaluate(ExerciseRules(),snap(4,10_000),snap(5,10_050)))
        assertNull(SideSet.evaluate(ExerciseRules(),snap(5,10_000_000),snap(5,10_000_050)))
    }

    @Test fun nothingHappensWhilePaused() {
        assertNull(SideSet.evaluate(both,snap(3,59_000),snap(3,61_000,running=false)))
        assertNull(SideSet.evaluate(both,snap(4,10_000),snap(5,10_050,running=false)))
    }

    @Test fun aRestoredSidePastItsTimeEndsOnTheNextFrame() {
        assertEquals(SetEvent.SideEnded(BodySide.RIGHT),SideSet.evaluate(both,snap(3,61_000),snap(3,61_050)))
    }

    @Test fun remainingTimeCountsDown() {
        assertEquals(44_500L,SideSet.remainingMs(both,snap(0,15_500)))
        assertEquals(0L,SideSet.remainingMs(both,snap(0,70_000)))
        assertNull(SideSet.remainingMs(ExerciseRules(),snap(0,1)))
    }

    @Test fun aTimeOutsideTheLimitsIsRefused() {
        assertThrows(IllegalArgumentException::class.java) {ExerciseRules(sideSeconds=14)}
        assertThrows(IllegalArgumentException::class.java) {ExerciseRules(sideSeconds=1801)}
        assertEquals(15,ExerciseRules(sideSeconds=15).sideSeconds)
        assertEquals(1800,ExerciseRules(sideSeconds=1800).sideSeconds)
    }
}
