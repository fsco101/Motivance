import com.motivance.assessment.*
import com.motivance.domain.*
import org.junit.Assert.*
import org.junit.Test
import kotlin.math.*

class CustomJointMeasurementTest {
    private fun rules(joint:BodyJoint,side:BodySide)=ExerciseRules(kind=ExerciseKind.CUSTOM,side=side,measuredJoint=joint,exerciseName="Fixture",
        demo=false,prescriptionVersionId="fixture-prescription")

    /** An upright person with the measured joint at [angle], whichever limb that joint belongs to. */
    private fun pose(angle:Double,rules:ExerciseRules):List<Landmark> {
        val shoulder=if(rules.side==BodySide.LEFT) 11 else 12
        val hip=shoulder+12
        val points=MutableList(33) {Landmark(.5f,.5f,1f)}
        points[shoulder]=Landmark(.5f,.2f,1f); points[hip]=Landmark(.5f,.5f,1f)
        val chain=rules.measurementChain()
        if(chain.vertex!=shoulder && chain.vertex!=hip) {
            if(chain.proximal!=shoulder && chain.proximal!=hip) points[chain.proximal]=Landmark(.3f,.3f,1f)
            val top=points[chain.proximal]
            points[chain.vertex]=Landmark(top.x,top.y+.15f,1f)
        }
        val vertex=points[chain.vertex]
        val radians=Math.toRadians(angle)
        points[chain.distal]=Landmark((vertex.x+.15*sin(radians)).toFloat(),(vertex.y+.15*cos(radians)).toFloat(),1f)
        return points
    }

    @Test fun everyJointOnBothSidesMeasuresTheAngleAndCountsARepetition() {
        for(joint in BodyJoint.entries) for(side in BodySide.entries) {
            val rules=rules(joint,side)
            val engine=MovementAssessment(rules)
            var time=0L
            fun frame(angle:Double):AssessmentSnapshot {time+=110; return engine.process(listOf(pose(angle,rules)),1000,1000,time)}
            repeat(6) {frame(10.0)}
            assertEquals("$joint/$side",10.0,engine.snapshot.angleDegrees!!,.01)
            assertTrue("$joint/$side",engine.start(time))
            listOf(10.0,10.0,40.0,60.0,100.0,100.0,100.0,70.0,40.0,10.0,10.0).forEach {frame(it)}
            assertEquals("$joint/$side",1,engine.snapshot.completed)
            assertEquals("$joint/$side",100.0,engine.snapshot.maximumDegrees!!,.01)
        }
    }

    @Test fun theOverlayDrawsTheSameAngleTheEngineCounts() {
        for(joint in BodyJoint.entries) {
            val rules=rules(joint,BodySide.RIGHT)
            val pose=pose(45.0,rules)
            val engine=MovementAssessment(rules)
            var snapshot=AssessmentSnapshot()
            repeat(6) {snapshot=engine.process(listOf(pose),1000,1000,(it+1)*100L)}
            assertEquals("$joint",snapshot.angleDegrees!!,MeasurementOverlay.protractor(pose,rules,1000,1000)!!.rawAngleDegrees,1e-6)
        }
    }

    @Test fun builtInExercisesKeepTheirOriginalLandmarks() {
        assertEquals(MeasurementChain(11,13,15,extendsProximal=true),ExerciseRules(kind=ExerciseKind.ELBOW_FLEXION,side=BodySide.LEFT).measurementChain())
        assertEquals(MeasurementChain(12,14,16,extendsProximal=true),ExerciseRules(kind=ExerciseKind.ELBOW_FLEXION,side=BodySide.RIGHT).measurementChain())
        assertEquals(MeasurementChain(23,11,13,extendsProximal=false),ExerciseRules(kind=ExerciseKind.SHOULDER_ABDUCTION,side=BodySide.LEFT).measurementChain())
        assertEquals(MeasurementChain(24,12,14,extendsProximal=false),ExerciseRules(kind=ExerciseKind.SHOULDER_ABDUCTION,side=BodySide.RIGHT).measurementChain())
    }

    @Test fun aHiddenMeasuredLimbIsNotCounted() {
        val rules=rules(BodyJoint.KNEE,BodySide.LEFT)
        val hidden=pose(10.0,rules).toMutableList().also {it[rules.measurementChain().distal]=Landmark(.5f,.5f,.1f)}
        assertEquals(TrackingQuality.LOW_CONFIDENCE,MovementAssessment(rules).process(listOf(hidden),1000,1000,100).quality)
    }

    @Test fun aCustomExerciseMustNameItsJointAndItself() {
        assertThrows(IllegalStateException::class.java) {ExerciseRules(kind=ExerciseKind.CUSTOM,exerciseName="Fixture")}
        assertThrows(IllegalArgumentException::class.java) {ExerciseRules(kind=ExerciseKind.CUSTOM,measuredJoint=BodyJoint.KNEE,exerciseName=" ")}
        assertThrows(IllegalArgumentException::class.java) {ExerciseRules(kind=ExerciseKind.ELBOW_FLEXION,measuredJoint=BodyJoint.KNEE)}
    }
}
