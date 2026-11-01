package com.motivance.feature.exercise

import android.graphics.Bitmap
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.motivance.R
import com.motivance.assessment.PreviewMapping
import com.motivance.domain.*

private val PreviewNavy=Color(0xFF002042)
private val FocusMint=Color(0xFF86F2E4)
private val CautionAmber=Color(0xFFFFD09A)
private val BodyInk=Color(0xFFC5D8ED)
private val Bones=listOf(11 to 12,11 to 13,13 to 15,12 to 14,14 to 16,11 to 23,12 to 24,
    23 to 24,23 to 25,25 to 27,24 to 26,26 to 28,27 to 29,29 to 31,27 to 31,28 to 30,30 to 32,28 to 32)

/** Presentation only: uses the camera's exact FIT_CENTER/mirror transform and no inferred joints. */
@Composable internal fun SkeletonPreview(
    bitmap:Bitmap?, points:List<Landmark>, mirrored:Boolean, rules:ExerciseRules,
    metrics:AssessmentSnapshot, qualityLabel:String, modifier:Modifier=Modifier,
) {
    val ready=metrics.quality==TrackingQuality.READY
    val caution=metrics.quality==TrackingQuality.TRUNK_LEAN
    val focus=if(caution) CautionAmber else FocusMint
    val side=stringResource(if(rules.side==BodySide.LEFT) R.string.left_side else R.string.right_side)
    val joint=stringResource(if(rules.kind==ExerciseKind.ELBOW_FLEXION) R.string.skeleton_elbow else R.string.skeleton_shoulder)
    val focusLabel=stringResource(R.string.skeleton_focus,side,joint)
    val description=stringResource(R.string.skeleton_description,focusLabel)
    val primary=if(rules.side==BodySide.LEFT) 11 else 12
    val chain=if(rules.kind==ExerciseKind.ELBOW_FLEXION) listOf(primary,primary+2,primary+4) else listOf(primary+12,primary,primary+2)
    val selectedJoint=chain[1]
    val showBody=bitmap!=null && metrics.quality !in setOf(TrackingQuality.MULTIPLE_PEOPLE,TrackingQuality.NO_PERSON,TrackingQuality.PAUSED)
    val angle=metrics.angleDegrees?.takeIf {ready && bitmap!=null && it.isFinite()}?.let {"%.1f°".format(it)} ?: "—"

    Column(modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(PreviewNavy)
        .border(1.dp,Color(0xFF315171),RoundedCornerShape(24.dp))) {
        Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                Canvas(Modifier.size(7.dp)) {drawCircle(if(bitmap!=null) FocusMint else BodyInk)}
                Text(stringResource(if(bitmap!=null) R.string.skeleton_live else R.string.skeleton_waiting),
                    color=BodyInk,style=MaterialTheme.typography.labelMedium)
            }
            Text(focusLabel,color=Color.White,style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.SemiBold)
        }
        Box(Modifier.fillMaxWidth().heightIn(max=440.dp).aspectRatio(4f/5f)
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
                        Bones.forEach {(a,b) -> if(visible(a) && visible(b)) {
                            val selected=a in chain && b in chain
                            val color=if(selected) focus else BodyInk.copy(alpha=.65f)
                            val width=if(selected) 4.dp.toPx() else 2.dp.toPx()
                            drawLine(Color(0xCC001326),position(a),position(b),width+3.dp.toPx(),StrokeCap.Round)
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
                Text(stringResource(if(metrics.quality==TrackingQuality.PAUSED) R.string.camera_paused else R.string.skeleton_position),color=BodyInk,style=MaterialTheme.typography.bodyMedium)
            }
        }
        Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            Surface(color=if(ready) Color(0xFF103C43) else Color(0xFF20354C),shape=RoundedCornerShape(12.dp)) {
                Text(qualityLabel,Modifier.padding(12.dp).semantics {liveRegion=LiveRegionMode.Polite},
                    color=if(caution) CautionAmber else Color.White,style=MaterialTheme.typography.bodyMedium)
            }
            // These are measured values, not a tracking-confidence or exercise-quality score.
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                MetricTile(stringResource(R.string.skeleton_angle),angle,Modifier.weight(1f))
                MetricTile(stringResource(R.string.skeleton_reps),"${metrics.completed} / ${rules.targetRepetitions}",Modifier.weight(1f))
            }
            Text(stringResource(R.string.skeleton_legend),color=BodyInk,style=MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable private fun MetricTile(label:String,value:String,modifier:Modifier) {
    Column(modifier.clip(RoundedCornerShape(12.dp)).background(Color(0xFF123454)).padding(12.dp),verticalArrangement=Arrangement.spacedBy(4.dp)) {
        Text(label,color=BodyInk,style=MaterialTheme.typography.labelMedium)
        Text(value,color=Color.White,style=MaterialTheme.typography.headlineSmall,fontWeight=FontWeight.Bold)
    }
}
