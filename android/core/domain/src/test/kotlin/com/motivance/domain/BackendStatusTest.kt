package com.motivance.domain

import java.util.Locale
import org.junit.Assert.*
import org.junit.Test

class BackendStatusTest {
    @Test fun sizesUseBinaryUnitsLikeTheWebApp() {
        // Same cases as web/src/features/admin/backend.test.ts.
        assertEquals("0 B",formatBytes(0,Locale.US));assertEquals("512 B",formatBytes(512,Locale.US));assertEquals("1.5 KB",formatBytes(1536,Locale.US))
        assertEquals("500 MB",formatBytes(524_288_000,Locale.US));assertEquals("1 GB",formatBytes(1_073_741_824,Locale.US))
        assertEquals("12 MB",formatBytes(12_582_912,Locale.US));assertEquals("0 B",formatBytes(-5,Locale.US))
    }
    @Test fun metersWarnAtThreeQuartersAndNineTenths() {
        assertEquals(MeterLevel.OK,meterLevel(74,100));assertEquals(MeterLevel.HIGH,meterLevel(75,100))
        assertEquals(MeterLevel.FULL,meterLevel(90,100));assertEquals(MeterLevel.FULL,meterLevel(200,100));assertEquals(MeterLevel.OK,meterLevel(5,0))
    }
    @Test fun aJobFailsWhenItsLastRunOrAnyRunTodayFailed() {
        val job=BackendJob("x","* * * * *","succeeded",null,0)
        assertFalse(job.failing);assertTrue(job.copy(lastStatus="failed").failing);assertTrue(job.copy(failuresDay=2).failing);assertFalse(job.copy(lastStatus=null).failing)
    }
}
