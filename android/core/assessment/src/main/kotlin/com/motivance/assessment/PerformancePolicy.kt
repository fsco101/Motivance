package com.motivance.assessment

/** What the camera screen does with one analysed frame. */
enum class FrameAction { PROCESS, DROP, PAUSE }

/** Engineering fallback only; no phone specification or clinical eligibility claim. */
object PerformancePolicy {
    /** A frame older than this is out of date by the time it reaches the screen. */
    const val STALE_FRAME_MS=1000L
    fun shouldPause(thermalStatus:Int)=thermalStatus>=3 // Android THERMAL_STATUS_SEVERE
    fun slow(snapshot:CameraDiagnostics.Snapshot)=snapshot.samples>=60 && snapshot.p95LatencyMs>250
    /**
     * Severe heat pauses measurement. A late frame is only skipped: recording carries on, and the engine's own rule for
     * a gap of more than a second between frames discards any repetition in progress.
     */
    fun frameAction(thermalStatus:Int,ageMs:Long)=when {
        shouldPause(thermalStatus) -> FrameAction.PAUSE
        ageMs>STALE_FRAME_MS -> FrameAction.DROP
        else -> FrameAction.PROCESS
    }
}
