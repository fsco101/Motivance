package com.motivance.assessment

import com.motivance.domain.*

/**
 * The result of one attempt, read from two consecutive engine snapshots. The engine clears [AssessmentSnapshot.feedback]
 * on the next frame, so the screen and the voice keep this instead. Only active measurement produces results.
 */
sealed interface RepOutcome {
    /** A valid repetition; [count] is the new total. */
    data class Counted(val count:Int):RepOutcome
    /** An attempt that ended without counting, with the engine's reason. */
    data class Missed(val reason:RepFeedback):RepOutcome
    companion object {
        fun between(before:AssessmentSnapshot,after:AssessmentSnapshot):RepOutcome? = when {
            !after.running -> null
            after.completed>before.completed -> Counted(after.completed)
            after.incomplete>before.incomplete -> Missed(after.feedback)
            else -> null
        }
    }
}
