package com.motivance.feature.exercise

import android.graphics.Bitmap
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.motivance.R
import com.motivance.assessment.*
import com.motivance.domain.*
import com.motivance.designsystem.Motion
import com.motivance.designsystem.durationText
import com.motivance.designsystem.label

private val PreviewNavy=Motion.Night
private val PanelNavy=Motion.NightPanel
private val FocusMint=Motion.SproutBright
private val CautionAmber=Motion.NightCaution
private val BodyInk=Motion.NightInk
private val Shade=Color(0xCC021418)
private val Bones=listOf(11 to 12,11 to 13,13 to 15,12 to 14,14 to 16,11 to 23,12 to 24,
    23 to 24,23 to 25,25 to 27,24 to 26,26 to 28,27 to 29,29 to 31,27 to 31,28 to 30,30 to 32,28 to 32,15 to 19,16 to 20)

private fun degrees(value:Double?)=value?.takeIf {it.isFinite()}?.let {"%.1f°".format(it)} ?: "—"

/**
 * Presentation only: uses the camera's exact FIT_CENTER/mirror transform and no inferred joints.
 * The protractor, gauge and steps are drawn from [MeasurementOverlay] and [RepetitionGuide], which share
 * the engine's landmarks and thresholds, so what the patient sees is the calculation that counts.
 */
@Composable internal fun SkeletonPreview(
    bitmap:Bitmap?, points:List<Landmark>, mirrored:Boolean, rules:ExerciseRules,
    metrics:AssessmentSnapshot, qualityLabel:String, modifier:Modifier=Modifier, details:Boolean=true,
    /** Shown between the header and the image, so it stays in view while the patient watches themselves. */
    coach:(@Composable () -> Unit)?=null,
) {
    val ready=metrics.quality==TrackingQuality.READY
    val caution=metrics.quality==TrackingQuality.TRUNK_LEAN
    val focus=if(caution) CautionAmber else FocusMint
    val side=stringResource(if(rules.side==BodySide.LEFT) R.string.left_side else R.string.right_side)
    val joint=stringResource(rules.focusJoint.label())
    val measurementJoint=stringResource(rules.measuredJoint.label())
    val focusLabel=stringResource(R.string.skeleton_focus,side,joint)
    val description=stringResource(R.string.skeleton_description,focusLabel)
    val chain=rules.focusJoint.chain(rules.side)
    val selectedJoint=rules.focusJoint.landmark(rules.side)
    val showBody=bitmap!=null && metrics.quality !in setOf(TrackingQuality.MULTIPLE_PEOPLE,TrackingQuality.NO_PERSON,TrackingQuality.PAUSED)
    val focusVisible=points.getOrNull(selectedJoint)?.let {it.x.isFinite() && it.y.isFinite() && it.visibility.isFinite() && it.visibility>=rules.confidence && it.x in 0f..1f && it.y in 0f..1f}==true
    val liveAngle=metrics.angleDegrees?.takeIf {ready && bitmap!=null && it.isFinite()}
    val guide=RepetitionGuide.of(rules,if(bitmap!=null) metrics else metrics.copy(angleDegrees=null))
    // Geometry is only computed when the engine itself accepted the frame.
    val density=LocalDensity.current
    var viewport by remember {mutableStateOf(IntSize.Zero)}
    val protractor=if(ready && showBody && bitmap!=null && viewport.width>0 && viewport.height>0) {
        // Convert a 48dp on-screen minimum into frame pixels through the same FIT_CENTER scale.
        val scale=minOf(viewport.width.toFloat()/bitmap.width,viewport.height.toFloat()/bitmap.height)
        MeasurementOverlay.protractor(points,rules,bitmap.width,bitmap.height,with(density) {48.dp.toPx()}/scale.toDouble())
    } else null
    val measurer=rememberTextMeasurer()

    Column(modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(PreviewNavy)
        .border(1.dp,Motion.NightLine,RoundedCornerShape(24.dp))) {
        Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                val live by rememberInfiniteTransition(label="live").animateFloat(1f,.3f,
                    infiniteRepeatable(tween(1100,easing=FastOutSlowInEasing),RepeatMode.Reverse),label="live-dot")
                Canvas(Modifier.size(8.dp).alpha(if(bitmap!=null) live else 1f)) {drawCircle(if(bitmap!=null) FocusMint else BodyInk)}
                Text(stringResource(if(bitmap!=null) R.string.skeleton_live else R.string.skeleton_waiting),
                    color=BodyInk,style=MaterialTheme.typography.labelMedium)
            }
            Text(focusLabel,color=Color.White,style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.SemiBold)
            if(rules.focusJoint!=rules.measuredJoint) Text(stringResource(R.string.focus_measurement,measurementJoint),color=BodyInk,style=MaterialTheme.typography.bodySmall)
            if(showBody && !focusVisible) Text(stringResource(R.string.focus_not_visible),color=CautionAmber,style=MaterialTheme.typography.bodySmall)
            coach?.invoke()
        }
        Box(Modifier.fillMaxWidth().heightIn(max=440.dp).aspectRatio(4f/5f).onSizeChanged {viewport=it}
            .semantics {contentDescription=description},contentAlignment=Alignment.Center) {
            Canvas(Modifier.fillMaxSize()) {
                if(size.width<=0 || size.height<=0) return@Canvas
                bitmap?.let {frame ->
                    val mapping=PreviewMapping(frame.width,frame.height,size.width,size.height,mirrored)
                    drawIntoCanvas {canvas ->
                        canvas.nativeCanvas.save()
                        if(mirrored) {canvas.nativeCanvas.translate(size.width,0f);canvas.nativeCanvas.scale(-1f,1f)}
                        canvas.nativeCanvas.drawBitmap(frame,null,android.graphics.RectF(mapping.left,mapping.top,mapping.left+mapping.width,mapping.top+mapping.height),null)
                        canvas.nativeCanvas.restore()
                    }
                    if(showBody) {
                        fun visible(index:Int):Boolean=points.getOrNull(index)?.let {
                            it.x.isFinite() && it.y.isFinite() && it.visibility.isFinite() &&
                                it.visibility>=rules.confidence && it.x in 0f..1f && it.y in 0f..1f
                        }==true
                        fun position(index:Int):Offset=mapping.map(points[index]).let {Offset(it.first,it.second)}
                        // A restrained torso tint makes the active limb easier to distinguish.
                        if(listOf(11,12,24,23).all(::visible)) {
                            val torso=Path().apply {val a=position(11);moveTo(a.x,a.y);listOf(12,24,23).forEach {val p=position(it);lineTo(p.x,p.y)};close()}
                            drawPath(torso,BodyInk.copy(alpha=.07f))
                        }
                        // When the visual focus differs from the measured joint, the measured limb stays legible.
                        val measured=rules.measurementChain().let {listOf(it.proximal to it.vertex,it.vertex to it.distal)}
                        Bones.forEach {(a,b) -> if(visible(a) && visible(b)) {
                            val selected=a in chain && b in chain
                            val measuring=protractor!=null && !selected && measured.any {(x,y) -> (x==a && y==b) || (x==b && y==a)}
                            val color=when {selected -> focus; measuring -> Color.White.copy(alpha=.9f); else -> BodyInk.copy(alpha=.65f)}
                            val width=if(selected) 4.dp.toPx() else if(measuring) 3.dp.toPx() else 2.dp.toPx()
                            drawLine(Shade,position(a),position(b),width+3.dp.toPx(),StrokeCap.Round)
                            drawLine(color,position(a),position(b),width,StrokeCap.Round)
                        }}
                        // Only body landmarks and a small nose marker; no busy face/hand mesh.
                        (listOf(0)+(11..32)).forEach {index -> if(visible(index)) {
                            val selected=index in chain
                            val radius=if(selected) 5.dp.toPx() else 2.5.dp.toPx()
                            drawCircle(PreviewNavy.copy(alpha=.85f),radius+2.dp.toPx(),position(index))
                            drawCircle(if(selected) focus else BodyInk,radius,position(index))
                            if(selected) drawCircle(Color.White,radius,position(index),style=Stroke(1.5.dp.toPx()))
                        }}
                        if(visible(selectedJoint)) {
                            drawCircle(focus.copy(alpha=.12f),16.dp.toPx(),position(selectedJoint))
                            drawCircle(focus,12.dp.toPx(),position(selectedJoint),style=Stroke(1.5.dp.toPx()))
                        }
                        protractor?.let {drawProtractor(it,mapping,rules,liveAngle,measurer)}
                    }
                }
                // Lightweight brackets frame the image without suggesting an anatomical target.
                val inset=16.dp.toPx();val length=20.dp.toPx();val width=1.5.dp.toPx()
                listOf(Offset(inset,inset) to Offset(1f,1f),Offset(size.width-inset,inset) to Offset(-1f,1f),
                    Offset(inset,size.height-inset) to Offset(1f,-1f),Offset(size.width-inset,size.height-inset) to Offset(-1f,-1f)).forEach {(p,direction) ->
                    drawLine(BodyInk.copy(alpha=.6f),p,p+Offset(length*direction.x,0f),width,StrokeCap.Round)
                    drawLine(BodyInk.copy(alpha=.6f),p,p+Offset(0f,length*direction.y),width,StrokeCap.Round)
                }
            }
            if(bitmap==null) Column(Modifier.padding(32.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(12.dp)) {
                Icon(Icons.Default.Person,null,tint=BodyInk.copy(alpha=.55f),modifier=Modifier.size(52.dp))
                Text(stringResource(if(metrics.quality==TrackingQuality.PAUSED) R.string.camera_paused else R.string.skeleton_position),color=BodyInk,
                    style=MaterialTheme.typography.bodyMedium,textAlign=TextAlign.Center)
            }
            val chip by animateColorAsState(when {caution -> Color(0xE64A3410); ready -> Color(0xE6103C2A); else -> Color(0xE6132F38)},label="quality")
            Row(Modifier.align(Alignment.BottomCenter).padding(12.dp).clip(RoundedCornerShape(50)).background(chip)
                .padding(horizontal=12.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                Canvas(Modifier.size(8.dp)) {drawCircle(if(caution) CautionAmber else if(ready) FocusMint else BodyInk)}
                Text(qualityLabel,Modifier.semantics {liveRegion=LiveRegionMode.Polite},
                    color=if(caution) CautionAmber else Color.White,style=MaterialTheme.typography.labelLarge)
            }
        }
        Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            // These are measured values, not a tracking-confidence or exercise-quality score.
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                MetricTile(stringResource(R.string.measured_joint_angle,measurementJoint),degrees(liveAngle),Modifier.weight(1f))
                MetricTile(stringResource(R.string.skeleton_reps),"${metrics.completed} / ${rules.targetRepetitions}",Modifier.weight(1f),
                    accent=metrics.completed>0,animate=true)
                // Rounded up, so the clock reads 0:00 only when the side has actually ended.
                SideSet.remainingMs(rules,metrics)?.let {MetricTile(stringResource(R.string.set_time_left),Seconds.clock((it+999)/1000),Modifier.weight(1f))}
            }
            if(details) CalculationContent(rules,metrics,liveAngle,guide,measurementJoint)
        }
    }
}

/**
 * The live calculation behind the count (gauge, rule steps, session range and legends). The session screen
 * places it below the controls so Start and Pause stay next to the camera image.
 */
@Composable internal fun SessionCalculations(hasFrame:Boolean,rules:ExerciseRules,metrics:AssessmentSnapshot,modifier:Modifier=Modifier) {
    val liveAngle=metrics.angleDegrees?.takeIf {metrics.quality==TrackingQuality.READY && hasFrame && it.isFinite()}
    val guide=RepetitionGuide.of(rules,if(hasFrame) metrics else metrics.copy(angleDegrees=null))
    Column(modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(PreviewNavy).border(1.dp,Motion.NightLine,RoundedCornerShape(24.dp))
        .padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.how_reps_counted),color=Color.White,style=MaterialTheme.typography.titleMedium,modifier=Modifier.semantics {heading()})
        CalculationContent(rules,metrics,liveAngle,guide,stringResource(rules.measuredJoint.label()))
    }
}

@Composable private fun CalculationContent(rules:ExerciseRules,metrics:AssessmentSnapshot,liveAngle:Double?,guide:RepetitionGuide,measurementJoint:String) {
    AngleGauge(rules,metrics,liveAngle,guide,measurementJoint)
    RepetitionSteps(rules,guide)
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(12.dp)) {
        MetricTile(stringResource(R.string.calc_session_rom),degrees(metrics.romDegrees),Modifier.weight(1f))
        MetricTile(stringResource(R.string.calc_not_counted),metrics.incomplete.toString(),Modifier.weight(1f))
    }
    Text(stringResource(R.string.calc_rule_summary,measurementJoint,rules.lowDegrees.toInt(),rules.highDegrees.toInt(),
        durationText(rules.peakHoldMs),durationText(rules.minimumCycleMs),durationText(rules.maximumCycleMs)),
        color=Color.White,style=MaterialTheme.typography.bodySmall)
    Text(if(rules.demo) stringResource(R.string.calc_source_demo) else stringResource(R.string.calc_source_prescribed,rules.version),
        color=if(rules.demo) CautionAmber else FocusMint,style=MaterialTheme.typography.labelSmall)
    Text(stringResource(R.string.skeleton_legend),color=BodyInk,style=MaterialTheme.typography.labelSmall)
    Text(stringResource(R.string.calc_legend),color=BodyInk,style=MaterialTheme.typography.labelSmall)
}

/** Protractor at the measured joint: dashed 0° reference, start/target zones, threshold ticks and live arc. */
private fun DrawScope.drawProtractor(p:Protractor,mapping:PreviewMapping,rules:ExerciseRules,angle:Double?,measurer:TextMeasurer) {
    fun o(point:FramePoint)=mapping.map(point.landmark()).let {Offset(it.first,it.second)}
    fun polyline(list:List<FramePoint>)=Path().apply {list.firstOrNull()?.let {val s=o(it);moveTo(s.x,s.y)};list.drop(1).forEach {val q=o(it);lineTo(q.x,q.y)}}
    val shadow=Shade
    val vertex=o(p.vertex)
    drawLine(shadow,vertex,o(p.referenceEnd),3.5.dp.toPx(),StrokeCap.Round)
    drawLine(Color.White.copy(alpha=.8f),vertex,o(p.referenceEnd),1.5.dp.toPx(),StrokeCap.Round,
        PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(),5.dp.toPx())))
    drawPath(polyline(p.startZone),BodyInk.copy(alpha=.45f),style=Stroke(7.dp.toPx(),cap=StrokeCap.Butt))
    drawPath(polyline(p.targetZone),FocusMint.copy(alpha=.5f),style=Stroke(7.dp.toPx(),cap=StrokeCap.Butt))
    val measured=angle ?: p.rawAngleDegrees
    val arcColor=when {measured>=rules.highDegrees -> FocusMint; measured<=rules.lowDegrees -> BodyInk; else -> Color.White}
    drawPath(polyline(p.measuredArc),shadow,style=Stroke(5.dp.toPx(),cap=StrokeCap.Round))
    drawPath(polyline(p.measuredArc),arcColor,style=Stroke(2.5.dp.toPx(),cap=StrokeCap.Round))
    listOf(p.lowTick,p.highTick).forEach {(a,b) ->
        drawLine(shadow,o(a),o(b),4.dp.toPx(),StrokeCap.Round)
        drawLine(Color.White,o(a),o(b),2.dp.toPx(),StrokeCap.Round)
    }
    fun chip(text:String,at:Offset,background:Color,foreground:Color,bold:Boolean=false) {
        val layout=measurer.measure(text,TextStyle(color=foreground,fontSize=11.sp,fontWeight=if(bold) FontWeight.Bold else FontWeight.Medium))
        val pad=4.dp.toPx()
        val w=layout.size.width+pad*2; val h=layout.size.height+pad
        val left=(at.x-w/2).coerceIn(0f,(size.width-w).coerceAtLeast(0f)); val top=(at.y-h/2).coerceIn(0f,(size.height-h).coerceAtLeast(0f))
        drawRoundRect(background,Offset(left,top),Size(w,h),CornerRadius(h/2))
        drawText(layout,topLeft=Offset(left+pad,top+pad/2))
    }
    chip("${rules.lowDegrees.toInt()}°",o(p.lowLabel),PreviewNavy.copy(alpha=.85f),BodyInk)
    chip("${rules.highDegrees.toInt()}°",o(p.highLabel),PreviewNavy.copy(alpha=.85f),FocusMint)
    chip("%.0f°".format(measured),o(p.angleLabel),arcColor,PreviewNavy,bold=true)
}

/** 0–180° gauge: start zone, target zone, the session's achieved range and the live angle needle. */
@Composable private fun AngleGauge(rules:ExerciseRules,metrics:AssessmentSnapshot,angle:Double?,guide:RepetitionGuide,joint:String) {
    val range=metrics.minimumDegrees?.let {min -> metrics.maximumDegrees?.let {max -> min to max}}
    // Progress toward the target is only meaningful while the patient is raising or holding.
    val progress=guide.targetProgress?.takeIf {guide.step==RepStep.REACH || guide.step==RepStep.HOLD}?.let {(it*100).toInt()}
    val description=stringResource(R.string.calc_gauge_description,joint,degrees(angle),rules.lowDegrees.toInt(),rules.highDegrees.toInt(),
        range?.let {"${degrees(it.first)} – ${degrees(it.second)}"} ?: "—")
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(PanelNavy).padding(12.dp)
        .semantics(mergeDescendants=true) {contentDescription=description},verticalArrangement=Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween,verticalAlignment=Alignment.CenterVertically) {
            Text(stringResource(R.string.calc_gauge_title),color=BodyInk,style=MaterialTheme.typography.labelMedium)
            Text(progress?.let {stringResource(R.string.calc_progress,it)} ?: "—",color=Color.White,style=MaterialTheme.typography.labelMedium,fontWeight=FontWeight.SemiBold)
        }
        Canvas(Modifier.fillMaxWidth().height(28.dp)) {
            fun x(d:Double)=(d.coerceIn(0.0,180.0)/180.0*size.width).toFloat()
            val top=size.height*.3f; val h=size.height*.4f; val radius=CornerRadius(h/2)
            drawRoundRect(Color(0xFF041A1F),Offset(0f,top),Size(size.width,h),radius)
            drawRoundRect(BodyInk.copy(alpha=.35f),Offset(0f,top),Size(x(rules.lowDegrees),h),radius)
            drawRoundRect(FocusMint.copy(alpha=.45f),Offset(x(rules.highDegrees),top),Size(size.width-x(rules.highDegrees),h),radius)
            range?.let {(min,max) -> drawLine(Color.White.copy(alpha=.75f),Offset(x(min),top-3.dp.toPx()),Offset(x(max),top-3.dp.toPx()),2.dp.toPx(),StrokeCap.Round)}
            listOf(rules.lowDegrees,rules.highDegrees).forEach {drawLine(Color.White,Offset(x(it),top),Offset(x(it),top+h),1.5.dp.toPx())}
            angle?.let {
                val nx=x(it)
                val color=when {it>=rules.highDegrees -> FocusMint; it<=rules.lowDegrees -> BodyInk; else -> Color.White}
                drawLine(PreviewNavy,Offset(nx,0f),Offset(nx,size.height),5.dp.toPx(),StrokeCap.Round)
                drawLine(color,Offset(nx,0f),Offset(nx,size.height),3.dp.toPx(),StrokeCap.Round)
            }
        }
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween) {
            Text(stringResource(R.string.calc_start_zone,rules.lowDegrees.toInt()),color=BodyInk,style=MaterialTheme.typography.labelSmall)
            Text(stringResource(R.string.calc_target_zone,rules.highDegrees.toInt()),color=FocusMint,style=MaterialTheme.typography.labelSmall,textAlign=TextAlign.End)
        }
    }
}

/** The engine's four-step repetition rule with the active step highlighted. Two rows keep large text readable. */
@Composable private fun RepetitionSteps(rules:ExerciseRules,guide:RepetitionGuide) {
    val steps=listOf(
        Triple(RepStep.START,R.string.calc_step_start,"≤ ${rules.lowDegrees.toInt()}°"),
        Triple(RepStep.REACH,R.string.calc_step_reach,"≥ ${rules.highDegrees.toInt()}°"),
        Triple(RepStep.HOLD,R.string.calc_step_hold,durationText(rules.peakHoldMs)),
        Triple(RepStep.RETURN,R.string.calc_step_return,"≤ ${rules.lowDegrees.toInt()}°"),
    )
    val activeLabel=guide.step?.let {active -> stringResource(steps.first {it.first==active}.second)}
    Column(Modifier.fillMaxWidth().semantics {liveRegion=LiveRegionMode.Polite
        contentDescription=activeLabel ?: ""},verticalArrangement=Arrangement.spacedBy(8.dp)) {
        steps.chunked(2).forEach {row ->
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                row.forEach {(step,label,condition) ->
                    val active=guide.step==step
                    Column(Modifier.weight(1f).clip(RoundedCornerShape(10.dp))
                        .background(if(active) FocusMint else PanelNavy).padding(horizontal=10.dp,vertical=8.dp)) {
                        Text("${step.ordinal+1}. ${stringResource(label)}",color=if(active) PreviewNavy else BodyInk,
                            style=MaterialTheme.typography.labelMedium,fontWeight=FontWeight.SemiBold)
                        Text(condition,color=if(active) PreviewNavy else Color.White,style=MaterialTheme.typography.titleSmall,fontWeight=FontWeight.Bold)
                        if(step==RepStep.HOLD && rules.peakHoldMs>0 && (active || guide.step==RepStep.RETURN)) LinearProgressIndicator(
                            progress={guide.holdProgress.toFloat()},modifier=Modifier.fillMaxWidth().padding(top=4.dp).height(4.dp),
                            color=if(active) PreviewNavy else FocusMint,trackColor=(if(active) PreviewNavy else BodyInk).copy(alpha=.25f))
                    }
                }
            }
        }
    }
}

/** A live reading. [animate] rolls the value upward when it changes, for counts rather than per-frame angles. */
@Composable private fun MetricTile(label:String,value:String,modifier:Modifier,accent:Boolean=false,animate:Boolean=false) {
    Column(modifier.clip(RoundedCornerShape(16.dp)).background(PanelNavy).padding(14.dp),verticalArrangement=Arrangement.spacedBy(4.dp)) {
        Text(label,color=BodyInk,style=MaterialTheme.typography.labelMedium)
        val style=MaterialTheme.typography.headlineMedium
        val color=if(accent) FocusMint else Color.White
        if(animate) AnimatedContent(value,transitionSpec={(slideInVertically {it}+fadeIn()) togetherWith (slideOutVertically {-it}+fadeOut())},label="metric") {
            Text(it,color=color,style=style)
        } else Text(value,color=color,style=style)
    }
}
