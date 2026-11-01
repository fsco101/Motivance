package com.motivance.domain

enum class ExerciseKind { ELBOW_FLEXION, SHOULDER_ABDUCTION }
enum class BodySide { LEFT, RIGHT }

/** Visual focus only; adding a focus does not implement a new movement assessment. */
enum class BodyJoint(private val leftPoint:Int,private val leftChain:List<Int>) {
    SHOULDER(11,listOf(23,11,13)), ELBOW(13,listOf(11,13,15)), WRIST(15,listOf(13,15,19)),
    HIP(23,listOf(11,23,25)), KNEE(25,listOf(23,25,27)), ANKLE(27,listOf(25,27,31));
    fun landmark(side:BodySide)=leftPoint+if(side==BodySide.RIGHT) 1 else 0
    fun chain(side:BodySide)=leftChain.map {it+if(side==BodySide.RIGHT) 1 else 0}
}
val ExerciseKind.measurementJoint:BodyJoint get()=when(this) {
    ExerciseKind.ELBOW_FLEXION -> BodyJoint.ELBOW
    ExerciseKind.SHOULDER_ABDUCTION -> BodyJoint.SHOULDER
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
    val focusJoint: BodyJoint = kind.measurementJoint
) {
    init {
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
    val failureReasons: Map<RepFeedback,Int> = emptyMap()
) {
    val romDegrees: Double? get()=if(minimumDegrees!=null && maximumDegrees!=null) maximumDegrees-minimumDegrees else null
}
