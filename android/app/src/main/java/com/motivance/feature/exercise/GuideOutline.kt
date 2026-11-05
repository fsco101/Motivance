package com.motivance.feature.exercise

import androidx.compose.ui.geometry.Offset
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/**
 * The body of the model person, as points for a curve to pass through. It is the person from the web sign-in page, so the
 * front view repeats the outlines in `web/src/auth/FormFigure.tsx`, and the side view is drawn to the same proportions.
 *
 * Units are the web figure's. Parts that hang from a joint start at that joint, with +y running down the bone and +x forward,
 * or outward in the front view. Side-view shoes are the exception: +y runs toward the toe and +x runs up.
 */
internal object GuideOutline {
    /** How long each bone is in these units. The rig's own length then stretches the part to fit. */
    const val UpperArmLength=106f
    const val ForearmLength=88f
    const val HandLength=44f
    const val ThighLength=142f
    const val ShankLength=139f
    const val FootLength=67f
    /** Where the shoulder sits on the web figure, which the front torso hangs from. */
    const val ShoulderY=176f

    private fun points(vararg values:Int)=List(values.size/2) {Offset(values[it*2].toFloat(),values[it*2+1].toFloat())}
    /** Mirrors the right half of a shape across the body's centre line. Points on the centre line are not repeated. */
    private fun both(half:List<Offset>)=half+half.reversed().filter {it.x!=0f}.map {Offset(-it.x,it.y)}
    private fun oval(x:Float,y:Float,width:Float,height:Float)=List(12) {Offset(x+width*cos(it*PI/6).toFloat(),y+height*sin(it*PI/6).toFloat())}

    // Arms, in both views
    val UpperArm=points(-14,-13, 0,-19, 14,-13, 18,12, 17,48, 14,82, 13,108, -12,108, -14,82, -15,44, -15,10)
    val Sleeve=points(-15,-14, 0,-20, 15,-14, 19,12, 18,42, -15,46, -16,10)
    val Forearm=points(-13,-6, -16,22, -12,56, -8,90, 8,90, 11,56, 17,24, 13,-6)
    val Hand=points(-8,-3, -10,14, -9,28, -5,40, 1,44, 7,39, 10,26, 9,10, 8,-3)
    val Thumb=points(-8,6, -15,15, -15,26, -10,24, -7,17)

    // Facing the camera. The head is centred on the rig's head point, and the torso keeps the web figure's page coordinates.
    val Face=both(points(0,-40, 19,-37, 30,-21, 32,1, 27,19, 15,34, 0,40))
    val Hair=points(-33,3, -36,-23, -27,-43, -8,-52, 14,-52, 31,-41, 37,-21, 34,3, 29,-11, 24,-23, 8,-26, -10,-23, -24,-21, -29,-9)
    val LeftEar=oval(-32f,3f,4.5f,8f)
    val RightEar=oval(32f,3f,4.5f,8f)
    val LeftEye=oval(-12.5f,0f,2.6f,3.2f)
    val RightEye=oval(12.5f,0f,2.6f,3.2f)
    val Neck=both(points(14,108, 15,138, 30,152, 12,170, 0,174))
    val Shirt=both(points(0,170, 15,162, 25,147, 48,153, 67,168, 66,205, 60,236, 53,264, 55,288, 0,294))
    val Shorts=both(points(0,282, 53,278, 66,305, 73,345, 75,392, 44,398, 12,392, 3,358, 0,352))
    /** The web figure's single leg, split at the knee so the rig can bend it. */
    val Thigh=points(-19,-20, 0,-30, 30,-20, 34,10, 35,50, 29,98, 22,140, 19,156, 8,166, -8,160, -13,140, -10,98, -20,50, -20,10)
    val Shank=points(-13,-12, 0,-18, 19,-12, 20,26, 20,66, 12,116, 9,142, -9,142, -13,116, -19,66, -18,26)
    /** Measured up from the floor, because the shoes stand on it. */
    val Shoe=points(-10,-43, 10,-43, 18,-27, 23,-15, 15,-5, -9,-5, -19,-13, -15,-29)
    val Sole=points(-18,-12, -9,-7, 15,-7, 23,-13, 23,-5, 15,0, -9,0, -19,-5)

    // Side on, facing +x
    val ProfileHand=points(-9,-3, -11,12, -11,27, -8,38, -1,44, 6,42, 10,32, 11,16, 9,-3)
    val ProfileFingers=listOf(Offset(-4f,25f) to Offset(-4f,40f), Offset(1f,26f) to Offset(1f,42f), Offset(6f,25f) to Offset(6f,39f))
    val ProfileHead=points(-2,-40, 16,-37, 28,-24, 31,-9, 29,-2, 33,6, 38,13, 33,18, 32,22, 29,25, 31,29, 27,33, 27,40, 15,44, -2,40, -14,28, -30,14, -37,-6, -30,-28, -16,-38)
    val ProfileEar=points(-13,-8, -6,-9, -4,0, -7,9, -11,12, -14,3)
    val ProfileHair=points(25,-25, 22,-40, 8,-50, -12,-51, -30,-43, -40,-24, -42,-4, -37,10, -29,16, -23,10, -18,0, -16,-9, -7,-12, -3,6, 1,-8, 9,-19, 17,-23)
    val ProfileEye=oval(19f,-1f,2.4f,3.2f)
    val ProfileNeck=points(20,-40, 20,-8, 24,12, -22,12, -20,-8, -16,-44)
    val ProfileTorso=points(17,-12, 33,8, 41,34, 39,66, 35,100, 34,135, 38,170, 0,176, -39,171, -33,130, -38,84, -43,40, -38,6, -20,-13)
    val ProfilePelvis=points(33,-26, 37,0, 31,22, 0,33, -27,29, -41,8, -36,-26)
    val ProfileThigh=points(-30,0, -34,35, -30,80, -22,118, -20,142, -10,160, 10,162, 22,150, 23,138, 26,110, 31,70, 32,30, 28,0, 0,-16)
    val ProfileShank=points(-20,-6, -28,30, -30,55, -22,90, -13,125, -12,145, 12,145, 13,120, 18,80, 21,40, 23,10, 19,-8, 0,-14)
    val ProfileShorts=points(-33,-5, -37,35, -37,78, -36,87, -29,90, 28,90, 35,87, 36,78, 35,30, 31,-5, 0,-18)
    val ProfileShoe=points(17,-17, 0,-24, -16,-23, -18,10, -18,58, -13,71, -3,67, 3,50, 11,32, 23,17, 20,0)
    val ProfileSole=points(-15,-23, -16,10, -16,60, -15,69, -19,71, -24,60, -24,-17, -20,-24)
    /** The lowest points under the heel and the toe, which must not pass through the floor. */
    val Heel=Offset(-24f,-17f)
    val Toe=Offset(-24f,60f)
}
