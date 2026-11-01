package com.motivance.domain

import org.junit.Assert.*
import org.junit.Test

class BodyJointTest {
    @Test fun prescribedBodyPartsMapToAnatomicalLeftAndRightLandmarks() {
        val expected=mapOf(BodyJoint.SHOULDER to 11,BodyJoint.ELBOW to 13,BodyJoint.WRIST to 15,BodyJoint.HIP to 23,BodyJoint.KNEE to 25,BodyJoint.ANKLE to 27)
        expected.forEach {(joint,left) ->
            assertEquals(left,joint.landmark(BodySide.LEFT));assertEquals(left+1,joint.landmark(BodySide.RIGHT))
            BodySide.entries.forEach {side -> assertEquals(joint.landmark(side),joint.chain(side)[1])}
        }
    }
    @Test fun visualFocusDoesNotChangeTheMeasuredExerciseJoint() {
        val rules=ExerciseRules(kind=ExerciseKind.ELBOW_FLEXION,side=BodySide.RIGHT,focusJoint=BodyJoint.KNEE)
        assertEquals(BodyJoint.KNEE,rules.focusJoint)
        assertEquals(26,rules.focusJoint.landmark(rules.side))
        assertEquals(BodyJoint.ELBOW,rules.kind.measurementJoint)
        assertEquals(BodyJoint.SHOULDER,ExerciseRules(kind=ExerciseKind.SHOULDER_ABDUCTION).focusJoint)
    }
}
