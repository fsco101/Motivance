package com.motivance.feature.admin

import com.motivance.domain.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.*
import org.junit.Assert.*

@OptIn(ExperimentalCoroutinesApi::class)
class AdministrationViewModelTest {
    private val dispatcher=StandardTestDispatcher()
    @Before fun setup() {Dispatchers.setMain(dispatcher)}
    @After fun cleanup() {Dispatchers.resetMain()}
    private class Remote:AdministrationRepository {
        var wait:CompletableDeferred<AdminWorkspace>?=null
        var failure=false
        val changed=mutableListOf<String>()
        var page=AdminWorkspace(accounts=listOf(AdminAccount("a","Fixture",true,setOf("patient"))),next="a")
        override suspend fun loadAdministration(after:String?):AdminWorkspace {
            if(failure) throw RemoteFailure(403)
            return wait?.let {withContext(NonCancellable) {it.await()}} ?: page
        }
        override suspend fun setAccount(user:String,active:Boolean) {changed+="account:$user:$active"}
        override suspend fun setRole(user:String,role:String,granted:Boolean) {changed+="role:$user:$role:$granted"}
        override suspend fun setLink(therapist:String,patient:String,active:Boolean) {changed+="link"}
        override suspend fun setExercise(exercise:String,active:Boolean) {changed+="exercise"}
        override suspend fun publishExercise(exercise:String,name:String,english:String,filipino:String) {changed+="publish"}
    }
    @Test fun lateDirectoryResponseCannotLeakAcrossAccounts()=runTest {
        val remote=Remote();val gate=CompletableDeferred<AdminWorkspace>();remote.wait=gate
        val vm=AdministrationViewModel(remote);vm.configure("admin-a");vm.refresh();runCurrent()
        vm.configure(null);gate.complete(remote.page);advanceUntilIdle()
        assertEquals("",vm.state.value.owner);assertTrue(vm.state.value.data.accounts.isEmpty())
    }
    @Test fun deniedRefreshClearsEarlierSensitiveRecordsAndCanRetry()=runTest {
        val remote=Remote();val vm=AdministrationViewModel(remote);vm.configure("admin");vm.refresh();advanceUntilIdle()
        assertEquals(1,vm.state.value.data.accounts.size)
        remote.failure=true;vm.refresh();advanceUntilIdle()
        assertTrue(vm.state.value.failed);assertTrue(vm.state.value.data.accounts.isEmpty())
        remote.failure=false;vm.refresh();advanceUntilIdle();assertFalse(vm.state.value.failed)
    }
    @Test fun mutationLoadingStaysVisibleUntilDirectoryRefreshCompletes()=runTest {
        val remote=Remote();val vm=AdministrationViewModel(remote);vm.configure("admin")
        val gate=CompletableDeferred<AdminWorkspace>();remote.wait=gate
        vm.account("patient",false);runCurrent()
        assertTrue(vm.state.value.busy)
        assertEquals(AdminAction.ACCOUNT,vm.state.value.activeAction)
        assertFalse(vm.state.value.updated)
        vm.account("patient",false)
        assertEquals(1,remote.changed.size)
        gate.complete(remote.page);advanceUntilIdle()
        assertFalse(vm.state.value.busy)
        assertNull(vm.state.value.activeAction)
        assertTrue(vm.state.value.updated)
    }
    @Test fun paginationDeduplicatesAndRepeatedClickWhileBusyDoesNotRepeatChange()=runTest {
        val remote=Remote();val vm=AdministrationViewModel(remote);vm.configure("admin");vm.refresh();advanceUntilIdle()
        remote.page=remote.page.copy(accounts=remote.page.accounts+AdminAccount("b","Other",true,emptySet()),next=null)
        vm.older();advanceUntilIdle();assertEquals(listOf("a","b"),vm.state.value.data.accounts.map {it.id})
        vm.account("b",false);vm.account("b",false);advanceUntilIdle()
        assertEquals(listOf("account:b:false"),remote.changed)
    }
}
