package com.motivance.feature.rehabilitation

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import com.motivance.R
import com.motivance.designsystem.MotivanceTheme
import com.motivance.domain.*
import java.io.File
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class ResultsDashboardTest {
    @get:Rule val compose = createComposeRule()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val owner = "10000000-0000-0000-0000-000000000001"
    private val p = HistoricalPrescription("10000000-0000-0000-0000-000000000011", "assignment", 1,
        "21000000-0000-0000-0000-000000000001", "Elbow flexion", "elbow-flexion-v1", "left", 20.0, 90.0, 5)
    private val m = HistoricalMeasurement("elbow-flexion-v1", "left", 10.0, 100.0, 5, 0, "valid", 40, 2)
    private fun row(id: String = "one") = HistoricalSession(id, owner, "2026-01-01T10:00:00Z", "2026-01-01T10:01:00Z",
        "completed", "model-v1", "elbow-flexion-v1", p, listOf(m))
    private fun text(id: Int, vararg args: Any) = context.getString(id, *args)

    private fun display(rows: List<HistoricalSession>): HistoryViewModel {
        val vm = HistoryViewModel(FixtureRepository(rows))
        vm.configure(owner)
        compose.setContent {
            MotivanceTheme { Surface {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    ResultsDashboard(RehabWorkspace(), owner, owner, vm)
                }
            } }
        }
        compose.waitUntil(10_000) { vm.state.value.loaded }
        return vm
    }

    @Test fun chartsSeparatePrescriptionVersionsAndRenderRecordedTargets() {
        display(listOf(row(), row("two").copy(startedAt = "2026-01-02T10:00:00Z", measurements = listOf(m.copy(maximum = 110.0))),
            row("three").copy(prescription = p.copy(id = "new-version", version = 2, high = 120.0))))
        compose.onAllNodesWithText(text(R.string.rom_progression)).assertCountEquals(2)
        compose.onAllNodesWithText(text(R.string.history_targets, "20.0", "90.0", 5)).assertCountEquals(3)
        compose.onAllNodesWithText(text(R.string.history_targets, "20.0", "120.0", 5)).assertCountEquals(2)
        compose.onAllNodesWithText(text(R.string.history_chart_order))[1].performScrollTo()
        val output = File(context.getExternalFilesDir(null), "sprint-04-history-chart.png")
        output.outputStream().use { compose.onRoot().captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        assertTrue(output.length() > 0)
    }

    @Test fun emptyPartialInterruptedAndInvalidResultsHaveReadableLabels() {
        display(listOf(row().copy(measurements = emptyList()), row("partial").copy(measurements = listOf(m.copy(repetitions = 2))),
            row("interrupted").copy(status = "interrupted"), row("invalid").copy(measurements = listOf(m.copy(quality = "invalid")))))
        listOf(R.string.history_no_measurements, R.string.history_partial, R.string.history_interrupted, R.string.history_invalid).forEach {
            compose.onNodeWithText(text(it)).assertExists()
        }
    }

    @Test fun invalidDatesHidePriorResultsAndShowAnActionableError() {
        display(listOf(row()))
        compose.onNodeWithText(text(R.string.history_from)).performTextInput("2026-02-30")
        compose.onNodeWithText(text(R.string.history_date_error)).assertExists()
        compose.onNodeWithText(text(R.string.history_completed)).assertDoesNotExist()
    }

    private class FixtureRepository(private val rows: List<HistoricalSession>) : RehabilitationRepository {
        override suspend fun loadHistory(query: HistoryQuery, cursor: HistoryCursor?) = HistoryPage(rows, null)
        override suspend fun loadWorkspace() = RehabWorkspace()
        override suspend fun invitePatient(email: String) = error("unused")
        override suspend fun acceptInvitation(code: String) = error("unused")
        override suspend fun revokeLink(patientId: String) = error("unused")
        override suspend fun publishPrescription(draft: PrescriptionDraft) = error("unused")
        override suspend fun requestPatientData(id: String, kind: String) = error("unused")
        override suspend fun uploadConsent(owner: String, id: String, event: String, version: String, occurredAt: Long) = error("unused")
        override suspend fun uploadSession(owner: String, payload: String) = error("unused")
    }
}
