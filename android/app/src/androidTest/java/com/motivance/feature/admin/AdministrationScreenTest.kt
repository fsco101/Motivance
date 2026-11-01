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
    @Test fun accountChangeRequiresConfirmationAndRefreshesDirectory() {
        val remote=Remote();val vm=AdministrationViewModel(remote);vm.configure("admin")
        compose.setContent {MotivanceTheme {Surface {Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {AdministrationScreen(vm)}}}}
        compose.waitUntil(10_000) {vm.state.value.data.accounts.isNotEmpty()}
        compose.onNodeWithText(context.getString(R.string.admin_disable)).performScrollTo().performClick()
        assertEquals(0,remote.calls)
        compose.onNodeWithText(context.getString(R.string.cancel_action)).performClick()
        assertEquals(0,remote.calls)
        compose.onNodeWithText(context.getString(R.string.admin_disable)).performScrollTo().performClick()
        compose.onAllNodesWithText(context.getString(R.string.confirm_action)).filter(hasClickAction()).onFirst().performClick()
        compose.waitUntil(10_000) {remote.calls==1 && !vm.state.value.busy}
        compose.onNodeWithText(context.getString(R.string.admin_disabled)).assertExists()
    }
    private class Remote:AdministrationRepository {
        var calls=0
        override suspend fun loadAdministration(after:String?)=AdminWorkspace(accounts=listOf(AdminAccount("patient","Synthetic account",calls==0,setOf("patient"))))
        override suspend fun setAccount(user:String,active:Boolean) {calls++}
        override suspend fun setRole(user:String,role:String,granted:Boolean) { }
        override suspend fun setLink(therapist:String,patient:String,active:Boolean) { }
        override suspend fun setExercise(exercise:String,active:Boolean) { }
        override suspend fun publishExercise(exercise:String,name:String,english:String,filipino:String) { }
    }
}
