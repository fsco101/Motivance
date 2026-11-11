package com.motivance.domain

/** What a set needs from its caller after a frame. */
sealed interface SetEvent {
    /** The target was reached while time remains: measuring carries on, and every extra repetition counts. */
    data object TargetReached:SetEvent
    /** This side is over and [next] follows. */
    data class SideEnded(val next:BodySide):SetEvent
    /** The last side is over. */
    data object SetComplete:SetEvent
}

/**
 * The sides of one prescription, in order, and when each one ends. A both-sides prescription runs LEFT then RIGHT.
 * A side with a time ends when the active measuring clock reaches it, even after the target. Untimed, the left side of a
 * both-sides set ends at the target, and every other side ends only when the patient presses Finish, as before.
 * The caller stops calling [evaluate] once a side has ended.
 */
object SideSet {
    const val MIN_SECONDS=15
    const val MAX_SECONDS=1800
    const val STEP_SECONDS=15
    const val DEFAULT_SECONDS=60
    const val COUNTDOWN_SECONDS=5
    /** Longest wait for the next-side announcement to finish before the countdown starts anyway. */
    const val ANNOUNCEMENT_LIMIT_MS=6000L

    fun sides(rules:ExerciseRules):List<BodySide> = if(rules.bilateral) listOf(BodySide.LEFT,BodySide.RIGHT) else listOf(rules.side)

    fun next(rules:ExerciseRules):BodySide? = sides(rules).let {it.getOrNull(it.indexOf(rules.side)+1)}

    /** Time left on this side, or null without a time. */
    fun remainingMs(rules:ExerciseRules,snapshot:AssessmentSnapshot):Long? =
        rules.sideSeconds?.let {(it*1000L-snapshot.durationMs).coerceAtLeast(0)}

    fun evaluate(rules:ExerciseRules,before:AssessmentSnapshot,after:AssessmentSnapshot):SetEvent? {
        if(!after.running) return null
        val next=next(rules)
        val limit=rules.sideSeconds
        // Level-triggered, so a side restored past its time still ends on its first frame.
        if(limit!=null && after.durationMs>=limit*1000L) return next?.let(SetEvent::SideEnded) ?: SetEvent.SetComplete
        if(before.completed<rules.targetRepetitions && after.completed>=rules.targetRepetitions) return when {
            limit!=null -> SetEvent.TargetReached
            next!=null -> SetEvent.SideEnded(next)
            else -> null
        }
        return null
    }
}
