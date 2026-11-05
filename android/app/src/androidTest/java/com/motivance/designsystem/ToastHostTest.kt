package com.motivance.designsystem

import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import com.motivance.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test

class ToastHostTest {
    @get:Rule val compose=createComposeRule()
    private fun label(id:Int)=InstrumentationRegistry.getInstrumentation().targetContext.getString(id)
    private fun host(toaster:Toaster) {
        compose.mainClock.autoAdvance=false
        compose.setContent {MotivanceTheme {ToastHost(toaster)}}
        compose.mainClock.advanceTimeBy(100)
    }

    @Test fun aToastStaysForFiveSecondsThenDisappears() {
        val toaster=Toaster()
        host(toaster)
        toaster.show(R.string.toast_signed_in)
        compose.mainClock.advanceTimeBy(1_000)
        compose.onNodeWithText(label(R.string.toast_signed_in)).assertIsDisplayed()
        compose.mainClock.advanceTimeBy(3_700)
        compose.onNodeWithText(label(R.string.toast_signed_in)).assertIsDisplayed()
        compose.mainClock.advanceTimeBy(1_000)
        compose.onNodeWithText(label(R.string.toast_signed_in)).assertDoesNotExist()
    }

    @Test fun aNewerToastReplacesTheOldOneAndGetsItsOwnFiveSeconds() {
        val toaster=Toaster()
        host(toaster)
        toaster.show(R.string.toast_saving,ToastTone.PENDING)
        compose.mainClock.advanceTimeBy(3_000)
        toaster.show(R.string.ui_changes_saved)
        compose.mainClock.advanceTimeBy(1_000)
        compose.onNodeWithText(label(R.string.toast_saving)).assertDoesNotExist()
        // Past the first toast's expiry: its timer must not take the replacement with it.
        compose.mainClock.advanceTimeBy(3_000)
        compose.onNodeWithText(label(R.string.ui_changes_saved)).assertIsDisplayed()
        compose.mainClock.advanceTimeBy(2_000)
        compose.onNodeWithText(label(R.string.ui_changes_saved)).assertDoesNotExist()
    }

    @Test fun theCloseButtonRemovesTheToastAtOnce() {
        val toaster=Toaster()
        host(toaster)
        toaster.show(R.string.toast_signed_in)
        compose.mainClock.advanceTimeBy(1_000)
        compose.onNodeWithContentDescription(label(R.string.toast_close)).assertHasClickAction().performClick()
        compose.mainClock.advanceTimeBy(400)
        compose.onNodeWithText(label(R.string.toast_signed_in)).assertDoesNotExist()
        assertNull(toaster.current.value)
    }

    @Test fun closingOneToastLeavesTheNextOneItsFullTime() {
        val toaster=Toaster()
        host(toaster)
        toaster.show(R.string.toast_saving,ToastTone.PENDING)
        compose.mainClock.advanceTimeBy(1_000)
        compose.onNodeWithContentDescription(label(R.string.toast_close)).performClick()
        compose.mainClock.advanceTimeBy(400)
        toaster.show(R.string.ui_changes_saved)
        compose.mainClock.advanceTimeBy(4_500)
        compose.onNodeWithText(label(R.string.ui_changes_saved)).assertIsDisplayed()
    }

    @Test fun theBarShowsTheTimeLeft() {
        val toaster=Toaster()
        host(toaster)
        toaster.show(R.string.toast_signed_in)
        fun filled():Float {
            val pixels=compose.onNodeWithTag("toast-time").captureToImage().toPixelMap()
            val row=pixels.height/2
            return (0 until pixels.width).count {pixels[it,row].green>.5f}/pixels.width.toFloat()
        }
        compose.mainClock.advanceTimeBy(1_000)
        assertEquals(.8f,filled(),.06f)
        compose.mainClock.advanceTimeBy(1_500)
        assertEquals(.5f,filled(),.06f)
        compose.mainClock.advanceTimeBy(2_000)
        assertEquals(.1f,filled(),.06f)
    }

    @Test fun everyToneIsDrawn() {
        val toaster=Toaster()
        host(toaster)
        listOf(ToastTone.SUCCESS,ToastTone.PENDING,ToastTone.INFO,ToastTone.ERROR).forEach {tone ->
            toaster.show(R.string.toast_code_sent,tone)
            compose.mainClock.advanceTimeBy(500)
            compose.onNodeWithTag("toast").assertIsDisplayed()
        }
    }
}
