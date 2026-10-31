package com.motivance.assessment

/** Bounded, nonclinical rolling diagnostics. Does not retain landmarks or images. */
class CameraDiagnostics(private val capacity: Int = 300) {
    init { require(capacity >= 2) }
    private val samples = ArrayDeque<Pair<Long, Long>>()
    data class Snapshot(val samples: Int, val fps: Double, val p95LatencyMs: Long)
    fun record(timestampMs: Long, latencyMs: Long): Snapshot {
        require(timestampMs >= 0 && latencyMs >= 0)
        require(samples.isEmpty() || timestampMs > samples.last().first)
        samples.addLast(timestampMs to latencyMs)
        if (samples.size > capacity) samples.removeFirst()
        val elapsed = samples.last().first - samples.first().first
        val fps = if (elapsed > 0) (samples.size - 1) * 1000.0 / elapsed else 0.0
        val latencies = samples.map { it.second }.sorted()
        val index = kotlin.math.ceil(latencies.size * .95).toInt() - 1
        return Snapshot(samples.size, fps, latencies[index])
    }
}
