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
private val OnDark=Outfit(Color(0xFFD8A07A),Color(0xFFB98660),Color(0xFF17110E),Color(0xFF17A3AF),Color(0xFF0E7C86),Color(0xFFE9F3F1),Color(0xFFB6CCCA),Color.White,Color(0xFFC3D3D1),Motion.Amber,Motion.NightLine,Color(0x55000000),Color(0x55BFE3DD),Motion.SproutBright,Color(0x666FE08F))

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
    clipRect {
        val floor=at(GuidePoint(0.0,GuideBody.FLOOR)).y
        drawLine(outfit.floor,Offset(0f,floor),Offset(size.width,floor),u(.6),StrokeCap.Round)
        val under=at(GuidePoint(if(pose.view==GuideView.SIDE) pose.hips.x+6*pose.facing else 0.0,GuideBody.FLOOR))
        drawOval(outfit.shadow,Offset(under.x-u(24.0),under.y-u(1.6)),Size(u(48.0),u(3.2)))
        if(pose.view==GuideView.FRONT) drawFront(pose,outfit,::at,::u) else drawSide(pose,outfit,::at,::u)
        if(range) drawRange(motion,angle,outfit,::at,::u)
    }
}

/** A limb segment that tapers from one joint to the next. */
private fun DrawScope.limb(a:Offset,b:Offset,ra:Float,rb:Float,color:Color) {
    val dx=b.x-a.x;val dy=b.y-a.y;val length=hypot(dx,dy)
    if(length>.01f) {
        val nx=-dy/length;val ny=dx/length
        drawPath(Path().apply {
            moveTo(a.x+nx*ra,a.y+ny*ra);lineTo(b.x+nx*rb,b.y+ny*rb);lineTo(b.x-nx*rb,b.y-ny*rb);lineTo(a.x-nx*ra,a.y-ny*ra);close()
        },color)
    }
    drawCircle(color,ra,a);drawCircle(color,rb,b)
}

private fun blend(a:Offset,b:Offset,share:Float)=Offset(a.x+(b.x-a.x)*share,a.y+(b.y-a.y)*share)

private fun DrawScope.arm(limb:GuideLimb,skin:Color,sleeve:Color,at:(GuidePoint)->Offset,u:(Double)->Float) {
    val shoulder=at(limb.root);val elbow=at(limb.middle);val wrist=at(limb.end);val tip=at(limb.tip)
    limb(blend(wrist,tip,.15f),blend(wrist,tip,.75f),u(1.9),u(1.5),skin)
    limb(elbow,wrist,u(2.5),u(1.8),skin)
    limb(shoulder,elbow,u(3.3),u(2.6),skin)
    limb(shoulder,blend(shoulder,elbow,.4f),u(3.5),u(3.0),sleeve)
}

private fun DrawScope.leg(limb:GuideLimb,skin:Color,shorts:Color,shoe:Color,sole:Color,at:(GuidePoint)->Offset,u:(Double)->Float) {
    val hip=at(limb.root);val knee=at(limb.middle);val ankle=at(limb.end);val toe=at(limb.tip)
    limb(knee,ankle,u(3.4),u(2.2),skin)
    limb(hip,knee,u(4.5),u(3.5),skin)
    limb(hip,blend(hip,knee,.55f),u(4.8),u(4.3),shorts)
    val shin=hypot(ankle.x-knee.x,ankle.y-knee.y).coerceAtLeast(1f)
    val down=Offset((ankle.x-knee.x)/shin*u(1.7),(ankle.y-knee.y)/shin*u(1.7))
    limb(ankle+down*.2f,blend(ankle,toe,.95f)+down*.75f,u(1.2),u(.9),sole)
    limb(ankle,blend(ankle,toe,.9f),u(2.4),u(1.7),shoe)
}

private fun DrawScope.drawSide(pose:GuidePose,outfit:Outfit,at:(GuidePoint)->Offset,u:(Double)->Float) {
    val hips=at(pose.hips);val shoulders=at(pose.shoulders)
    if(pose.posture==GuidePosture.SEATED) {
        val seat=at(GuidePoint(pose.hips.x-3.0*pose.facing,GuideBody.SEAT_HEIGHT))
        val floor=at(GuidePoint(0.0,GuideBody.FLOOR)).y
        listOf(-9.0,9.0).forEach {drawLine(outfit.prop,Offset(seat.x+u(it),seat.y),Offset(seat.x+u(it*1.25),floor),u(1.6),StrokeCap.Round)}
        limb(Offset(seat.x-u(12.0),seat.y+u(1.0)),Offset(seat.x+u(12.0),seat.y+u(1.0)),u(1.6),u(1.6),outfit.prop)
    }
    arm(pose.farArm,outfit.skinFar,outfit.topFar,at,u)
    leg(pose.farLeg,outfit.skinFar,outfit.shortsFar,outfit.shoeFar,outfit.sole,at,u)
    limb(hips,hips,u(5.6),u(5.6),outfit.shorts)
    limb(blend(shoulders,hips,.02f),blend(shoulders,hips,.84f),u(6.4),u(5.5),outfit.top)
    limb(at(pose.neck),blend(at(pose.neck),at(pose.head),.6f),u(2.5),u(2.5),outfit.skinFar)
    head(pose,outfit,at,u)
    leg(pose.nearLeg,outfit.skin,outfit.shorts,outfit.shoe,outfit.sole,at,u)
    arm(pose.nearArm,outfit.skin,outfit.top,at,u)
}

private fun DrawScope.drawFront(pose:GuidePose,outfit:Outfit,at:(GuidePoint)->Offset,u:(Double)->Float) {
    val hips=at(pose.hips);val shoulders=at(pose.shoulders)
    leg(pose.nearLeg,outfit.skin,outfit.shorts,outfit.shoe,outfit.sole,at,u)
    leg(pose.farLeg,outfit.skin,outfit.shorts,outfit.shoe,outfit.sole,at,u)
    drawPath(Path().apply {
        moveTo(shoulders.x-u(11.5),shoulders.y-u(.2))
        quadraticTo(shoulders.x,shoulders.y-u(3.2),shoulders.x+u(11.5),shoulders.y-u(.2))
        quadraticTo(shoulders.x+u(9.0),shoulders.y+u(14.0),hips.x+u(9.0),hips.y-u(4.0))
        lineTo(hips.x+u(9.8),hips.y+u(4.0));lineTo(hips.x-u(9.8),hips.y+u(4.0));lineTo(hips.x-u(9.0),hips.y-u(4.0))
        quadraticTo(shoulders.x-u(9.0),shoulders.y+u(14.0),shoulders.x-u(11.5),shoulders.y-u(.2));close()
    },outfit.top)
    limb(Offset(hips.x-u(5.5),hips.y+u(2.0)),Offset(hips.x+u(5.5),hips.y+u(2.0)),u(4.8),u(4.8),outfit.shorts)
    limb(at(pose.neck),blend(at(pose.neck),at(pose.head),.6f),u(2.5),u(2.5),outfit.skinFar)
    head(pose,outfit,at,u)
    arm(pose.farArm,outfit.skin,outfit.top,at,u)
    arm(pose.nearArm,outfit.skin,outfit.top,at,u)
}

private fun DrawScope.head(pose:GuidePose,outfit:Outfit,at:(GuidePoint)->Offset,u:(Double)->Float) {
    val center=at(pose.head);val r=u(GuideBody.HEAD_RADIUS)
    drawCircle(outfit.skin,r,center)
    val hair=r*1.07f;val box=Offset(center.x-hair,center.y-hair);val area=Size(hair*2,hair*2)
    if(pose.view==GuideView.FRONT) {
        drawArc(outfit.hair,186f,168f,false,box,area)
        val eye=r*.36f
        listOf(-eye,eye).forEach {drawCircle(outfit.hair,r*.09f,Offset(center.x+it,center.y+r*.12f))}
        drawArc(outfit.hair,25f,130f,false,Offset(center.x-r*.3f,center.y+r*.14f),Size(r*.6f,r*.42f),style=Stroke(r*.07f,cap=StrokeCap.Round))
    } else {
        val f=pose.facing
        // A cap over the crown and the back of the head. It stops at the forehead and the nape, so the face stays clear.
        drawPath(Path().apply {
            val rad=hair
            fun rim(degrees:Double)=Offset(center.x+f*rad*kotlin.math.cos(degrees*PI/180).toFloat(),center.y+rad*kotlin.math.sin(degrees*PI/180).toFloat())
            val forehead=rim(-38.0);val nape=rim(118.0)
            moveTo(forehead.x,forehead.y)
            for(degrees in -38 downTo -242 step 6) rim(degrees.toDouble()).let {lineTo(it.x,it.y)}
            lineTo(nape.x,nape.y)
            quadraticTo(center.x-f*r*.32f,center.y-r*.02f,center.x-f*r*.02f,center.y-r*.3f)
            quadraticTo(center.x+f*r*.3f,center.y-r*.46f,forehead.x,forehead.y)
            close()
        },outfit.hair)
        drawCircle(outfit.skinFar,r*.17f,Offset(center.x-f*r*.12f,center.y+r*.14f))
        drawCircle(outfit.hair,r*.09f,Offset(center.x+f*r*.56f,center.y+r*.06f))
        drawCircle(outfit.skin,r*.17f,Offset(center.x+f*r*.97f,center.y+r*.24f))
    }
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
