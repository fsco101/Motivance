package com.motivance.feature.colleagues

import com.motivance.R
import com.motivance.data.remote.ColleagueJson
import com.motivance.designsystem.Toaster
import com.motivance.domain.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*

/** #173: colleagues on Android: invite, accept, end, open a colleague's patient first, and the patient's own choice. */
@OptIn(ExperimentalCoroutinesApi::class)
class ColleagueViewModelTest {
    private val dispatcher=StandardTestDispatcher()
    @Before fun setup() {Dispatchers.setMain(dispatcher)}
    @After fun cleanup() {Dispatchers.resetMain()}

    private class Remote:ColleagueRepository {
        val calls=mutableListOf<String>()
        var refuse:String?=null
        var sharing=false
        private fun refused() {refuse?.let {throw RemoteFailure(400,it)}}
        override suspend fun loadColleagues():List<Colleague> {calls+="list"; return listOf(Colleague("l1",ColleagueState.REQUESTED,true,"t2","Omar"))}
        override suspend fun inviteColleague(email:String):Colleague {calls+="invite:$email"; refused(); return Colleague("l1",ColleagueState.REQUESTED,false,"t2","Omar")}
        override suspend fun respondColleague(id:String,accept:Boolean):Colleague {calls+="respond:$id:$accept"; return Colleague(id,ColleagueState.ACTIVE,true,"t2","Omar")}
        override suspend fun endColleague(id:String) {calls+="end:$id"}
        override suspend fun loadColleaguePatients()=listOf(ColleaguePatient("p1","Rosa",null,"t2","Omar"))
        override suspend fun openColleaguePatient(patientId:String):OpenedColleaguePatient {calls+="open:$patientId"; refused(); return OpenedColleaguePatient(patientId,"Rosa",null,listOf("Omar"))}
        override suspend fun loadColleaguePlan(patientId:String):List<ColleaguePlanItem> {calls+="plan:$patientId"; return listOf(ColleaguePlanItem("a1","Elbow flexion","left",20.0,90.0,8))}
        override suspend fun loadColleagueAccess(patientId:String)=ColleagueAccess(true,listOf(ColleagueViewer("t2","Omar",null,"2026-11-25T01:00:00Z")))
        override suspend fun loadColleagueSharing()=sharing
        override suspend fun setColleagueSharing(granted:Boolean):Boolean {calls+="sharing:$granted"; refused(); sharing=granted; return granted}
    }

    @Test fun invitingAcceptingAndEndingCallTheServerAndRefreshTheList()=runTest(dispatcher) {
        val remote=Remote(); val toasts=Toaster(); val vm=ColleagueViewModel(remote,toasts)
        vm.invite("omar@example.test"); advanceUntilIdle()
        assertEquals(R.string.colleagues_invited,toasts.current.value?.message)
        val colleague=vm.state.value.colleagues!!.single()
        vm.respond(colleague,true); advanceUntilIdle()
        vm.end(colleague); advanceUntilIdle()
        assertEquals(listOf("invite:omar@example.test","list","respond:l1:true","list","end:l1","list"),remote.calls)
        assertEquals("Rosa",vm.state.value.patients!!.single().name)
    }

    @Test fun eachRefusalHasItsOwnWords()=runTest(dispatcher) {
        val remote=Remote().apply {refuse="colleague_not_found"}; val toasts=Toaster(); val vm=ColleagueViewModel(remote,toasts)
        vm.invite("nobody@example.test"); advanceUntilIdle()
        assertEquals(R.string.colleagues_error_not_found,toasts.current.value?.message)
        assertEquals(R.string.colleagues_error_exists,colleagueRefusal(RemoteFailure(400,"colleague_exists")))
        assertEquals(R.string.colleagues_error_self,colleagueRefusal(RemoteFailure(400,"colleague_self")))
    }

    @Test fun aColleaguesPatientIsOpenedBeforeAnythingIsRead()=runTest(dispatcher) {
        val remote=Remote(); val vm=ColleagueViewModel(remote,Toaster())
        vm.open("p1"); advanceUntilIdle()
        assertEquals(listOf("open:p1","plan:p1"),remote.calls)
        val opened=vm.state.value.opened["p1"] as OpenedState.Open
        assertEquals("Elbow flexion",opened.plan!!.single().exercise)
    }

    @Test fun aPatientWhoCannotBeOpenedShowsAsUnavailableAndNothingElseIsRead()=runTest(dispatcher) {
        val remote=Remote().apply {refuse="colleague_unavailable"}; val vm=ColleagueViewModel(remote,Toaster())
        vm.open("p1"); advanceUntilIdle()
        assertEquals(OpenedState.Unavailable,vm.state.value.opened["p1"])
        assertEquals(listOf("open:p1"),remote.calls)
    }

    @Test fun thePatientsChoiceShowsAtOnceAndFallsBackIfRefused()=runTest(dispatcher) {
        val remote=Remote(); val vm=ColleagueViewModel(remote,Toaster())
        vm.loadSharing(); advanceUntilIdle()
        assertEquals(false,vm.state.value.sharing)
        vm.setSharing(true); assertEquals(true,vm.state.value.sharing); advanceUntilIdle()
        assertEquals(true,vm.state.value.sharing)
        remote.refuse="colleague_invalid"
        vm.setSharing(false); advanceUntilIdle()
        assertEquals(true,vm.state.value.sharing)
    }

    @Test fun readsTheServersJson() {
        val colleague=ColleagueJson.colleague(JSONObject("""{"id":"l1","state":"active","incoming":false,"other_id":"t2","other_name":"Omar","other_photo":null,"created_at":"2026-11-25T00:00:00Z","started_at":"2026-11-25T01:00:00Z"}"""))
        assertEquals(ColleagueState.ACTIVE,colleague.state); assertEquals("Omar",colleague.name); assertFalse(colleague.incoming)
        val opened=ColleagueJson.opened(JSONObject("""{"id":"p1","name":"Rosa","photo":null,"therapists":["Dana","Lea"]}"""))
        assertEquals(listOf("Dana","Lea"),opened.therapists)
        val plan=ColleagueJson.plan(JSONArray("""[{"id":"a1","prescription_versions":[{"version":1,"side":"left","minimum_degrees":20,"maximum_degrees":80,"target_repetitions":5,"exercise":{"definition":{"name":"Old"}}},
            {"version":2,"side":"right","minimum_degrees":20,"maximum_degrees":90,"target_repetitions":8,"exercise":{"definition":{"name":"Elbow flexion"}}}]},{"id":"a2","prescription_versions":[]}]"""))
        assertEquals(listOf(ColleaguePlanItem("a1","Elbow flexion","right",20.0,90.0,8)),plan)
        val access=ColleagueJson.access(JSONObject("""{"sharing":true,"colleagues":[{"id":"t2","name":"Omar","photo":null,"last_viewed_at":null}]}"""))
        assertTrue(access.sharing); assertNull(access.colleagues.single().lastViewedAt)
        val links=ColleagueJson.links(JSONArray("""[{"id":"l1","state":"requested","first_id":"t1","first_name":"Dana","second_id":"t2","second_name":"Omar"}]"""))
        assertEquals(ColleagueState.REQUESTED,links.single().state)
    }
}
