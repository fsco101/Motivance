import com.motivance.assessment.*
import com.motivance.domain.*
import org.junit.Assert.*
import org.junit.Test
import kotlin.math.*

class MeasurementGeometryTest {
    @Test fun protractorAngleMatchesTheEngineForEveryExerciseAndSide() {
        for(kind in listOf(ExerciseKind.ELBOW_FLEXION,ExerciseKind.SHOULDER_ABDUCTION)) for(side in BodySide.entries) for(angle in listOf(15.0,45.0,90.0,120.0)) {
            val rules=ExerciseRules(kind=kind,side=side)
            val pose=pose(angle,side,kind==ExerciseKind.SHOULDER_ABDUCTION)
            val engine=MovementAssessment(rules)
            var snapshot=AssessmentSnapshot()
            repeat(6) {snapshot=engine.process(listOf(pose),1280,720,(it+1)*100L)}
            val protractor=MeasurementOverlay.protractor(pose,rules,1280,720)
            assertNotNull("$kind/$side/$angle",protractor)
            assertEquals("$kind/$side/$angle",snapshot.angleDegrees!!,protractor!!.rawAngleDegrees,1e-6)
        }
    }
    @Test fun thresholdTicksSitAtTheTherapistAnglesFromTheZeroReference() {
        val rules=ExerciseRules(lowDegrees=25.0,highDegrees=110.0)
        val width=1000; val height=1000
        val p=MeasurementOverlay.protractor(pose(70.0),rules,width,height)!!
        fun degreesFromReference(point:FramePoint):Double {
            val rx=p.referenceEnd.x-p.vertex.x; val ry=p.referenceEnd.y-p.vertex.y
            val tx=point.x-p.vertex.x; val ty=point.y-p.vertex.y
            return Math.toDegrees(acos(((rx*tx+ry*ty)/(hypot(rx,ry)*hypot(tx,ty))).toDouble().coerceIn(-1.0,1.0)))
        }
        assertEquals(25.0,degreesFromReference(p.lowTick.second),.01)
        assertEquals(110.0,degreesFromReference(p.highTick.second),.01)
        assertEquals(70.0,degreesFromReference(p.measuredArc.last()),.01)
        assertEquals(180.0,degreesFromReference(p.targetZone.last()),.01)
        // The measured arc ends on the moving segment, not on the opposite side of the reference.
        val mx=p.movingEnd.x-p.vertex.x; val my=p.movingEnd.y-p.vertex.y
        val ax=p.measuredArc.last().x-p.vertex.x; val ay=p.measuredArc.last().y-p.vertex.y
        assertTrue((mx*ax+my*ay)/(hypot(mx,my)*hypot(ax,ay))>.9999)
    }
    @Test fun anglesStayCorrectOnNonSquareFrames() {
        val rules=ExerciseRules()
        for((w,h) in listOf(720 to 1280,1280 to 720)) {
            // Build the pose in pixels so the true angle is 60° in this aspect ratio.
            val pose=MutableList(33) {Landmark(.5f,.5f,1f)}
            fun put(i:Int,x:Double,y:Double) {pose[i]=Landmark((x/w).toFloat(),(y/h).toFloat(),1f)}
            put(11,w*.5,h*.3); put(23,w*.5,h*.8); put(13,w*.5,h*.5)
            val len=min(w,h)*.15
            put(15,w*.5+sin(Math.toRadians(60.0))*len,h*.5+cos(Math.toRadians(60.0))*len)
            assertEquals(60.0,MeasurementOverlay.protractor(pose,rules,w,h)!!.rawAngleDegrees,1e-4)
        }
    }
    @Test fun minimumRadiusEnlargesTheProtractorWithoutChangingAngles() {
        val rules=ExerciseRules()
        val small=MeasurementOverlay.protractor(pose(60.0),rules,1000,1000)!!
        val large=MeasurementOverlay.protractor(pose(60.0),rules,1000,1000,minRadiusPx=200.0)!!
        fun r(p:Protractor)=hypot((p.measuredArc.first().x-p.vertex.x)*1000.0,(p.measuredArc.first().y-p.vertex.y)*1000.0)
        assertEquals(.42*150,r(small),1e-3)
        assertEquals(200.0,r(large),1e-3)
        assertEquals(small.rawAngleDegrees,large.rawAngleDegrees,0.0)
    }
    @Test fun unreliableLandmarksProduceNoProtractor() {
        val rules=ExerciseRules()
        val low=pose(60.0).toMutableList().apply {this[15]=this[15].copy(visibility=.2f)}
        val outside=pose(60.0).toMutableList().apply {this[13]=Landmark(.995f,.5f,1f)}
        val collapsed=pose(60.0).toMutableList().apply {this[15]=this[13]}
        assertNull(MeasurementOverlay.protractor(low,rules,1000,1000))
        assertNull(MeasurementOverlay.protractor(outside,rules,1000,1000))
        assertNull(MeasurementOverlay.protractor(collapsed,rules,1000,1000))
        assertNull(MeasurementOverlay.protractor(pose(60.0),rules,0,1000))
    }
    @Test fun guideFollowsTheEngineThroughOneRepetitionIncludingHold() {
        val rules=ExerciseRules(peakHoldMs=300)
        val engine=MovementAssessment(rules)
        var time=0L
        fun frame(angle:Double):RepetitionGuide {time+=100;return RepetitionGuide.of(rules,engine.process(listOf(pose(angle)),1000,1000,time))}
        repeat(6) {frame(10.0)}
        assertTrue(engine.start(time))
        assertEquals(RepStep.REACH,frame(10.0).step)
        frame(40.0); frame(55.0)
        // The engine reports the median of the last three samples (40, 55, 70).
        val moving=frame(70.0)
        assertEquals(RepStep.REACH,moving.step)
        assertEquals((55.0-20.0)/70.0,moving.targetProgress!!,1e-6)
        repeat(2) {frame(100.0)}
        val holding=frame(100.0)
        assertEquals(RepStep.HOLD,holding.step)
        assertEquals(100.0/300.0,holding.holdProgress,1e-6)
        repeat(2) {frame(100.0)}
        val atTarget=frame(100.0)
        assertEquals(RepStep.RETURN,atTarget.step)
        assertEquals(1.0,atTarget.holdProgress,0.0)
        listOf(70.0,40.0,10.0,10.0).forEach {frame(it)}
        assertEquals(1,engine.snapshot.completed)
        assertEquals(0L,engine.snapshot.holdElapsedMs)
        assertEquals(RepStep.REACH,RepetitionGuide.of(rules,engine.snapshot).step)
    }
    @Test fun leavingTheTargetBeforeTheHoldEndsResetsTheHold() {
        val rules=ExerciseRules(peakHoldMs=1000)
        val engine=MovementAssessment(rules)
        var time=0L
        fun frame(angle:Double):AssessmentSnapshot {time+=100;return engine.process(listOf(pose(angle)),1000,1000,time)}
        repeat(6) {frame(10.0)}
        assertTrue(engine.start(time))
        listOf(10.0,40.0,70.0,95.0,95.0,95.0,95.0).forEach {frame(it)}
        assertTrue(engine.snapshot.holdElapsedMs>0)
        listOf(80.0,80.0,80.0).forEach {frame(it)}
        assertEquals(0L,engine.snapshot.holdElapsedMs)
        assertEquals(MovementPhase.MOVING,engine.snapshot.phase)
    }
    @Test fun guideIsEmptyWithoutReliableTracking() {
        val guide=RepetitionGuide.of(ExerciseRules(),AssessmentSnapshot(quality=TrackingQuality.MULTIPLE_PEOPLE,angleDegrees=80.0))
        assertNull(guide.step); assertNull(guide.targetProgress)
    }

    private fun pose(angle:Double,side:BodySide=BodySide.LEFT,shoulder:Boolean=false):List<Landmark> {
        val points=MutableList(33) {Landmark(.5f,.5f,1f)}
        val s=if(side==BodySide.LEFT) 11 else 12
        points[s]=Landmark(.5f,.3f,1f); points[s+12]=Landmark(.5f,.8f,1f)
        if(shoulder) points[s+2]=Landmark((.5+sin(Math.toRadians(angle))*.2).toFloat(),(.3+cos(Math.toRadians(angle))*.2).toFloat(),1f)
        else {
            points[s+2]=Landmark(.5f,.5f,1f)
            points[s+4]=Landmark((.5+sin(Math.toRadians(angle))*.15).toFloat(),(.5+cos(Math.toRadians(angle))*.15).toFloat(),1f)
        }
        return points
    }
}
