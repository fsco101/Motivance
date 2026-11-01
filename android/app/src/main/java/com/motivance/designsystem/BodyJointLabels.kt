package com.motivance.designsystem

import com.motivance.R
import com.motivance.domain.BodyJoint

internal fun BodyJoint.label()=when(this) {
    BodyJoint.SHOULDER -> R.string.skeleton_shoulder
    BodyJoint.ELBOW -> R.string.skeleton_elbow
    BodyJoint.WRIST -> R.string.skeleton_wrist
    BodyJoint.HIP -> R.string.skeleton_hip
    BodyJoint.KNEE -> R.string.skeleton_knee
    BodyJoint.ANKLE -> R.string.skeleton_ankle
}
