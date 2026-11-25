package com.motivance.feature.exercise

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Surface
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import com.motivance.R
import com.motivance.designsystem.MotivanceTheme
import com.motivance.domain.SharedVideo
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Sharing a session video asks first, says what happens, and can be undone (#129). */
class VideoShareControlsTest {
    @get:Rule val compose=createComposeRule()
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private val shared=SharedVideo("v1","s1","p1","t1",480,270,95_000,"m","p","2026-11-18T01:00:00Z","2026-12-03T01:00:00Z")

    @Test fun sharingAsksFirstAndExplainsWhatHappens() {
        var shares=0
        compose.setContent {MotivanceTheme {Surface {Column {VideoShareControls(null,false,null,onShare={shares+=1},onStop={})}}}}
        compose.onNodeWithText(context.getString(R.string.video_share)).performClick()
        compose.onNodeWithText(context.getString(R.string.video_share_detail)).assertIsDisplayed()
        assertEquals(0,shares)
        compose.onNodeWithText(context.getString(R.string.video_share_confirm)).performClick()
        assertEquals(1,shares)
    }

    /** While the smaller copy is made (#175), before it waits in the upload queue. */
    @Test fun whileSendingItShowsHowFar() {
        compose.setContent {MotivanceTheme {Surface {Column {VideoShareControls(null,true,.4f,onShare={},onStop={})}}}}
        compose.onNodeWithText(context.getString(R.string.video_preparing)).assertIsDisplayed()
        compose.onNodeWithText(context.getString(R.string.video_share)).assertDoesNotExist()
    }

    @Test fun aSharedVideoSaysUntilWhenAndCanBeStopped() {
        var stops=0
        compose.setContent {MotivanceTheme {Surface {Column {VideoShareControls(shared,false,null,onShare={},onStop={stops+=1})}}}}
        compose.onNodeWithText(context.getString(R.string.video_status_shared,sharedUntil(shared))).assertIsDisplayed()
        compose.onNodeWithText(context.getString(R.string.video_stop_sharing)).performClick()
        compose.onNodeWithText(context.getString(R.string.video_stop_detail)).assertIsDisplayed()
        compose.onAllNodesWithText(context.getString(R.string.video_stop_sharing)).filterToOne(hasAnyAncestor(isDialog())).performClick()
        assertEquals(1,stops)
    }
}
