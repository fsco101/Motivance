import com.motivance.assessment.*
import org.junit.Assert.*
import org.junit.Test

class PerformancePolicyTest {
    @Test fun missingThermalSupportNeverBecomesADeviceRejection() {
        assertFalse(PerformancePolicy.shouldPause(-1))
        assertFalse(PerformancePolicy.shouldPause(0))
        assertFalse(PerformancePolicy.shouldPause(2))
        assertTrue(PerformancePolicy.shouldPause(3))
        assertTrue(PerformancePolicy.shouldPause(6))
    }
    @Test fun diagnosticsAreBoundedOverThirtyMinutesOfSyntheticFrames() {
        val meter=CameraDiagnostics()
        var result=CameraDiagnostics.Snapshot(0,0.0,0)
        repeat(54_000) {result=meter.record(it*33L,20)}
        assertEquals(300,result.samples)
        assertEquals(1000.0/33,result.fps,.01)
        assertFalse(PerformancePolicy.slow(result))
        repeat(300) {result=meter.record((54_000+it)*33L,300)}
        assertTrue(PerformancePolicy.slow(result))
    }
}
