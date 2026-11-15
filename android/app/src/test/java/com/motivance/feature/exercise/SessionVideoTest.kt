package com.motivance.feature.exercise

import org.junit.Assert.*
import org.junit.Test

class SessionVideoTest {
    @Test fun aRecordingKeepsTheFrameSizeInEvenPixelsAndNoLargerThan1280() {
        assertEquals(480 to 640,videoSize(480,640))
        assertEquals(478 to 640,videoSize(479,641))
        assertEquals(720 to 1280,videoSize(1080,1920))
        assertEquals(2 to 2,videoSize(1,1))
    }

    @Test fun theBitrateStaysBetweenOneAndFourMegabits() {
        assertEquals(1_000_000,videoBitrate(160,120))
        assertEquals(1_000_000,videoBitrate(480,640))
        assertEquals(2_764_800,videoBitrate(720,1280))
        assertEquals(4_000_000,videoBitrate(1920,1080))
    }

    @Test fun aGalleryNameSaysWhatAndWhen() {
        assertTrue(videoName(0).matches(Regex("""Motivance-session-\d{8}-\d{6}\.mp4""")))
    }

    @Test fun theListOfVideosReadsBackAndSurvivesBadData() {
        val videos=listOf(SessionVideo("content://media/external/video/media/7",listOf("s1","s2"),1_700_000_000_000))
        assertEquals(videos,SessionVideoJson.read(SessionVideoJson.write(videos)))
        assertEquals(emptyList<SessionVideo>(),SessionVideoJson.read(null))
        assertEquals(emptyList<SessionVideo>(),SessionVideoJson.read("not json"))
    }
}
