package com.motivance.feature.rehabilitation

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.motivance.R
import com.motivance.data.local.SessionDatabase
import com.motivance.data.local.SessionStore
import com.motivance.data.remote.SupabaseAuthRepository
import com.motivance.designsystem.ToastTone
import com.motivance.designsystem.Toaster
import com.motivance.domain.BodySide
import com.motivance.domain.PrescriptionDraft
import java.io.IOException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** The real repository, view model and Room cache; only the HTTP responses are fixtures. */
@RunWith(AndroidJUnit4::class)
class AssignmentDeliveryTest {
    private val context:Context=ApplicationProvider.getApplicationContext()
    private val owner="patient-fixture"
    private lateinit var db:SessionDatabase
    private lateinit var store:SessionStore
    private val toasts=Toaster()
    @Volatile private var assignments=listOf<String>()
    @Volatile private var profilesFail=false
    @Volatile private var offline=false
    @Volatile private var publishFails=false
    @Volatile private var downloads=0

    private fun row(version:String)="""{"id":"assignment-$version","patient_id":"$owner","prescription_versions":[{"id":"$version","version":1,"side":"left","minimum_degrees":20,"maximum_degrees":90,"target_repetitions":5,"parameters":{},"exercise_version_id":"exercise","exercise_versions":{"id":"exercise","algorithm_key":"elbow-flexion-v1","definition":{"measurement_convention":"2d_flexion_degrees","instructions_en":"Fixture instruction"}}}]}"""
    private val client=OkHttpClient.Builder().addInterceptor {chain ->
        val request=chain.request();val path=request.url.encodedPath
        if(offline && path.startsWith("/rest/v1/exercise_assignments")) {downloads++;throw IOException("offline fixture")}
        var code=200
        val body=when {
            path.endsWith("user_roles") -> """[{"role":"patient"}]"""
            path.endsWith("publish_prescription") -> {if(publishFails) code=500;"\"version\""}
            path.endsWith("exercise_assignments") -> {
                if(request.url.queryParameter("select").orEmpty().contains("exercise_versions(")) downloads++
                assignments.joinToString(",","[","]")
            }
            path.endsWith("patient_profiles") -> {if(profilesFail) code=500;"[]"}
            path.startsWith("/rest/v1/") -> "[]"
            else -> """{"access_token":"a","refresh_token":"r","user":{"id":"$owner"}}"""
        }
        Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code).message("fixture").body(body.toResponseBody("application/json".toMediaType())).build()
    }.build()
    private lateinit var vm:RehabilitationViewModel

    @Before fun setup()=runBlocking {
        db=Room.inMemoryDatabaseBuilder(context,SessionDatabase::class.java).build();store=SessionStore(db)
        val repository=SupabaseAuthRepository(client,"https://fixture.invalid","public-fixture",false,store,null)
        repository.signIn("patient@example.test","fixture-password")
        vm=RehabilitationViewModel(repository,store,context,toasts)
    }
    @After fun cleanup() {db.close()}

    private suspend fun cached(count:Int)=withTimeout(10_000) {store.dao.prescriptions(owner).first {it.size==count}}
    private suspend fun idle() {delay(50);withTimeout(10_000) {vm.state.first {!it.busy}}}
    private suspend fun toast(message:Int)=withTimeout(10_000) {toasts.current.first {it?.message==message}}!!

    @Test fun exercisePublishedWhileThePatientStaysSignedInArrivesWithoutReopeningTheApp()=runBlocking {
        vm.configure(owner);idle();cached(0)
        assignments=listOf(row("version-1"))
        vm.syncAssignments()
        assertEquals("version-1",cached(1).single().versionId)
        assertEquals(ToastTone.INFO,toast(R.string.toast_new_assignment).tone)
        assertFalse(vm.state.value.busy)
    }
    @Test fun signingInDownloadsTheListWithoutAnnouncingItAsNew()=runBlocking {
        assignments=listOf(row("version-1"))
        vm.configure(owner);idle();cached(1)
        vm.syncAssignments();delay(300)
        assertNull(toasts.current.value)
    }
    @Test fun aFailureLaterInTheWorkspaceLoadCannotHoldBackTheExercise()=runBlocking {
        vm.configure(owner);idle()
        profilesFail=true;assignments=listOf(row("version-1"))
        vm.syncAssignments()
        cached(1);delay(300)
        assertFalse(vm.state.value.failed)
    }
    @Test fun anOfflineCheckKeepsDownloadedExercisesAndStaysQuiet()=runBlocking {
        assignments=listOf(row("version-1"))
        vm.configure(owner);idle();cached(1)
        offline=true;val before=downloads
        vm.syncAssignments()
        withTimeout(10_000) {while(downloads==before) delay(20)}
        delay(300)
        assertEquals(1,store.dao.prescriptions(owner).first().size)
        assertFalse(vm.state.value.failed);assertNull(toasts.current.value)
    }
    @Test fun endedAssignmentsLeaveTheList()=runBlocking {
        assignments=listOf(row("version-1"))
        vm.configure(owner);idle();cached(1)
        assignments=emptyList()
        vm.syncAssignments()
        cached(0);Unit
    }
    @Test fun aRefreshThePatientAskedForReportsItsResult()=runBlocking {
        vm.configure(owner);idle()
        assignments=listOf(row("version-1"))
        vm.refreshNow();idle()
        toast(R.string.toast_new_assignment)
        vm.refreshNow();idle()
        assertEquals(ToastTone.SUCCESS,toast(R.string.toast_workspace_updated).tone)
    }
    @Test fun publishingLeavesTheFormOnlyAfterTheServerAccepts()=runBlocking {
        vm.configure(owner);idle()
        var left=0
        val draft=PrescriptionDraft("assignment","version","patient","exercise",BodySide.LEFT,20.0,90.0,5)
        publishFails=true
        vm.prescribe(draft) {left++};idle()
        assertEquals(ToastTone.ERROR,toast(R.string.connected_failed).tone);assertEquals(0,left)
        publishFails=false
        vm.prescribe(draft) {left++};idle()
        toast(R.string.ui_prescription_published);assertEquals(1,left)
    }
}
