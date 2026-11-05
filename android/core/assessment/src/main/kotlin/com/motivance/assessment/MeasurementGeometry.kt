package com.motivance.assessment

import com.motivance.domain.*
import kotlin.math.*

/**
 * The three landmarks an exercise is measured on, shared by [MovementAssessment] and the overlay so
 * the drawn protractor is the same calculation that drives repetition counting.
 *
 * The measured angle is always the angle between a 0° [reference] direction leaving [vertex] and the
 * moving segment `vertex -> distal`:
 * - Elbow, wrist, hip, knee, ankle: reference continues the proximal segment, so a straight limb is 0°.
 * - Shoulder: reference points down the trunk (shoulder -> hip), so an arm at the side is 0°.
 */
data class MeasurementChain(val proximal:Int, val vertex:Int, val distal:Int, val extendsProximal:Boolean) {
    val landmarks get()=listOf(proximal,vertex,distal)
}

fun ExerciseRules.measurementChain():MeasurementChain {
    val (proximal,vertex,distal)=measuredJoint.chain(side)
    return MeasurementChain(proximal,vertex,distal,extendsProximal=measuredJoint.straightIsZero)
}

/** A point in normalized frame coordinates (0..1), ready for [PreviewMapping.map]. */
data class FramePoint(val x:Float, val y:Float) { fun landmark()=Landmark(x,y,1f) }

/**
 * Protractor drawn at the measured joint. Every point is derived from the frame's pixel geometry so the
 * angles stay correct under FIT_CENTER scaling and mirroring.
 */
data class Protractor(
    val vertex:FramePoint,
    val referenceEnd:FramePoint,
    val movingEnd:FramePoint,
    /** Arc from 0° to the raw (unfiltered) angle of this frame. */
    val measuredArc:List<FramePoint>,
    /** Start zone: 0° to the therapist's low threshold. */
    val startZone:List<FramePoint>,
    /** Target zone: the therapist's high threshold to 180°. */
    val targetZone:List<FramePoint>,
    val lowTick:Pair<FramePoint,FramePoint>,
    val highTick:Pair<FramePoint,FramePoint>,
    val lowLabel:FramePoint,
    val highLabel:FramePoint,
    val angleLabel:FramePoint,
    val rawAngleDegrees:Double,
)

object MeasurementOverlay {
    private const val ARC_STEP_DEGREES=3.0

    /**
     * Builds the protractor for one frame, or null if any measured landmark fails the same confidence and
     * frame checks the engine applies. Nothing is drawn for joints the engine would not measure.
     * [minRadiusPx] (frame pixels) keeps the protractor legible when the limb is small on screen.
     */
    fun protractor(points:List<Landmark>,rules:ExerciseRules,width:Int,height:Int,minRadiusPx:Double=0.0):Protractor? {
        if(width<=0 || height<=0) return null
        val chain=rules.measurementChain()
        if(chain.landmarks.any {index -> points.getOrNull(index)?.let {
                it.visibility.isFinite() && it.visibility>=rules.confidence && it.x.isFinite() && it.y.isFinite() &&
                    it.x in .02f..0.98f && it.y in .02f..0.98f
            }!=true}) return null
        fun px(index:Int)=points[index].let {doubleArrayOf(it.x*width.toDouble(),it.y*height.toDouble())}
        val p=px(chain.proximal); val v=px(chain.vertex); val d=px(chain.distal)
        val proximalLength=hypot(v[0]-p[0],v[1]-p[1]); val distalLength=hypot(d[0]-v[0],d[1]-v[1])
        if(proximalLength<5 || distalLength<5) return null
        // Unit 0° reference and moving directions.
        val rx=(if(chain.extendsProximal) v[0]-p[0] else p[0]-v[0])/proximalLength
        val ry=(if(chain.extendsProximal) v[1]-p[1] else p[1]-v[1])/proximalLength
        val mx=(d[0]-v[0])/distalLength; val my=(d[1]-v[1])/distalLength
        val raw=Math.toDegrees(acos((rx*mx+ry*my).coerceIn(-1.0,1.0)))
        // Arcs sweep toward the moving segment; a perfectly collinear pose sweeps positively.
        val sign=if(rx*my-ry*mx<0) -1.0 else 1.0
        val radius=maxOf(.42*min(proximalLength,distalLength),minRadiusPx)
        // Negative angles fall on the far side of the 0° reference, where no zone or tick is drawn.
        fun at(degrees:Double,scale:Double):FramePoint {
            val a=Math.toRadians(degrees.coerceIn(-180.0,180.0))*sign
            val x=v[0]+(rx*cos(a)-ry*sin(a))*radius*scale; val y=v[1]+(rx*sin(a)+ry*cos(a))*radius*scale
            return FramePoint((x/width).toFloat(),(y/height).toFloat())
        }
        fun arc(rawFrom:Double,rawTo:Double,scale:Double=1.0):List<FramePoint> {
            val from=rawFrom.coerceIn(0.0,180.0); val to=rawTo.coerceIn(0.0,180.0)
            if(to<=from) return listOf(at(from,scale))
            val steps=ceil((to-from)/ARC_STEP_DEGREES).toInt().coerceAtLeast(1)
            return (0..steps).map {at(from+(to-from)*it/steps,scale)}
        }
        val labelInside=raw>=30
        return Protractor(
            vertex=at(0.0,0.0),
            referenceEnd=at(0.0,1.6),
            movingEnd=FramePoint(points[chain.distal].x,points[chain.distal].y),
            measuredArc=arc(0.0,raw),
            startZone=arc(0.0,rules.lowDegrees),
            targetZone=arc(rules.highDegrees,180.0),
            lowTick=at(rules.lowDegrees.coerceIn(0.0,180.0),.72) to at(rules.lowDegrees.coerceIn(0.0,180.0),1.28),
            highTick=at(rules.highDegrees.coerceIn(0.0,180.0),.72) to at(rules.highDegrees.coerceIn(0.0,180.0),1.28),
            lowLabel=at(rules.lowDegrees,1.62),
            highLabel=at(rules.highDegrees,1.62),
            // Small sweeps leave no room inside the arc, so the value sits just across the reference.
            angleLabel=if(labelInside) at(raw/2,.62) else at(-30.0,1.15),
            rawAngleDegrees=raw,
        )
    }
}

/** Steps of the repetition rule, in the order the engine requires them. */
enum class RepStep { START, REACH, HOLD, RETURN }

/** What the patient must do next and how far along the current step is, derived from engine state only. */
data class RepetitionGuide(val step:RepStep?, val targetProgress:Double?, val holdProgress:Double) {
    companion object {
        fun of(rules:ExerciseRules,snapshot:AssessmentSnapshot):RepetitionGuide {
            val angle=snapshot.angleDegrees?.takeIf {snapshot.quality==TrackingQuality.READY && it.isFinite()}
                ?: return RepetitionGuide(null,null,0.0)
            val step=when(snapshot.phase) {
                MovementPhase.SEEKING_START -> RepStep.START
                MovementPhase.REST -> RepStep.REACH
                MovementPhase.MOVING -> if(snapshot.holdElapsedMs>0) RepStep.HOLD else RepStep.REACH
                MovementPhase.AT_TARGET -> RepStep.RETURN
            }
            val hold=when {
                snapshot.phase==MovementPhase.AT_TARGET -> 1.0
                rules.peakHoldMs<=0 -> 0.0
                else -> (snapshot.holdElapsedMs.toDouble()/rules.peakHoldMs).coerceIn(0.0,1.0)
            }
            return RepetitionGuide(step,((angle-rules.lowDegrees)/(rules.highDegrees-rules.lowDegrees)).coerceIn(0.0,1.0),hold)
        }
    }
}
