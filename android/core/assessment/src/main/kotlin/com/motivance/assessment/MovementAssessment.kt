package com.motivance.assessment

import com.motivance.domain.*
import kotlin.math.*

/** Image-plane geometry in pixel units, avoiding normalized-coordinate aspect distortion. */
object JointAngles {
    fun included(a: Landmark,b: Landmark,c: Landmark,width:Int,height:Int):Double? {
        if(width<=0 || height<=0) return null
        val ux=(a.x-b.x)*width.toDouble(); val uy=(a.y-b.y)*height.toDouble()
        val vx=(c.x-b.x)*width.toDouble(); val vy=(c.y-b.y)*height.toDouble()
        val first=hypot(ux,uy); val second=hypot(vx,vy)
        if(!first.isFinite() || !second.isFinite() || first<5 || second<5) return null
        return Math.toDegrees(acos(((ux*vx+uy*vy)/(first*second)).coerceIn(-1.0,1.0)))
    }
}

/** Single-threaded state machine. A new/recovered stream must reacquire neutral position. */
class MovementAssessment(val rules:ExerciseRules, restored:AssessmentSnapshot?=null) {
    private var state=(restored ?: AssessmentSnapshot()).copy(timestampMs=0,running=false,angleDegrees=null,phase=MovementPhase.SEEKING_START,quality=TrackingQuality.PAUSED,feedback=RepFeedback.NONE)
    private val samples=ArrayDeque<Double>()
    private var stable=0
    private var lastFrame=-1L
    private var lastAngle:Double?=null
    private var lastAngleTime=0L
    private var cycleStarted=0L
    private var peakStarted:Long?=null
    private var lastClock:Long?=null
    val snapshot:AssessmentSnapshot get()=state

    fun start(timestampMs:Long):Boolean {
        if(state.running || state.quality!=TrackingQuality.READY || timestampMs<state.timestampMs) return false
        state=state.copy(running=true,phase=MovementPhase.SEEKING_START,feedback=RepFeedback.NONE)
        lastClock=timestampMs
        return true
    }
    fun pause(timestampMs:Long):AssessmentSnapshot {
        advance(timestampMs)
        resetCycle(); resetFilter()
        state=state.copy(timestampMs=maxOf(timestampMs,state.timestampMs),running=false,quality=TrackingQuality.PAUSED,angleDegrees=null,feedback=RepFeedback.NONE)
        lastClock=null
        return state
    }
    private fun advance(time:Long) {
        val last=lastClock
        if(state.running && last!=null && time>=last) state=state.copy(durationMs=state.durationMs+time-last)
        if(last==null || time>=last) lastClock=time
    }
    private fun resetCycle() { state=state.copy(phase=MovementPhase.SEEKING_START); peakStarted=null; cycleStarted=0 }
    private fun resetFilter() { stable=0; samples.clear(); lastAngle=null }
    private fun incomplete(reason:RepFeedback) {
        state=state.copy(incomplete=state.incomplete+1,feedback=reason,failureReasons=state.failureReasons+(reason to ((state.failureReasons[reason] ?: 0)+1)))
    }
    private fun invalid(quality:TrackingQuality,time:Long):AssessmentSnapshot {
        resetCycle(); resetFilter()
        state=state.copy(timestampMs=time,quality=quality,angleDegrees=null,feedback=RepFeedback.NONE,invalidFrames=state.invalidFrames+if(state.running) 1 else 0)
        return state
    }

    fun process(people:List<List<Landmark>>,width:Int,height:Int,time:Long):AssessmentSnapshot {
        if(time<=lastFrame || time<state.timestampMs) return state
        if(lastFrame>=0 && time-lastFrame>1000) { resetCycle(); resetFilter() }
        lastFrame=time; advance(time)
        if(people.isEmpty()) return invalid(TrackingQuality.NO_PERSON,time)
        if(people.size!=1) return invalid(TrackingQuality.MULTIPLE_PEOPLE,time)
        val points=people.single()
        val shoulder=if(rules.side==BodySide.LEFT) 11 else 12
        val elbow=shoulder+2; val wrist=shoulder+4; val hip=shoulder+12
        val required=if(rules.kind==ExerciseKind.ELBOW_FLEXION) listOf(shoulder,elbow,wrist,hip) else listOf(hip,shoulder,elbow)
        if(required.any { it>=points.size || !points[it].visibility.isFinite() || points[it].visibility<rules.confidence }) return invalid(TrackingQuality.LOW_CONFIDENCE,time)
        if(required.any { !points[it].x.isFinite() || !points[it].y.isFinite() || points[it].x !in .02f.. .98f || points[it].y !in .02f.. .98f }) return invalid(TrackingQuality.OUT_OF_FRAME,time)
        if((points[hip].y-points[shoulder].y)*height<5) return invalid(TrackingQuality.DEGENERATE,time)
        val a=if(rules.kind==ExerciseKind.ELBOW_FLEXION) points[shoulder] else points[hip]
        val b=if(rules.kind==ExerciseKind.ELBOW_FLEXION) points[elbow] else points[shoulder]
        val c=if(rules.kind==ExerciseKind.ELBOW_FLEXION) points[wrist] else points[elbow]
        val included=JointAngles.included(a,b,c,width,height) ?: return invalid(TrackingQuality.DEGENERATE,time)
        val raw=if(rules.kind==ExerciseKind.ELBOW_FLEXION) 180-included else included
        val lean=Math.toDegrees(atan2(abs((points[shoulder].x-points[hip].x)*width),abs((points[shoulder].y-points[hip].y)*height)).toDouble())
        if(lean>rules.maxTrunkLeanDegrees) return invalid(TrackingQuality.TRUNK_LEAN,time)
        val previous=lastAngle
        if(previous!=null && time>lastAngleTime && abs(raw-previous)*1000/(time-lastAngleTime)>rules.maxSpeedDegreesPerSecond) return invalid(TrackingQuality.OUTLIER,time)
        lastAngle=raw; lastAngleTime=time
        samples.addLast(raw); if(samples.size>3) samples.removeFirst()
        stable++
        if(stable<rules.stableFrames) {
            state=state.copy(timestampMs=time,quality=TrackingQuality.POSITIONING,angleDegrees=null,invalidFrames=state.invalidFrames+if(state.running) 1 else 0)
            return state
        }
        val angle=samples.sorted()[samples.size/2]
        state=state.copy(timestampMs=time,quality=TrackingQuality.READY,angleDegrees=angle,feedback=RepFeedback.NONE)
        if(!state.running) return state
        state=state.copy(validFrames=state.validFrames+1,minimumDegrees=state.minimumDegrees?.let { min(it,angle) } ?: angle,maximumDegrees=state.maximumDegrees?.let { max(it,angle) } ?: angle)
        if(state.phase in setOf(MovementPhase.MOVING,MovementPhase.AT_TARGET) && time-cycleStarted>rules.maximumCycleMs) {
            incomplete(RepFeedback.TIMED_OUT); resetCycle(); return state
        }
        when(state.phase) {
            MovementPhase.SEEKING_START -> if(angle<=rules.lowDegrees) state=state.copy(phase=MovementPhase.REST)
            MovementPhase.REST -> if(angle>rules.lowDegrees+5) { cycleStarted=time; state=state.copy(phase=MovementPhase.MOVING) }
            MovementPhase.MOVING -> {
                if(angle>=rules.highDegrees) {
                    if(peakStarted==null) peakStarted=time
                    if(time-peakStarted!!>=rules.peakHoldMs) state=state.copy(phase=MovementPhase.AT_TARGET,feedback=RepFeedback.TARGET_REACHED)
                } else peakStarted=null
                if(angle<=rules.lowDegrees) { incomplete(RepFeedback.INCOMPLETE_RANGE); state=state.copy(phase=MovementPhase.REST); peakStarted=null }
            }
            MovementPhase.AT_TARGET -> if(angle<=rules.lowDegrees) {
                val valid=time-cycleStarted>=rules.minimumCycleMs
                if(!valid) incomplete(RepFeedback.TOO_FAST)
                state=state.copy(completed=state.completed+if(valid) 1 else 0,phase=MovementPhase.REST,feedback=if(valid) RepFeedback.COMPLETE else RepFeedback.TOO_FAST)
                peakStarted=null
            }
        }
        return state
    }
}
