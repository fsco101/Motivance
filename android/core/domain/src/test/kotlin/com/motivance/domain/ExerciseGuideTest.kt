package com.motivance.domain

import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.hypot
import org.junit.Assert.*
import org.junit.Test

class ExerciseGuideTest {
    /** The angle at b, as the camera measures it from three landmarks. */
    private fun interior(a:GuidePoint,b:GuidePoint,c:GuidePoint):Double {
        val ux=a.x-b.x;val uy=a.y-b.y;val vx=c.x-b.x;val vy=c.y-b.y
        return Math.toDegrees(acos(((ux*vx+uy*vy)/(hypot(ux,uy)*hypot(vx,vy))).coerceIn(-1.0,1.0)))
    }
    private fun length(a:GuidePoint,b:GuidePoint)=hypot(a.x-b.x,a.y-b.y)
    private fun assertAngle(expected:Double,actual:Double)=assertEquals(expected,actual,.01)

    @Test fun theElbowMatchesTheCameraAtEveryAngle() {
        val motion=guideMotion(BodyJoint.ELBOW)
        for(angle in listOf(0.0,20.0,90.0,120.0,150.0)) {
            val arm=motion.pose(angle).nearArm
            assertAngle(180-angle,interior(arm.root,arm.middle,arm.end))
        }
    }

    @Test fun theShoulderIsMeasuredFromTheTrunk() {
        val motion=guideMotion(BodyJoint.SHOULDER)
        for(angle in listOf(0.0,45.0,90.0,120.0,170.0)) {
            val pose=motion.pose(angle)
            val trunk=GuidePoint(pose.nearArm.root.x,pose.hips.y)
            assertAngle(angle,if(angle==0.0) 0.0 else interior(trunk,pose.nearArm.root,pose.nearArm.middle))
        }
    }

    @Test fun theWristMatchesTheCamera() {
        val arm=guideMotion(BodyJoint.WRIST).pose(40.0).nearArm
        assertAngle(140.0,interior(arm.middle,arm.end,arm.tip))
    }

    @Test fun theHipMatchesTheCameraEvenAsTheKneeRelaxes() {
        val pose=guideMotion(BodyJoint.HIP).pose(70.0)
        assertAngle(110.0,interior(pose.shoulders,pose.hips,pose.nearLeg.middle))
    }

    @Test fun aSeatedHipLiftsFromTheChairAndMatchesTheCamera() {
        val motion=guideMotion(BodyJoint.HIP,name="Seated hip flexion")
        assertEquals(90.0,motion.low,0.0)
        assertTrue("The thigh lifts",motion.high>motion.low)
        val rest=motion.pose(motion.low)
        assertEquals("The thigh rests level on the chair",rest.hips.y,rest.nearLeg.middle.y,.001)
        assertEquals("The resting leg matches the other leg",rest.farLeg,rest.nearLeg)
        for(angle in listOf(motion.low,100.0,motion.high)) {
            val pose=motion.pose(angle)
            assertAngle(180-angle,interior(pose.shoulders,pose.hips,pose.nearLeg.middle))
            assertTrue("The leg stays above the floor at $angle",maxOf(pose.nearLeg.end.y,pose.nearLeg.tip.y)<=GuideBody.FLOOR)
        }
    }

    @Test fun aSeatedHipNeverPassesThroughTheChair() {
        val partly=guideMotion(BodyJoint.HIP,name="Seated hip flexion",low=60.0,high=110.0)
        assertEquals(90.0,partly.low,0.0)
        assertEquals(110.0,partly.high,0.0)
        val below=guideMotion(BodyJoint.HIP,name="Pag-upo at pag-angat ng hita",low=10.0,high=80.0)
        assertEquals(90.0,below.low,0.0)
        assertTrue("A range below the chair still shows a lift",below.high>below.low)
        assertEquals("A standing hip keeps its prescribed range",10.0,guideMotion(BodyJoint.HIP,low=10.0,high=80.0).low,0.0)
    }

    @Test fun theKneeMatchesTheCameraSeatedAndStanding() {
        for(name in listOf(null,"Standing knee curl")) {
            val leg=guideMotion(BodyJoint.KNEE,name=name).pose(60.0).nearLeg
            assertAngle(120.0,interior(leg.root,leg.middle,leg.end))
        }
    }

    @Test fun theAnkleFollowsTheFlatFootConvention() {
        val motion=guideMotion(BodyJoint.ANKLE)
        val flat=motion.pose(90.0).nearLeg
        assertEquals(flat.end.y,flat.tip.y,.5)
        val lifted=motion.pose(115.0).nearLeg
        assertAngle(65.0,interior(lifted.middle,lifted.end,lifted.tip))
        assertTrue("The toes lift toward the shin",lifted.tip.y<flat.tip.y)
    }

    @Test fun limbsNeverStretchWhileMoving() {
        for(joint in BodyJoint.entries) {
            val motion=guideMotion(joint)
            val first=motion.pose(motion.low)
            val last=motion.pose(motion.high)
            assertEquals(length(first.nearArm.root,first.nearArm.middle),length(last.nearArm.root,last.nearArm.middle),.001)
            assertEquals(length(first.nearLeg.middle,first.nearLeg.end),length(last.nearLeg.middle,last.nearLeg.end),.001)
        }
    }

    @Test fun theCharacterStaysOnTheFloor() {
        for(joint in BodyJoint.entries) for(side in BodySide.entries) {
            val motion=guideMotion(joint,side)
            val pose=motion.pose(motion.low)
            assertTrue("$joint stands on the floor",maxOf(pose.farLeg.end.y,pose.farLeg.tip.y)<=GuideBody.FLOOR)
            assertTrue("$joint is not floating",maxOf(pose.farLeg.end.y,pose.farLeg.tip.y)>GuideBody.FLOOR-8)
        }
    }

    @Test fun theWorkingSideFacesTheCamera() {
        assertTrue(guideMotion(BodyJoint.ELBOW,BodySide.LEFT).pose(90.0).nearArm.end.x<0)
        assertTrue(guideMotion(BodyJoint.ELBOW,BodySide.RIGHT).pose(90.0).nearArm.end.x>0)
        assertTrue("A patient's left arm is on the right of the picture",guideMotion(BodyJoint.SHOULDER,BodySide.LEFT).pose(90.0).nearArm.end.x>0)
        assertTrue(guideMotion(BodyJoint.SHOULDER,BodySide.RIGHT).pose(90.0).nearArm.end.x<0)
    }

    @Test fun eachJointIsShownTheWayTheCameraSeesIt() {
        assertEquals(GuideView.FRONT,guideMotion(BodyJoint.SHOULDER).view)
        for(joint in BodyJoint.entries.filter {it!=BodyJoint.SHOULDER}) assertEquals(GuideView.SIDE,guideMotion(joint).view)
    }

    @Test fun aTherapistsNameCanChooseThePosture() {
        assertEquals(GuidePosture.SEATED,guideMotion(BodyJoint.KNEE).posture)
        assertEquals(GuidePosture.SEATED,guideMotion(BodyJoint.KNEE,name="Seated knee extension").posture)
        assertEquals(GuidePosture.STANDING,guideMotion(BodyJoint.KNEE,name="Standing knee curl").posture)
        assertEquals(GuidePosture.STANDING,guideMotion(BodyJoint.HIP).posture)
        assertEquals(GuidePosture.SEATED,guideMotion(BodyJoint.HIP,name="Pag-upo at pag-angat ng hita").posture)
    }

    @Test fun thePrescribedRangeIsShownWithinWhatABodyCanDo() {
        val prescribed=guideMotion(BodyJoint.ELBOW,low=25.0,high=110.0)
        assertEquals(25.0,prescribed.low,0.0)
        assertEquals(110.0,prescribed.high,0.0)
        assertEquals(150.0,guideMotion(BodyJoint.ELBOW,low=20.0,high=180.0).high,0.0)
    }

    @Test fun rulesCarryTheirRangeSideAndCustomName() {
        val rules=ExerciseRules(kind=ExerciseKind.CUSTOM,side=BodySide.RIGHT,lowDegrees=15.0,highDegrees=80.0,measuredJoint=BodyJoint.KNEE,exerciseName="Standing knee curl",demo=false,prescriptionVersionId="p")
        val motion=guideMotion(rules)
        assertEquals(BodyJoint.KNEE,motion.joint)
        assertEquals(BodySide.RIGHT,motion.side)
        assertEquals(GuidePosture.STANDING,motion.posture)
        assertEquals(80.0,motion.high,0.0)
    }

    @Test fun oneRepetitionGoesOutHoldsAndComesBack() {
        val motion=guideMotion(BodyJoint.ELBOW,low=20.0,high=120.0)
        assertEquals(20.0,motion.angleAt(0.0),.001)
        assertEquals(120.0,motion.angleAt(.5),.001)
        assertEquals(20.0,motion.angleAt(.99),.001)
        assertTrue("It moves smoothly, with no jumps",(0..999).all {abs(guideProgress((it+1)/1000.0)-guideProgress(it/1000.0))<.02})
    }
}
