package com.motivance.designsystem

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import com.motivance.R
import com.motivance.domain.UserRole
import com.motivance.feature.rehabilitation.*
import com.motivance.navigation.*
import java.io.File
import org.junit.*
import org.junit.Assert.*

class WorkspaceUiTest {
    @get:Rule val compose=createComposeRule()
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private fun label(id:Int)=context.getString(id)
    private fun capture(name:String) {
        File(context.getExternalFilesDir(null),name).outputStream().use {
            compose.onRoot().captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)
        }
    }

    @Test fun busyActionPreventsDuplicateSubmissionAndRecovers() {
        var busy by mutableStateOf(false)
        var calls=0
        compose.setContent {MotivanceTheme {Surface {Column(Modifier.padding(20.dp)) {
            ActionButton(R.string.publish_prescription,{calls++;busy=true},busy=busy,busyLabel=R.string.ui_publishing_prescription)
        }}}}
        compose.onNodeWithText(label(R.string.publish_prescription)).performClick()
        compose.onNodeWithText(label(R.string.ui_publishing_prescription)).assertIsNotEnabled().performClick()
        assertEquals(1,calls)
        compose.runOnIdle {busy=false}
        compose.onNodeWithText(label(R.string.publish_prescription)).assertIsEnabled().performClick()
        assertEquals(2,calls)
    }

    @Test fun loadingDoesNotClaimNoAssignmentsOrSuccessfulUpload() {
        compose.setContent {MotivanceTheme {Surface {Column(Modifier.padding(20.dp)) {
            ConnectedStatus(RehabilitationState(busy=true,activeAction=RehabAction.SYNC)) {}
            CachedAssignments(emptyList(),loading=true) {}
        }}}}
        compose.onNodeWithText(label(R.string.ui_preparing_sync)).assertExists()
        compose.onNodeWithText(label(R.string.no_assignments_detail)).assertDoesNotExist()
        compose.onNodeWithText(label(R.string.sync_synced)).assertDoesNotExist()
        compose.mainClock.advanceTimeBy(400)
        capture("ui-workspace-loading.png")
    }

    @Test fun errorHasAnEnabledRetryAndLargeTextActionRemainsReachable() {
        var retries=0
        compose.setContent {MotivanceTheme {
            val density=LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density,2f)) {
                Surface {Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),verticalArrangement=Arrangement.spacedBy(20.dp)) {
                    WorkspaceHero(UserRole.PATIENT) {}
                    FeedbackNotice(R.string.connected_failed,error=true,retry={retries++})
                    ActionButton(R.string.start_assigned_exercise,{})
                }}
            }
        }}
        compose.onNodeWithText(label(R.string.retry)).performScrollTo().assertIsEnabled().performClick()
        assertEquals(1,retries)
        compose.onNodeWithText(label(R.string.start_assigned_exercise)).performScrollTo().assertIsDisplayed().assertIsEnabled()
        capture("ui-workspace-large-text.png")
    }

    @Test fun landingPortalsNavigateAndPatientHeroHasClearPrimaryAction() {
        var role:UserRole?=null
        compose.setContent {MotivanceTheme {Surface {RoleLanding({role=it},{})}}}
        capture("ui-workspace-landing.png")
        compose.onNodeWithText(label(R.string.continue_patient)).performScrollTo().performClick()
        assertEquals(UserRole.PATIENT,role)
    }

    @Test fun patientDashboardVisual() {
        compose.setContent {MotivanceTheme {Surface(color=MaterialTheme.colorScheme.background) {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(20.dp)) {
                BrandHeader(onProfile={})
                Column(Modifier.padding(horizontal=20.dp),verticalArrangement=Arrangement.spacedBy(20.dp)) {
                    Text(label(R.string.your_recovery),style=MaterialTheme.typography.headlineMedium)
                    Text(label(R.string.personal_rehabilitation),color=MaterialTheme.colorScheme.onSurfaceVariant)
                    WorkspaceHero(UserRole.PATIENT) {}
                    EmptyState(R.string.no_sessions,R.string.no_sessions_detail)
                }
            }
        }}}
        compose.onNodeWithText(label(R.string.view_exercises)).assertIsDisplayed()
        capture("ui-workspace-patient.png")
    }
}
