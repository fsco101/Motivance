package com.motivance.feature.exercise

import android.provider.Settings
import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.motivance.R
import com.motivance.designsystem.Motion
import com.motivance.domain.*
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.min

/** One full repetition, slow enough to follow. */
private const val REPETITION_MS=4200

private class Outfit(val skin:Color,val skinFar:Color,val hair:Color,val top:Color,val topFar:Color,val shorts:Color,val shortsFar:Color,val shoe:Color,val shoeFar:Color,val sole:Color,val prop:Color,val shadow:Color,val floor:Color,val range:Color,val rangeBack:Color)

private val OnLight=Outfit(Color(0xFFC98E66),Color(0xFFAE7650),Color(0xFF2B211C),Motion.Lagoon,Color(0xFF0A5F68),Motion.Ink,Color(0xFF28495A),Color.White,Color(0xFFD7E4E2),Motion.Amber,Color(0xFF8FB0AE),Color(0x220D2B36),Color(0x330D2B36),Motion.Sprout,Color(0x551B7F45))
private val OnDark=Outfit(Color(0xFFD8A07A),Color(0xFFB98660),Color(0xFF3A2A22),Color(0xFF17A3AF),Color(0xFF0E7C86),Color(0xFFE9F3F1),Color(0xFFB6CCCA),Color.White,Color(0xFFC3D3D1),Motion.Amber,Motion.NightLine,Color(0x55000000),Color(0x55BFE3DD),Motion.SproutBright,Color(0x666FE08F))

/** Follows the device's "remove animations" setting. */
@Composable private fun animationsOff():Boolean {
    val resolver=LocalContext.current.contentResolver
    return remember {Settings.Global.getFloat(resolver,Settings.Global.ANIMATOR_DURATION_SCALE,1f)==0f}
}

/**
 * The model person demonstrating one exercise on repeat, through its prescribed range. Tapping pauses it, because moving
 * content must be possible to stop. With animations turned off it holds the target position.
 */
@Composable fun ExerciseGuide(motion:GuideMotion,name:String,modifier:Modifier=Modifier,dark:Boolean=false,still:Boolean=animationsOff()) {
    var playing by remember(motion) {mutableStateOf(true)}
    val time by rememberInfiniteTransition(label="guide").animateFloat(0f,1f,infiniteRepeatable(tween(REPETITION_MS,easing=LinearEasing)),label="repetition")
    var heldAt by remember(motion) {mutableFloatStateOf(.5f)}
    val description=stringResource(R.string.guide_description,name,motion.low.toInt(),motion.high.toInt())
    val action=stringResource(if(playing) R.string.guide_pause else R.string.guide_play)
    val moving=playing && !still
    Box(modifier.semantics {contentDescription=description}.clickable(enabled=!still,role=Role.Button,onClickLabel=action) {if(playing) heldAt=time;playing=!playing}) {
        Canvas(Modifier.fillMaxSize()) {drawGuide(motion,motion.angleAt((if(moving) time else if(still) .5f else heldAt).toDouble()),if(dark) OnDark else OnLight,range=true)}
        if(!still) Surface(Modifier.align(Alignment.BottomEnd).padding(8.dp).size(30.dp),shape=CircleShape,color=(if(dark) Motion.NightPanel else Color.White).copy(alpha=.85f)) {
            val tint=if(dark) Color.White else Motion.Ink
            Canvas(Modifier.padding(9.dp)) {
                if(playing) listOf(.2f,.8f).forEach {drawLine(tint,Offset(size.width*it,0f),Offset(size.width*it,size.height),size.width*.26f,StrokeCap.Round)}
                else drawPath(Path().apply {moveTo(size.width*.1f,0f);lineTo(size.width,size.height/2);lineTo(size.width*.1f,size.height);close()},tint)
            }
        }
    }
}

/** The guide on its own stage, for a card or a page. */
@Composable fun GuideStage(motion:GuideMotion,name:String,modifier:Modifier=Modifier,dark:Boolean=false) {
    Surface(modifier.fillMaxWidth(),shape=androidx.compose.material3.MaterialTheme.shapes.medium,color=if(dark) Motion.NightPanel else Motion.Tide) {
        ExerciseGuide(motion,name,Modifier.fillMaxSize(),dark=dark)
    }
}

/** A still of the character at the target position, for lists. */
@Composable fun ExerciseThumbnail(motion:GuideMotion,modifier:Modifier=Modifier) {
    Canvas(modifier) {drawGuide(motion,motion.high,OnLight,range=false)}
}

private fun DrawScope.drawGuide(motion:GuideMotion,angle:Double,outfit:Outfit,range:Boolean) {
    val frame=motion.frame
    val scale=(min(size.width,size.height)/frame.span).toFloat()
    fun at(point:GuidePoint)=Offset(size.width/2+((point.x-frame.centerX)*scale).toFloat(),size.height/2+((point.y-frame.centerY)*scale).toFloat())
    fun u(value:Double)=(value*scale).toFloat()
    val pose=motion.pose(angle)
    val floor=at(GuidePoint(0.0,GuideBody.FLOOR)).y
    clipRect {
        drawLine(outfit.floor,Offset(0f,floor),Offset(size.width,floor),u(.6),StrokeCap.Round)
        val under=at(GuidePoint(if(pose.view==GuideView.SIDE) pose.hips.x+6*pose.facing else 0.0,GuideBody.FLOOR))
        drawOval(outfit.shadow,Offset(under.x-u(24.0),under.y-u(1.6)),Size(u(48.0),u(3.2)))
        val stage=Stage(::at,::u,floor,outfit)
        if(pose.view==GuideView.FRONT) drawFront(pose,stage) else drawSide(pose,stage)
        if(range) drawRange(motion,angle,outfit,::at,::u)
    }
}

/** One rig unit is this many outline units, which makes the head the size the rig gives it. */
private const val OUTLINE_UNIT=GuideBody.HEAD_RADIUS/40
/** The rig's trunk is longer than the web figure's, so the front torso is drawn a little taller than it is wide. */
private const val TORSO_UNIT=.19

private class Stage(val at:(GuidePoint)->Offset,val u:(Double)->Float,val floor:Float,val outfit:Outfit) {
    /** Lays an outline along a bone, so it turns and stretches with the rig. A [side] of -1 mirrors it. */
    fun bone(from:GuidePoint,to:GuidePoint,length:Float,side:Int):(Offset)->Offset {
        val start=at(from);val end=at(to)
        val span=hypot(end.x-start.x,end.y-start.y).coerceAtLeast(.01f)
        val ux=(end.x-start.x)/span;val uy=(end.y-start.y)/span
        val along=span/length;val across=u(OUTLINE_UNIT)*side
        return {start+Offset(ux*it.y*along+uy*it.x*across,uy*it.y*along-ux*it.x*across)}
    }
    /** Stands an outline upright on a point of the body. */
    fun upright(point:GuidePoint,side:Int=1):(Offset)->Offset {
        val center=at(point);val unit=u(OUTLINE_UNIT)
        return {center+Offset(it.x*unit*side,it.y*unit)}
    }
}

/** A closed curve through the points, so the body has soft anatomical lines and no mechanical joints. */
private fun DrawScope.shape(points:List<Offset>,place:(Offset)->Offset,color:Color) {
    val corners=points.map(place)
    fun at(index:Int)=corners[(index+corners.size)%corners.size]
    drawPath(Path().apply {
        moveTo(at(0).x,at(0).y)
        corners.indices.forEach {
            val a=at(it-1);val b=at(it);val c=at(it+1);val d=at(it+2)
            cubicTo(b.x+(c.x-a.x)/6,b.y+(c.y-a.y)/6,c.x-(d.x-b.x)/6,c.y-(d.y-b.y)/6,c.x,c.y)
        }
        close()
    },color)
}

/** A brow or a mouth: a line that bends once. */
private fun DrawScope.stroke(from:Offset,bend:Offset,to:Offset,place:(Offset)->Offset,color:Color,width:Float) {
    val a=place(from);val b=place(bend);val c=place(to)
    drawPath(Path().apply {moveTo(a.x,a.y);quadraticTo(b.x,b.y,c.x,c.y)},color,style=Stroke(width,cap=StrokeCap.Round))
}

private fun DrawScope.arm(limb:GuideLimb,side:Int,stage:Stage,skin:Color,shade:Color,sleeve:Color,profile:Boolean,sleeveShade:Color?=null) {
    val upper=stage.bone(limb.root,limb.middle,GuideOutline.UpperArmLength,side)
    val fore=stage.bone(limb.middle,limb.end,GuideOutline.ForearmLength,side)
    val hand=stage.bone(limb.end,limb.tip,GuideOutline.HandLength,side)
    shape(GuideOutline.Forearm,fore,skin)
    shape(GuideOutline.Thumb,hand,shade)
    shape(if(profile) GuideOutline.ProfileHand else GuideOutline.Hand,hand,skin)
    if(profile) GuideOutline.ProfileFingers.forEach {(from,to) ->
        drawLine(shade.copy(alpha=.6f),hand(from),hand(to),stage.u(.14),StrokeCap.Round)
    }
    shape(GuideOutline.UpperArm,upper,skin)
    // A crescent of shade under the sleeve keeps the arm apart from a shirt of the same colour.
    if(sleeveShade!=null) shape(GuideOutline.Sleeve,{upper(it+Offset(-3f,4f))},sleeveShade)
    shape(GuideOutline.Sleeve,upper,sleeve)
}

private fun DrawScope.frontLeg(limb:GuideLimb,side:Int,stage:Stage) {
    val outfit=stage.outfit
    shape(GuideOutline.Shank,stage.bone(limb.middle,limb.end,GuideOutline.ShankLength,side),outfit.skin)
    shape(GuideOutline.Thigh,stage.bone(limb.root,limb.middle,GuideOutline.ThighLength,side),outfit.skin)
    val foot=stage.upright(GuidePoint(limb.end.x,GuideBody.FLOOR),side)
    shape(GuideOutline.Sole,foot,outfit.sole)
    shape(GuideOutline.Shoe,foot,outfit.shoe)
}

private fun DrawScope.sideLeg(limb:GuideLimb,side:Int,stage:Stage,skin:Color,shorts:Color,shoe:Color) {
    shape(GuideOutline.ProfileShank,stage.bone(limb.middle,limb.end,GuideOutline.ShankLength,side),skin)
    val thigh=stage.bone(limb.root,limb.middle,GuideOutline.ThighLength,side)
    shape(GuideOutline.ProfileThigh,thigh,skin)
    shape(GuideOutline.ProfileShorts,thigh,shorts)
    val foot=stage.bone(limb.end,limb.tip,GuideOutline.FootLength,side)
    // A foot rocks on its heel, but the rig turns it around the ankle, so the shoe is lifted back out of the floor.
    val sunk=(maxOf(foot(GuideOutline.Heel).y,foot(GuideOutline.Toe).y)-stage.floor).coerceAtLeast(0f)
    val standing={point:Offset -> foot(point)-Offset(0f,sunk)}
    shape(GuideOutline.ProfileSole,standing,stage.outfit.sole)
    shape(GuideOutline.ProfileShoe,standing,shoe)
}

private fun DrawScope.drawSide(pose:GuidePose,stage:Stage) {
    val outfit=stage.outfit;val u=stage.u;val facing=pose.facing
    if(pose.posture==GuidePosture.SEATED) {
        val seat=stage.at(GuidePoint(pose.hips.x-3.0*facing,GuideBody.SEAT_HEIGHT))
        listOf(-9.0,9.0).forEach {drawLine(outfit.prop,Offset(seat.x+u(it),seat.y),Offset(seat.x+u(it*1.25),stage.floor),u(1.6),StrokeCap.Round)}
        drawRoundRect(outfit.prop,Offset(seat.x-u(13.0),seat.y-u(.2)),Size(u(26.0),u(2.8)),CornerRadius(u(1.4)))
    }
    arm(pose.farArm,facing,stage,outfit.skinFar,outfit.skinFar,outfit.topFar,profile=true)
    sideLeg(pose.farLeg,facing,stage,outfit.skinFar,outfit.shortsFar,outfit.shoeFar)
    shape(GuideOutline.ProfilePelvis,stage.upright(pose.hips,facing),outfit.shorts)
    sideLeg(pose.nearLeg,facing,stage,outfit.skin,outfit.shorts,outfit.shoe)
    // The shirt comes after the leg, so it hangs over the shorts and falls across a raised thigh.
    val trunk=stage.upright(pose.shoulders,facing)
    shape(GuideOutline.ProfileNeck,trunk,outfit.skinFar)
    shape(GuideOutline.ProfileTorso,trunk,outfit.top)
    sideHead(pose,stage)
    arm(pose.nearArm,facing,stage,outfit.skin,outfit.skinFar,outfit.top,profile=true,sleeveShade=outfit.topFar)
}

private fun DrawScope.drawFront(pose:GuidePose,stage:Stage) {
    val outfit=stage.outfit;val working=pose.facing
    frontLeg(pose.nearLeg,working,stage)
    frontLeg(pose.farLeg,-working,stage)
    val shoulder=stage.at(GuidePoint(pose.shoulders.x,pose.shoulders.y+1.5))
    val across=stage.u(OUTLINE_UNIT);val down=stage.u(TORSO_UNIT)
    val trunk={point:Offset -> shoulder+Offset(point.x*across,(point.y-GuideOutline.ShoulderY)*down)}
    shape(GuideOutline.Shorts,trunk,outfit.shorts)
    shape(GuideOutline.Neck,trunk,outfit.skinFar)
    shape(GuideOutline.Shirt,trunk,outfit.top)
    frontHead(pose,stage)
    arm(pose.farArm,-working,stage,outfit.skin,outfit.skinFar,outfit.top,profile=false)
    arm(pose.nearArm,working,stage,outfit.skin,outfit.skinFar,outfit.top,profile=false)
}

private fun DrawScope.frontHead(pose:GuidePose,stage:Stage) {
    val outfit=stage.outfit;val u=stage.u
    val head=stage.upright(pose.head)
    shape(GuideOutline.Face,head,outfit.skin)
    shape(GuideOutline.LeftEar,head,outfit.skinFar)
    shape(GuideOutline.RightEar,head,outfit.skinFar)
    shape(GuideOutline.Hair,head,outfit.hair)
    shape(GuideOutline.LeftEye,head,outfit.hair)
    shape(GuideOutline.RightEye,head,outfit.hair)
    stroke(Offset(-19f,-9f),Offset(-12f,-13f),Offset(-6f,-9f),head,outfit.hair,u(.36))
    stroke(Offset(6f,-9f),Offset(12f,-13f),Offset(19f,-9f),head,outfit.hair,u(.36))
    stroke(Offset(-1f,5f),Offset(-3f,13f),Offset(1f,14f),head,outfit.hair.copy(alpha=.45f),u(.26))
    stroke(Offset(-8f,23f),Offset(0f,29f),Offset(8f,23f),head,outfit.hair,u(.33))
}

private fun DrawScope.sideHead(pose:GuidePose,stage:Stage) {
    val outfit=stage.outfit;val u=stage.u
    val head=stage.upright(pose.head,pose.facing)
    shape(GuideOutline.ProfileHead,head,outfit.skin)
    shape(GuideOutline.ProfileEar,head,outfit.skinFar)
    shape(GuideOutline.ProfileHair,head,outfit.hair)
    shape(GuideOutline.ProfileEye,head,outfit.hair)
    stroke(Offset(11f,-10f),Offset(18f,-14f),Offset(26f,-10f),head,outfit.hair,u(.36))
    stroke(Offset(18f,26f),Offset(24f,28f),Offset(30f,25f),head,outfit.hair,u(.3))
}

/** The prescribed sweep around the working joint, with the current position filled in. */
private fun DrawScope.drawRange(motion:GuideMotion,angle:Double,outfit:Outfit,at:(GuidePoint)->Offset,u:(Double)->Float) {
    fun bearing(pose:GuidePose):Double {
        val pivot=at(pose.pivot);val reach=at(pose.reach)
        return atan2((reach.y-pivot.y).toDouble(),(reach.x-pivot.x).toDouble())*180/PI
    }
    fun turn(from:Double,to:Double):Double {
        val raw=(to-from+540)%360-180
        return if(raw<-180) raw+360 else raw
    }
    val from=motion.pose(motion.low)
    val start=bearing(from)
    val full=sweep(motion,start,bearing(motion.pose(motion.high)),::turn)
    val travelled=if(motion.high>motion.low) full*(angle-motion.low)/(motion.high-motion.low) else 0.0
    val pivot=at(motion.pose(angle).pivot)
    val radius=u(if(motion.joint==BodyJoint.WRIST || motion.joint==BodyJoint.ANKLE) 9.0 else 13.0)
    val box=Offset(pivot.x-radius,pivot.y-radius);val area=Size(radius*2,radius*2)
    val width=u(.7)
    drawArc(outfit.rangeBack,start.toFloat(),full.toFloat(),false,box,area,style=Stroke(width,cap=StrokeCap.Round,pathEffect=PathEffect.dashPathEffect(floatArrayOf(u(1.6),u(1.6)))))
    drawArc(outfit.range,start.toFloat(),travelled.toFloat(),false,box,area,style=Stroke(width*1.6f,cap=StrokeCap.Round))
    drawCircle(outfit.range,u(1.3),pivot)
}

/** Follows the way the joint really turns, which can pass the half circle, by checking a point halfway along. */
private fun sweep(motion:GuideMotion,start:Double,end:Double,turn:(Double,Double)->Double):Double {
    val short=turn(start,end)
    if(abs(motion.high-motion.low)<=170) return short
    return if(short>0) short-360 else short+360
}
