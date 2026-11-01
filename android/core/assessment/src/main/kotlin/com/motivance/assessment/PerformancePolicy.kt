package com.motivance.assessment

/** Engineering fallback only; no phone specification or clinical eligibility claim. */
object PerformancePolicy {
    fun shouldPause(thermalStatus:Int)=thermalStatus>=3 // Android THERMAL_STATUS_SEVERE
    fun slow(snapshot:CameraDiagnostics.Snapshot)=snapshot.samples>=60 && snapshot.p95LatencyMs>250
}
