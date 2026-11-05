package com.motivance.domain

enum class ExerciseKind { ELBOW_FLEXION, SHOULDER_ABDUCTION, CUSTOM }
enum class BodySide { LEFT, RIGHT }

/**
 * A joint the camera can follow, as a visual focus or as the measured joint of a custom exercise.
 * [straightIsZero]: 0° is the limb continuing straight through the joint. The shoulder instead reads 0° with the arm
 * resting against the trunk.
 */
enum class BodyJoint(private val leftPoint:Int,private val leftChain:List<Int>,val straightIsZero:Boolean=true) {
    SHOULDER(11,listOf(23,11,13),straightIsZero=false), ELBOW(13,listOf(11,13,15)), WRIST(15,listOf(13,15,19)),
    HIP(23,listOf(11,23,25)), KNEE(25,listOf(23,25,27)), ANKLE(27,listOf(25,27,31));
    fun landmark(side:BodySide)=leftPoint+if(side==BodySide.RIGHT) 1 else 0
    fun chain(side:BodySide)=leftChain.map {it+if(side==BodySide.RIGHT) 1 else 0}
}
val ExerciseKind.measurementJoint:BodyJoint get()=when(this) {
    ExerciseKind.ELBOW_FLEXION -> BodyJoint.ELBOW
    ExerciseKind.SHOULDER_ABDUCTION -> BodyJoint.SHOULDER
    ExerciseKind.CUSTOM -> error("A custom exercise names its own measured joint")
}

/** Immutable parameters pinned for one session. Demo rules are never a prescription. */
data class ExerciseRules(
    val kind: ExerciseKind = ExerciseKind.ELBOW_FLEXION,
    val side: BodySide = BodySide.LEFT,
    val lowDegrees: Double = 20.0,
    val highDegrees: Double = 90.0,
    val targetRepetitions: Int = 5,
    val confidence: Float = .7f,
    val stableFrames: Int = 5,
    val minimumCycleMs: Long = 600,
    val maximumCycleMs: Long = 30_000,
    val peakHoldMs: Long = 100,
    val maxTrunkLeanDegrees: Double = 20.0,
    val maxSpeedDegreesPerSecond: Double = 600.0,
    val version: String = "demo-v1",
    val prescriptionVersionId: String? = null,
    val demo: Boolean = true,
    val measuredJoint: BodyJoint = kind.measurementJoint,
    val focusJoint: BodyJoint = measuredJoint,
    /** The therapist's name for a custom exercise. Built-in exercises use their translated names. */
    val exerciseName: String? = null
) {
    init {
        require(if(kind==ExerciseKind.CUSTOM) !exerciseName.isNullOrBlank() else measuredJoint==kind.measurementJoint && exerciseName==null)
        require(lowDegrees.isFinite() && highDegrees.isFinite() && lowDegrees>=0 && highDegrees<=180 && highDegrees>lowDegrees+10)
        require(targetRepetitions in 1..1000 && confidence in .1f..1f && stableFrames>0)
        require(minimumCycleMs>0 && maximumCycleMs>minimumCycleMs && peakHoldMs>=0)
        require(maxSpeedDegreesPerSecond.isFinite() && maxSpeedDegreesPerSecond>0)
        require(maxTrunkLeanDegrees.isFinite() && maxTrunkLeanDegrees in 0.0..90.0)
        require(version.isNotBlank() && (demo || !prescriptionVersionId.isNullOrBlank()))
    }
}

enum class TrackingQuality { NO_PERSON, MULTIPLE_PEOPLE, LOW_CONFIDENCE, OUT_OF_FRAME, DEGENERATE, OUTLIER, POSITIONING, TRUNK_LEAN, READY, PAUSED }
enum class MovementPhase { SEEKING_START, REST, MOVING, AT_TARGET }
enum class RepFeedback { NONE, TARGET_REACHED, COMPLETE, INCOMPLETE_RANGE, TOO_FAST, TIMED_OUT }
data class AssessmentSnapshot(
    val timestampMs: Long = 0,
    val quality: TrackingQuality = TrackingQuality.NO_PERSON,
    val angleDegrees: Double? = null,
    val minimumDegrees: Double? = null,
    val maximumDegrees: Double? = null,
    val completed: Int = 0,
    val incomplete: Int = 0,
    val durationMs: Long = 0,
    val validFrames: Int = 0,
    val invalidFrames: Int = 0,
    val phase: MovementPhase = MovementPhase.SEEKING_START,
    val feedback: RepFeedback = RepFeedback.NONE,
    val running: Boolean = false,
    val failureReasons: Map<RepFeedback,Int> = emptyMap(),
    /** Time spent at or above the high threshold in the current attempt. Live-only; not persisted. */
    val holdElapsedMs: Long = 0
) {
    val romDegrees: Double? get()=if(minimumDegrees!=null && maximumDegrees!=null) maximumDegrees-minimumDegrees else null
}
