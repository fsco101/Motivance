package com.motivance.feature.admin

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import com.motivance.R
import com.motivance.domain.*
import com.motivance.designsystem.MotivanceTheme
import org.junit.*
import org.junit.Assert.*

class AdministrationScreenTest {
    @get:Rule val compose=createComposeRule()
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private fun show(vm:AdministrationViewModel) {
        compose.setContent {MotivanceTheme {Surface {Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {AdministrationScreen(vm)}}}}
    }
    @Test fun accountChangeRequiresConfirmationAndRefreshesDirectory() {
        val remote=Remote();val vm=AdministrationViewModel(remote);vm.configure("admin")
        show(vm)
        compose.waitUntil(10_000) {vm.state.value.data.accounts.isNotEmpty()}
        compose.onAllNodesWithText(context.getString(R.string.admin_accounts)).onFirst().performClick()
        compose.onNodeWithText("Synthetic account").performScrollTo().performClick()
        val disable=context.getString(R.string.admin_disable)
        compose.onNodeWithText(disable).performScrollTo().performClick()
        assertEquals(0,remote.calls)
        compose.onNodeWithText(context.getString(R.string.admin_confirm_disable,"Synthetic account")).assertExists()
        compose.onNodeWithText(context.getString(R.string.cancel_action)).performClick()
        assertEquals(0,remote.calls)
        compose.onNodeWithText(disable).performScrollTo().performClick()
        compose.onNode(hasText(disable) and hasClickAction() and hasAnyAncestor(isDialog())).performClick()
        compose.waitUntil(10_000) {remote.calls==1 && !vm.state.value.busy}
        compose.onNodeWithText(context.getString(R.string.admin_saved_account)).assertExists()
        compose.onNodeWithText(context.getString(R.string.admin_enable)).performScrollTo().assertExists()
    }
    @Test fun overviewSurfacesAttentionItemsAndOpensTheirSection() {
        val remote=Remote();val vm=AdministrationViewModel(remote);vm.configure("admin")
        show(vm)
        compose.waitUntil(10_000) {vm.state.value.data.summary!=null}
        compose.onNodeWithText(context.getString(R.string.admin_attention_unlinked)).performScrollTo().assertExists()
        compose.onNodeWithText(context.getString(R.string.admin_event_link_created)).performScrollTo().assertExists()
        compose.onNodeWithText(context.getString(R.string.admin_attention_unlinked)).performClick()
        compose.onNodeWithText(context.getString(R.string.admin_new_link)).assertExists()
    }
    @Test fun ownAccountShowsNoAccessControls() {
        val remote=Remote(self=true);val vm=AdministrationViewModel(remote);vm.configure("admin")
        show(vm)
        compose.waitUntil(10_000) {vm.state.value.data.accounts.isNotEmpty()}
        compose.onAllNodesWithText(context.getString(R.string.admin_accounts)).onFirst().performClick()
        compose.onNodeWithText("Synthetic account").performScrollTo().performClick()
        compose.onNodeWithText(context.getString(R.string.admin_self_notice)).assertExists()
        compose.onNodeWithText(context.getString(R.string.admin_disable)).assertDoesNotExist()
    }
    private class Remote(val self:Boolean=false):AdministrationRepository {
        var calls=0
        override suspend fun loadAdministration(after:String?,search:String?)=AdminWorkspace(
            accounts=listOf(AdminAccount(if(self) "admin" else "patient","Synthetic account",calls==0,setOf("patient"),email="synthetic@example.test")),
            summary=AdminSummary(accounts=1,patients=1,unlinkedPatients=1,exercises=1,activeExercises=1),
            activity=listOf(AuditEvent(1,"insert","therapist_patients","t:p","2026-11-04T01:00:00+00:00",actorId="admin",actorName="Ada",targetName="Thea",relatedName="Pat")))
        override suspend fun loadActivity(before:Long)=AuditPage()
        override suspend fun setAccount(user:String,active:Boolean) {calls++}
        override suspend fun setRole(user:String,role:String,granted:Boolean) { }
        override suspend fun setLink(therapist:String,patient:String,active:Boolean) { }
        override suspend fun setExercise(exercise:String,active:Boolean) { }
        override suspend fun publishExercise(exercise:String,name:String,english:String,filipino:String) { }
        override suspend fun clearPhoto(user:String) { }
    }
}
