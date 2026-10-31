import com.motivance.assessment.CameraDiagnostics
import org.junit.Assert.*
import org.junit.Test

class CameraDiagnosticsTest {
    @Test fun computesRateAndBoundedPercentile() {
        val meter=CameraDiagnostics(3)
        meter.record(100,10); meter.record(200,20); meter.record(300,30)
        val result=meter.record(400,40)
        assertEquals(3,result.samples); assertEquals(10.0,result.fps,.001)
        assertEquals(40L,result.p95LatencyMs)
    }
    @Test fun singleFrameHasNoInventedRate() {
        assertEquals(0.0,CameraDiagnostics().record(100,10).fps,.001)
    }
    @Test(expected=IllegalArgumentException::class) fun rejectsStaleTimestamp() {
        val meter=CameraDiagnostics(); meter.record(100,10); meter.record(100,10)
    }
}
