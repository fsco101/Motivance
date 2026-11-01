package com.motivance.feature.exercise

import android.Manifest
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.Lifecycle
import androidx.test.platform.app.InstrumentationRegistry
import com.motivance.MainActivity
import com.motivance.R
import org.junit.*

/** Native camera/model smoke test; the emulator room is not an accuracy fixture. */
class CameraLifecycleTest {
    @get:Rule val compose=createAndroidComposeRule<MainActivity>()
    @Test fun nativeCameraRebindsAfterBackgroundWithoutStartingARecording() {
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        instrumentation.uiAutomation.grantRuntimePermission(instrumentation.targetContext.packageName,Manifest.permission.CAMERA)
        val context=instrumentation.targetContext
        compose.onNodeWithText(context.getString(R.string.try_camera)).performScrollTo().performClick()
        compose.onNodeWithText(context.getString(R.string.start_camera_check)).performScrollTo().performClick()
        fun waitForInference() {
            compose.waitUntil(30_000) {compose.onAllNodesWithText("Inference:",substring=true).fetchSemanticsNodes().isNotEmpty()}
        }
        waitForInference()
        compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        compose.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        waitForInference()
        compose.onNodeWithText(context.getString(R.string.start_measurement)).performScrollTo().assertIsNotEnabled()
        compose.onNodeWithText(context.getString(R.string.finish_camera)).performScrollTo().performClick()
        compose.onNodeWithText(context.getString(R.string.no_clinical_record)).assertExists()
    }
}
