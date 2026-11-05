package com.motivance.designsystem

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.motivance.R
import com.motivance.domain.BodyJoint
import com.motivance.domain.ExerciseKind
import com.motivance.domain.ExerciseRules

internal fun BodyJoint.label()=when(this) {
    BodyJoint.SHOULDER -> R.string.skeleton_shoulder
    BodyJoint.ELBOW -> R.string.skeleton_elbow
    BodyJoint.WRIST -> R.string.skeleton_wrist
    BodyJoint.HIP -> R.string.skeleton_hip
    BodyJoint.KNEE -> R.string.skeleton_knee
    BodyJoint.ANKLE -> R.string.skeleton_ankle
}

/** Where this joint's measurement starts, so a therapist can choose sensible target angles. */
internal fun BodyJoint.zeroHint()=when(this) {
    BodyJoint.SHOULDER -> R.string.custom_zero_side
    BodyJoint.ANKLE -> R.string.custom_zero_ankle
    else -> R.string.custom_zero_straight
}

@Composable internal fun ExerciseRules.displayName():String=when(kind) {
    ExerciseKind.ELBOW_FLEXION -> stringResource(R.string.elbow_flexion)
    ExerciseKind.SHOULDER_ABDUCTION -> stringResource(R.string.shoulder_abduction)
    ExerciseKind.CUSTOM -> exerciseName.orEmpty()
}
