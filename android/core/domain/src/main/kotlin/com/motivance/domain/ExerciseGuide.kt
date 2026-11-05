package com.motivance.domain

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/**
 * The poses of the guide character, a model person who demonstrates each exercise. This is the rig only: it turns a joint
 * angle into body positions, using the same angle conventions as the camera, so the character shows what is measured.
 * Coordinates are in units of 1% of standing height, with y growing downward and the floor at [GuideBody.FLOOR].
 */
enum class GuideView { FRONT, SIDE }
enum class GuidePosture { STANDING, SEATED }

data class GuidePoint(val x:Double,val y:Double) {
    operator fun plus(other:GuidePoint)=GuidePoint(x+other.x,y+other.y)
}
/** A limb from its root to its tip: shoulder, elbow, wrist, fingertip or hip, knee, ankle, toe. */
data class GuideLimb(val root:GuidePoint,val middle:GuidePoint,val end:GuidePoint,val tip:GuidePoint)
/** The area to show, so a small movement like the wrist or ankle is close enough to read. */
data class GuideFrame(val centerX:Double,val centerY:Double,val span:Double)

data class GuidePose(
    val view:GuideView,val facing:Int,val posture:GuidePosture,val head:GuidePoint,val neck:GuidePoint,val shoulders:GuidePoint,val hips:GuidePoint,
    val nearArm:GuideLimb,val farArm:GuideLimb,val nearLeg:GuideLimb,val farLeg:GuideLimb,
    /** The joint being demonstrated, and the point on the moving part that sweeps around it. */
    val pivot:GuidePoint,val reach:GuidePoint,
)

data class GuideMotion(val joint:BodyJoint,val side:BodySide,val view:GuideView,val posture:GuidePosture,val low:Double,val high:Double) {
    /** The character faces the way a patient would, with the working side toward the camera. */
    val facing get()=if(side==BodySide.LEFT) -1 else 1
    val frame:GuideFrame get()=when(joint) {
        BodyJoint.WRIST -> GuideFrame(13.0*facing,34.0,66.0)
        BodyJoint.ANKLE -> GuideFrame(18.0*facing,80.0,56.0)
        BodyJoint.SHOULDER -> if(high>125) GuideFrame(0.0,41.0,124.0) else GuideFrame(0.0,50.0,108.0)
        else -> if(posture==GuidePosture.SEATED) GuideFrame(14.0*facing,52.0,108.0) else GuideFrame(6.0*facing,50.0,108.0)
    }
    fun pose(angle:Double)=GuideBody.pose(this,angle)
    /** Where the character is at [time], from 0 to 1 through one repetition. */
    fun angleAt(time:Double)=low+(high-low)*guideProgress(time)
}

/** Out and back with a rest at each end, so a patient can see both the start and the target. */
fun guideProgress(time:Double):Double {
    val t=time-kotlin.math.floor(time)
    fun ease(x:Double)=(1-cos(PI*x))/2
    return when {
        t<.1 -> 0.0
        t<.45 -> ease((t-.1)/.35)
        t<.6 -> 1.0
        t<.95 -> 1-ease((t-.6)/.35)
        else -> 0.0
    }
}

private fun anatomical(joint:BodyJoint)=when(joint) {
    BodyJoint.SHOULDER -> 0.0..175.0
    BodyJoint.ELBOW -> 0.0..150.0
    BodyJoint.WRIST -> 0.0..80.0
    BodyJoint.HIP -> 0.0..120.0
    BodyJoint.KNEE -> 0.0..130.0
    BodyJoint.ANKLE -> 60.0..125.0
}
private fun typical(joint:BodyJoint)=when(joint) {
    BodyJoint.SHOULDER -> 15.0 to 110.0
    BodyJoint.ELBOW -> 20.0 to 120.0
    BodyJoint.WRIST -> 5.0 to 60.0
    BodyJoint.HIP -> 10.0 to 80.0
    BodyJoint.KNEE -> 15.0 to 90.0
    BodyJoint.ANKLE -> 90.0 to 115.0
}

/** Sitting upright already bends the hip to 90 degrees, so a seated thigh can only lift from the chair. */
private val SEATED_HIP=90.0..120.0
private const val SEATED_HIP_LIFT=115.0

/**
 * Builds the guide for one exercise. A prescribed range is shown as prescribed, within what a body can do. Knee and ankle work
 * is shown seated, and a therapist's own exercise can ask for either posture in its name.
 */
fun guideMotion(joint:BodyJoint,side:BodySide=BodySide.LEFT,name:String?=null,low:Double?=null,high:Double?=null):GuideMotion {
    val words=name.orEmpty().lowercase()
    val seatedByDefault=joint==BodyJoint.KNEE || joint==BodyJoint.ANKLE
    val seated=when {
        joint==BodyJoint.SHOULDER || joint==BodyJoint.ELBOW || joint==BodyJoint.WRIST -> false
        listOf("stand","tayo").any {it in words} -> joint==BodyJoint.ANKLE
        listOf("seat","sit","upo").any {it in words} -> true
        else -> seatedByDefault
    }
    val seatedHip=seated && joint==BodyJoint.HIP
    val limits=if(seatedHip) SEATED_HIP else anatomical(joint)
    val (usualLow,usualHigh)=if(seatedHip) SEATED_HIP.start to SEATED_HIP_LIFT else typical(joint)
    val shownLow=(low ?: usualLow).coerceIn(limits)
    val shownHigh=(high ?: usualHigh).coerceIn(limits)
    // A range that lies wholly below the chair cannot be shown seated, so the usual lift stands in for it.
    val belowTheChair=seatedHip && shownHigh<=shownLow
    return GuideMotion(joint,side,if(joint==BodyJoint.SHOULDER) GuideView.FRONT else GuideView.SIDE,if(seated) GuidePosture.SEATED else GuidePosture.STANDING,
        if(belowTheChair) usualLow else shownLow,if(belowTheChair) usualHigh else shownHigh)
}

fun guideMotion(rules:ExerciseRules)=guideMotion(rules.measuredJoint,rules.side,rules.exerciseName,rules.lowDegrees,rules.highDegrees)

object GuideBody {
    const val FLOOR=100.0
    const val HEAD_RADIUS=6.6
    const val SEAT_HEIGHT=76.0
    private const val ANKLE_HEIGHT=96.0
    private const val UPPER_ARM=16.5
    private const val FOREARM=14.5
    private const val HAND=6.5
    private const val THIGH=23.5
    private const val SHANK=23.0
    private const val FOOT=11.0
    private const val TRUNK=30.0

    /** A direction by angle: 0 straight down, 90 forward, 180 straight up. */
    private fun way(degrees:Double,facing:Int,length:Double):GuidePoint {
        val radians=degrees*PI/180
        return GuidePoint(facing*sin(radians)*length,cos(radians)*length)
    }
    private fun arm(root:GuidePoint,upper:Double,fore:Double,hand:Double,facing:Int):GuideLimb {
        val elbow=root+way(upper,facing,UPPER_ARM)
        val wrist=elbow+way(fore,facing,FOREARM)
        return GuideLimb(root,elbow,wrist,wrist+way(hand,facing,HAND))
    }
    private fun leg(root:GuidePoint,thigh:Double,shank:Double,foot:Double,facing:Int):GuideLimb {
        val knee=root+way(thigh,facing,THIGH)
        val ankle=knee+way(shank,facing,SHANK)
        return GuideLimb(root,knee,ankle,ankle+way(foot,facing,FOOT))
    }

    fun pose(motion:GuideMotion,angle:Double)=if(motion.view==GuideView.FRONT) front(motion,angle) else side(motion,angle)

    /** Facing the camera. The patient's left arm is on the right of the picture. */
    private fun front(motion:GuideMotion,angle:Double):GuidePose {
        val working=if(motion.side==BodySide.LEFT) 1 else -1
        val hips=GuidePoint(0.0,ANKLE_HEIGHT-THIGH-SHANK)
        val shoulders=GuidePoint(0.0,hips.y-TRUNK)
        val near=arm(GuidePoint(9.5*working,shoulders.y+1.5),angle,angle+4,angle+4,working)
        val far=arm(GuidePoint(-9.5*working,shoulders.y+1.5),7.0,11.0,11.0,-working)
        fun standing(sign:Int)=leg(GuidePoint(5.5*sign,hips.y+1),3.0,1.0,3.0,sign).let {it.copy(tip=it.end+GuidePoint(3.0*sign,FLOOR-1-it.end.y))}
        return GuidePose(GuideView.FRONT,working,GuidePosture.STANDING,GuidePoint(0.0,shoulders.y-11),GuidePoint(0.0,shoulders.y-3.5),shoulders,hips,near,far,
            standing(working),standing(-working),near.root,near.middle)
    }

    /** Side on, with the working side toward the camera, as the camera needs for these joints. */
    private fun side(motion:GuideMotion,angle:Double):GuidePose {
        val f=motion.facing
        val seated=motion.posture==GuidePosture.SEATED
        val hips=if(seated) GuidePoint(-6.0*f,ANKLE_HEIGHT-SHANK-1) else GuidePoint(0.0,ANKLE_HEIGHT-THIGH-SHANK)
        val shoulders=hips+GuidePoint(0.0,-TRUNK)
        val shoulder=shoulders+GuidePoint(0.0,1.5)
        val restThigh=if(seated) 90.0 else 2.0
        val restShank=if(seated) 0.0 else -2.0
        val rest=leg(hips,restThigh,restShank,90.0+restShank,f)
        val relaxed=if(seated) arm(shoulder,14.0,62.0,66.0,f) else arm(shoulder,-4.0,6.0,10.0,f)
        val farLeg=if(seated) rest else leg(hips,-3.0,-7.0,83.0,f)
        val farArm=if(seated) arm(shoulder,10.0,58.0,62.0,f) else arm(shoulder,5.0,14.0,18.0,f)
        var nearArm=relaxed
        var nearLeg=rest
        var pivot=rest.middle
        var reach=rest.end
        when(motion.joint) {
            BodyJoint.ELBOW -> {nearArm=arm(shoulder,0.0,angle,angle,f);pivot=nearArm.middle;reach=nearArm.end}
            BodyJoint.WRIST -> {nearArm=arm(shoulder,10.0,90.0,90.0+angle,f);pivot=nearArm.end;reach=nearArm.tip}
            BodyJoint.HIP -> {
                // Standing, the knee relaxes as the thigh rises. Seated, the shin stays upright, so the foot starts flat on the floor.
                // The hip angle is measured to the knee, so neither changes it.
                val shank=if(seated) 0.0 else angle*.45
                nearLeg=leg(hips,angle,shank,shank+90,f);pivot=hips;reach=nearLeg.middle
            }
            BodyJoint.KNEE -> {
                val thigh=if(seated) 90.0 else 0.0
                val shank=thigh-angle
                nearLeg=leg(hips,thigh,shank,shank+90,f);pivot=nearLeg.middle;reach=nearLeg.end
            }
            BodyJoint.ANKLE -> {nearLeg=leg(hips,restThigh,restShank,restShank+angle,f);pivot=nearLeg.end;reach=nearLeg.tip}
            BodyJoint.SHOULDER -> error("The shoulder is shown from the front")
        }
        return GuidePose(GuideView.SIDE,f,motion.posture,shoulders+GuidePoint(1.2*f,-11.0),shoulders+GuidePoint(.6*f,-3.5),shoulders,hips,nearArm,farArm,nearLeg,farLeg,pivot,reach)
    }
}
