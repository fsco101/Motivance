import com.motivance.assessment.*
import com.motivance.domain.*
import org.junit.Assert.*
import org.junit.Test
import kotlin.math.*

/** Issue #95: the engine clears its feedback on the next frame, so each result is captured once, as it happens. */
class RepetitionOutcomeTest {
    private val recording=AssessmentSnapshot(quality=TrackingQuality.READY,running=true,completed=2,incomplete=1,angleDegrees=15.0,phase=MovementPhase.REST)

    @Test fun aNewCountIsCountedWithTheNewTotal() {
        assertEquals(RepOutcome.Counted(3),RepOutcome.between(recording,recording.copy(completed=3,feedback=RepFeedback.COMPLETE)))
    }
    @Test fun aNewMissedAttemptCarriesItsReason() {
        for(reason in listOf(RepFeedback.INCOMPLETE_RANGE,RepFeedback.TOO_FAST,RepFeedback.TIMED_OUT))
            assertEquals(reason.name,RepOutcome.Missed(reason),RepOutcome.between(recording,recording.copy(incomplete=2,feedback=reason)))
    }
    @Test fun movementWithoutANewResultIsNoOutcome() {
        assertNull(RepOutcome.between(recording,recording.copy(angleDegrees=60.0,phase=MovementPhase.MOVING)))
        assertNull(RepOutcome.between(recording,recording.copy(angleDegrees=95.0,phase=MovementPhase.AT_TARGET,feedback=RepFeedback.TARGET_REACHED)))
        assertNull(RepOutcome.between(recording,recording))
    }
    @Test fun nothingIsReportedOutsideActiveMeasurement() {
        val paused=recording.copy(running=false)
        assertNull(RepOutcome.between(paused,paused.copy(completed=3,feedback=RepFeedback.COMPLETE)))
        assertNull(RepOutcome.between(paused,paused.copy(incomplete=2,feedback=RepFeedback.TOO_FAST)))
    }
    @Test fun aReplayedSessionYieldsOneResultPerAttempt() {
        val engine=MovementAssessment(ExerciseRules())
        var time=0L
        val outcomes=mutableListOf<RepOutcome>()
        fun frame(angle:Double) {
            time+=100
            val before=engine.snapshot
            RepOutcome.between(before,engine.process(listOf(pose(angle)),1000,1000,time))?.let(outcomes::add)
        }
        repeat(6) {frame(10.0)}
        assertTrue(engine.start(time))
        listOf(10.0,10.0,40.0,60.0,100.0,100.0,100.0,70.0,40.0,10.0,10.0).forEach(::frame)
        listOf(10.0,40.0,60.0,60.0,60.0,40.0,10.0,10.0).forEach(::frame)
        listOf(10.0,10.0,40.0,60.0,100.0,100.0,100.0,70.0,40.0,10.0,10.0).forEach(::frame)
        assertEquals(listOf(RepOutcome.Counted(1),RepOutcome.Missed(RepFeedback.INCOMPLETE_RANGE),RepOutcome.Counted(2)),outcomes)
        // The engine's own feedback is already gone one frame later; the outcome is what the screen can keep.
        frame(10.0)
        assertEquals(RepFeedback.NONE,engine.snapshot.feedback)
    }

    private fun pose(angle:Double):List<Landmark> {
        val points=MutableList(33) {Landmark(.5f,.5f,1f)}
        points[11]=Landmark(.5f,.3f,1f); points[23]=Landmark(.5f,.8f,1f); points[13]=Landmark(.5f,.5f,1f)
        points[15]=Landmark((.5+sin(Math.toRadians(angle))*.15).toFloat(),(.5+cos(Math.toRadians(angle))*.15).toFloat(),1f)
        return points
    }
}
