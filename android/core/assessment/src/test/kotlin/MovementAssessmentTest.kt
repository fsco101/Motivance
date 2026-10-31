import com.motivance.assessment.*
import com.motivance.domain.*
import org.junit.Assert.*
import org.junit.Test
import kotlin.math.*

class MovementAssessmentTest {
    private fun pose(angle:Double,side:BodySide=BodySide.LEFT,shoulder:Boolean=false):List<Landmark> {
        val points=MutableList(33) { Landmark(.5f,.5f,1f) }
        val s=if(side==BodySide.LEFT) 11 else 12
        points[s]=Landmark(.5f,.3f,1f); points[s+12]=Landmark(.5f,.8f,1f)
        if(shoulder) points[s+2]=Landmark((.5+sin(Math.toRadians(angle))*.2).toFloat(),(.3+cos(Math.toRadians(angle))*.2).toFloat(),1f)
        else {
            points[s+2]=Landmark(.5f,.5f,1f)
            points[s+4]=Landmark((.5+sin(Math.toRadians(angle))*.15).toFloat(),(.5+cos(Math.toRadians(angle))*.15).toFloat(),1f)
        }
        return points
    }
    private class Replay(val engine:MovementAssessment) {
        var time=0L
        fun frame(points:List<Landmark>):AssessmentSnapshot { time+=100; return engine.process(listOf(points),1000,1000,time) }
    }
    private fun ready(rules:ExerciseRules=ExerciseRules()):Replay {
        val replay=Replay(MovementAssessment(rules))
        repeat(6) { replay.frame(pose(10.0,rules.side,rules.kind==ExerciseKind.SHOULDER_ABDUCTION)) }
        assertTrue(replay.engine.start(replay.time))
        return replay
    }
    private fun cycle(replay:Replay,peak:Double=100.0) {
        listOf(10.0,10.0,40.0,60.0,peak,peak,peak,70.0,40.0,10.0,10.0).forEach { replay.frame(pose(it)) }
    }
    @Test fun aspectRatioUsesPixelGeometry() {
        assertEquals(45.0,JointAngles.included(Landmark(.5f,0f,1f),Landmark(0f,0f,1f),Landmark(.5f,.5f,1f),1000,1000)!!,.01)
        assertEquals(atan(.5)*180/PI,JointAngles.included(Landmark(.5f,0f,1f),Landmark(0f,0f,1f),Landmark(.5f,.5f,1f),1000,500)!!,.01)
    }
    @Test fun degenerateVectorsAreInvalid() { assertNull(JointAngles.included(Landmark(.5f,.5f,1f),Landmark(.5f,.5f,1f),Landmark(.8f,.8f,1f),1000,1000)) }
    @Test fun calibrationRequiresStableVisibleJoints() {
        val e=MovementAssessment(ExerciseRules()); e.process(emptyList(),1000,1000,100)
        assertFalse(e.start(100))
        repeat(4) { e.process(listOf(pose(10.0)),1000,1000,200+it*100L) }
        assertEquals(TrackingQuality.POSITIONING,e.snapshot.quality)
        e.process(listOf(pose(10.0)),1000,1000,600)
        assertEquals(TrackingQuality.READY,e.snapshot.quality)
    }
    @Test fun completeCycleCountsOnceAndRecordsRom() {
        val r=ready(); cycle(r)
        assertEquals(1,r.engine.snapshot.completed); assertEquals(0,r.engine.snapshot.incomplete)
        assertEquals(90.0,r.engine.snapshot.romDegrees!!,.01)
        repeat(10) {r.frame(pose(10.0))}; assertEquals(1,r.engine.snapshot.completed)
    }
    @Test fun incompleteAndTooFastCyclesHaveReasons() {
        val r=ready(); cycle(r,60.0)
        assertEquals(0,r.engine.snapshot.completed); assertEquals(1,r.engine.snapshot.incomplete)
        assertEquals(RepFeedback.INCOMPLETE_RANGE,r.engine.snapshot.feedback)
        val fast=ready(ExerciseRules(minimumCycleMs=10_000)); cycle(fast)
        assertEquals(0,fast.engine.snapshot.completed); assertEquals(RepFeedback.TOO_FAST,fast.engine.snapshot.feedback)
    }
    @Test fun jitterNeverCountsAnExercise() {
        val r=ready(); repeat(30) {r.frame(pose(if(it%2==0) 19.0 else 23.0))}
        assertEquals(0,r.engine.snapshot.completed); assertEquals(0,r.engine.snapshot.incomplete)
    }
    @Test fun invalidFramesCannotUpdateRomOrCompleteACycle() {
        val r=ready(); r.frame(pose(10.0)); val old=r.engine.snapshot
        val lost=r.engine.process(listOf(pose(100.0),pose(100.0)),1000,1000,r.time+100)
        assertEquals(TrackingQuality.MULTIPLE_PEOPLE,lost.quality)
        assertEquals(old.maximumDegrees,lost.maximumDegrees); assertEquals(old.completed,lost.completed); assertNull(lost.angleDegrees)
    }
    @Test fun lowConfidenceAndOutOfFrameAreExplicit() {
        val r=ready(); val p=pose(10.0).toMutableList(); p[15]=p[15].copy(visibility=.1f)
        assertEquals(TrackingQuality.LOW_CONFIDENCE,r.frame(p).quality)
        p[15]=p[15].copy(visibility=1f,x=1.1f)
        assertEquals(TrackingQuality.OUT_OF_FRAME,r.frame(p).quality)
    }
    @Test fun staleFramesDoNotChangeState() {
        val r=ready(); val old=r.engine.snapshot
        assertEquals(old,r.engine.process(emptyList(),1000,1000,r.time-1))
    }
    @Test fun outlierCannotPolluteRom() {
        val r=ready(); r.frame(pose(10.0)); val old=r.engine.snapshot.maximumDegrees
        assertEquals(TrackingQuality.OUTLIER,r.frame(pose(170.0)).quality)
        assertEquals(old,r.engine.snapshot.maximumDegrees)
    }
    @Test fun pauseAndTrackingLossRequireNewNeutralCycle() {
        val r=ready(); listOf(10.0,40.0,60.0,100.0,100.0,100.0).forEach {r.frame(pose(it))}
        val paused=r.engine.pause(r.time)
        assertFalse(paused.running)
        repeat(6) {r.frame(pose(100.0))}; assertTrue(r.engine.start(r.time))
        repeat(6) {r.frame(pose(10.0))}; assertEquals(0,r.engine.snapshot.completed)
    }
    @Test fun restoredSessionIsPausedWithAggregatesPreserved() {
        val r=ready(); cycle(r)
        val e=MovementAssessment(ExerciseRules(),r.engine.snapshot)
        assertFalse(e.snapshot.running); assertEquals(1,e.snapshot.completed); assertNull(e.snapshot.angleDegrees)
        assertEquals(MovementPhase.SEEKING_START,e.snapshot.phase)
    }
    @Test fun personLossAtTargetCannotCompleteTheInterruptedCycle() {
        val r=ready(); listOf(10.0,40.0,60.0,100.0,100.0,100.0).forEach {r.frame(pose(it))}
        assertEquals(MovementPhase.AT_TARGET,r.engine.snapshot.phase)
        val extrema=r.engine.snapshot.maximumDegrees
        r.time+=100
        assertEquals(TrackingQuality.NO_PERSON,r.engine.process(emptyList(),1000,1000,r.time).quality)
        assertEquals(extrema,r.engine.snapshot.maximumDegrees)
        repeat(6) {r.frame(pose(100.0))}; repeat(6) {r.frame(pose(10.0))}
        assertEquals(0,r.engine.snapshot.completed)
        cycle(r); assertEquals(1,r.engine.snapshot.completed)
    }
    @Test fun missingFramesCannotBridgeAPartialCycle() {
        val r=ready(); listOf(10.0,40.0,60.0,100.0,100.0,100.0).forEach {r.frame(pose(it))}
        r.time+=2000
        repeat(6) {r.frame(pose(10.0))}
        assertEquals(0,r.engine.snapshot.completed)
        cycle(r); assertEquals(1,r.engine.snapshot.completed)
    }
    @Test fun bothSidesAndShoulderConventionAreSupported() {
        for(side in BodySide.entries) {
            val e=MovementAssessment(ExerciseRules(kind=ExerciseKind.SHOULDER_ABDUCTION,side=side))
            repeat(6) {e.process(listOf(pose(90.0,side,true)),1000,1000,100+it*100L)}
            assertEquals(90.0,e.snapshot.angleDegrees!!,.01)
        }
    }
    @Test fun trunkLeanAndInvalidCoordinatesAreRejected() {
        val r=ready(); val leaning=pose(10.0).toMutableList()
        leaning[23]=leaning[23].copy(x=.9f)
        assertEquals(TrackingQuality.TRUNK_LEAN,r.frame(leaning).quality)
        val invalid=pose(10.0).toMutableList(); invalid[15]=invalid[15].copy(x=Float.NaN)
        assertEquals(TrackingQuality.OUT_OF_FRAME,r.frame(invalid).quality)
        assertEquals(TrackingQuality.LOW_CONFIDENCE,r.frame(pose(10.0).take(10)).quality)
    }
    @Test fun upsideDownTorsoIsNotAcceptedAsCalibration() {
        val r=ready(); val invalid=pose(10.0).toMutableList(); invalid[23]=invalid[23].copy(y=.1f)
        assertEquals(TrackingQuality.DEGENERATE,r.frame(invalid).quality)
    }
    @Test fun timeoutRecordsOnlyOneIncompleteCycle() {
        val r=ready(ExerciseRules(minimumCycleMs=100,maximumCycleMs=1500))
        listOf(10.0,40.0,60.0,100.0,100.0,100.0).forEach {r.frame(pose(it))}
        repeat(30) {r.frame(pose(100.0))}
        repeat(6) {r.frame(pose(10.0))}
        assertEquals(0,r.engine.snapshot.completed); assertEquals(1,r.engine.snapshot.incomplete)
    }
    @Test fun pausedTimeIsExcludedFromActiveDuration() {
        val r=ready(); r.frame(pose(10.0)); r.engine.pause(r.time)
        val duration=r.engine.snapshot.durationMs
        repeat(10) {r.frame(pose(10.0))}
        assertEquals(duration,r.engine.snapshot.durationMs)
        assertTrue(r.engine.start(r.time)); r.frame(pose(10.0))
        assertEquals(duration+100,r.engine.snapshot.durationMs)
    }
    @Test fun medianFilterDoesNotAcceptAnIsolatedAngleSpike() {
        val r=ready(); r.frame(pose(10.0)); r.frame(pose(60.0)); r.frame(pose(10.0))
        assertEquals(10.0,r.engine.snapshot.maximumDegrees!!,.01)
    }
    @Test(expected=IllegalArgumentException::class) fun invalidThresholdsAreRejected() { ExerciseRules(lowDegrees=90.0,highDegrees=20.0) }
}
