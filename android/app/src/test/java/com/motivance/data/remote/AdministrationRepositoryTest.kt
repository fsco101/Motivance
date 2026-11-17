package com.motivance.data.remote

import kotlinx.coroutines.runBlocking
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AdministrationRepositoryTest {
    private val bodies=mutableMapOf<String,MutableList<JSONObject>>()
    private var backendStatus=200
    private val backend="""{"generated_at":"2026-11-17T06:00:00+00:00","plan":{"name":"Supabase Free","database_bytes":524288000,"storage_bytes":1073741824},
        "database":{"bytes":15000000,"tables":[{"name":"sessions","bytes":4000000}]},
        "storage":{"bytes":2048,"files":2,"buckets":[{"bucket":"avatars","files":2,"bytes":2048},{"bucket":"chat-media","files":0,"bytes":0}]},
        "deliveries":{"waiting":3,"oldest_waiting":null,"failed_week":1,"sent_day":12},"accounts":{"signed_in_week":5,"new_week":2,"devices":4},
        "activity":[{"day":"2026-11-16","sessions":3,"messages":7,"bookings":1,"accounts":0},{"day":"2026-11-17","sessions":1,"messages":0,"bookings":0,"accounts":2}],
        "jobs":[{"name":"notification-dispatch","schedule":"* * * * *","last_status":"failed","last_run":"2026-11-17T05:59:00+00:00","failures_day":4}]}"""
    private fun account(i:Int)=JSONObject().put("id","%08d-0000-0000-0000-000000000000".format(i)).put("display_name",if(i==0) "" else "Person $i")
        .put("active",i!=1).put("email","p$i@example.test").put("created_at","2026-11-01T08:00:00+00:00")
        .put("last_sign_in_at",if(i==0) JSONObject.NULL else "2026-11-03T09:30:00.123456+00:00")
        .put("username",if(i==2) "person_two" else JSONObject.NULL).put("roles",JSONArray(if(i==2) listOf("patient","therapist") else listOf("patient")))
    private fun event(id:Long)=JSONObject().put("id",id).put("action","insert").put("target_type","therapist_patients").put("target_id","t:p")
        .put("recorded_at","2026-11-04T01:00:00+00:00").put("actor_id",if(id%2==0L) JSONObject.NULL else "actor").put("actor_name","Ada")
        .put("target_name","Thea").put("related_name","Pat").put("actor_photo",if(id%2==0L) JSONObject.NULL else "00000000-0000-0000-0000-616461616461/61646161646161646161646161646161.webp")
    private fun repository():SupabaseAuthRepository {
        val client=OkHttpClient.Builder().addInterceptor {chain ->
            val request=chain.request();val path=request.url.encodedPath
            request.body?.let {val b=okio.Buffer();it.writeTo(b);val text=b.readUtf8();if(text.startsWith("{")) bodies.getOrPut(path) {mutableListOf()}+=JSONObject(text)}
            val body=when(path) {
                "/rest/v1/user_roles" -> """[{"role":"admin"}]"""
                "/rest/v1/rpc/admin_accounts" -> JSONArray((0..50).map {account(it)}).toString()
                "/rest/v1/rpc/admin_links" -> """[{"therapist_id":"t","patient_id":"p","active":true,"therapist_name":"Thea","patient_name":null,"therapist_photo":"00000000-0000-0000-0000-746865617468/74686561746865617468656174686561.webp","patient_photo":null}]"""
                "/rest/v1/exercises" -> """[{"id":"e","code":"elbow","active":true,"exercise_versions":[{"version":1,"algorithm_key":"elbow-flexion-v1","definition":{"name":"Old"}},{"version":2,"algorithm_key":"elbow-flexion-v1","definition":{"name":"Elbow","instructions_en":"Bend","instructions_fil":"Baluktot"}}]}]"""
                "/rest/v1/rpc/admin_summary" -> """{"accounts":51,"disabled":1,"patients":49,"therapists":1,"admins":1,"schedulers":4,"active_links":1,"unlinked_patients":48,"exercises":2,"active_exercises":1,"sessions_week":7,"pending_requests":2}"""
                "/rest/v1/rpc/admin_activity" -> JSONArray((31L downTo 1L).map {event(it)}).toString()
                "/rest/v1/rpc/admin_backend" -> if(backendStatus==200) backend else """{"message":"fixture failure"}"""
                else -> """{"access_token":"fixture-access","refresh_token":"fixture-refresh","user":{"id":"fixture-admin"}}"""
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(if(path=="/rest/v1/rpc/admin_backend") backendStatus else 200).message("fixture").body(body.toResponseBody("application/json".toMediaType())).build()
        }.build()
        return SupabaseAuthRepository(client,"https://fixture.invalid","public-fixture").also {runBlocking {it.signIn("fixture@example.test","fixture-password")}}
    }

    @Test fun workspaceParsesDirectoryLinksCatalogueSummaryAndActivity()=runBlocking {
        val workspace=repository().loadAdministration(null,"  maria ")
        assertEquals(50,workspace.accounts.size)
        assertEquals(workspace.accounts.last().id,workspace.next)
        val first=workspace.accounts[0]
        assertNull("JSON null must not become the text \"null\"",first.lastSignInAt)
        assertNull(first.username)
        assertEquals("p0@example.test",first.label)
        assertEquals("person_two",workspace.accounts[2].username)
        assertEquals("therapist",workspace.accounts[2].primaryRole)
        assertFalse(workspace.accounts[1].active)
        assertEquals("Thea",workspace.links.single().therapistName);assertEquals("",workspace.links.single().patientName)
        val exercise=workspace.exercises.single()
        assertEquals(2,exercise.version);assertEquals("Elbow",exercise.name);assertEquals("elbow-flexion-v1",exercise.algorithm)
        assertEquals(48,workspace.summary!!.unlinkedPatients);assertEquals(2,workspace.summary!!.pendingRequests);assertEquals(4,workspace.summary!!.schedulers)
        assertEquals(30,workspace.activity.size);assertEquals(2L,workspace.activityNext)
        assertTrue(workspace.activity.first { it.id==30L }.system);assertFalse(workspace.activity.first { it.id==31L }.system)
        assertEquals("maria",bodies.getValue("/rest/v1/rpc/admin_accounts").single().getString("p_search"))
    }

    @Test fun backendStatusIsReadWithTheWorkspace()=runBlocking {
        val status=repository().loadAdministration(null,null).backend!!
        assertEquals("Supabase Free",status.planName);assertEquals(524288000L,status.databaseLimit);assertEquals(1073741824L,status.storageLimit)
        assertEquals(15000000L,status.databaseBytes);assertEquals("sessions",status.tables.single().name)
        assertEquals(listOf("avatars","chat-media"),status.buckets.map {it.name});assertEquals(2L,status.buckets[0].files)
        assertEquals(3,status.waiting);assertNull("JSON null must not become the text \"null\"",status.oldestWaiting);assertEquals(1,status.failedWeek)
        assertEquals(5,status.signedInWeek);assertEquals(4,status.devices)
        assertEquals(listOf(3,1),status.activity.map {it.sessions});assertEquals(2,status.activity.last().accounts)
        assertTrue(status.jobs!!.single().failing)
    }
    @Test fun aFailedBackendStatusLeavesTheRestOfTheWorkspace()=runBlocking {
        backendStatus=500
        val workspace=repository().loadAdministration(null,null)
        assertNull(workspace.backend)
        assertEquals(50,workspace.accounts.size);assertNotNull(workspace.summary)
    }
    @Test fun linksAndActivityCarryTheFacesOfThePeopleTheyName()=runBlocking {
        val workspace=repository().loadAdministration(null,null)
        assertEquals("00000000-0000-0000-0000-746865617468/74686561746865617468656174686561.webp",workspace.links.single().therapistPhoto)
        assertNull("No photo stays none, not the text \"null\"",workspace.links.single().patientPhoto)
        assertEquals("00000000-0000-0000-0000-616461616461/61646161646161646161646161646161.webp",workspace.activity.first {it.id==31L}.actorPhoto)
        assertNull(workspace.activity.first {it.id==30L}.actorPhoto)
    }
    @Test fun blankSearchIsSentAsNullAndActivityUsesTheCursor()=runBlocking {
        val repo=repository()
        repo.loadAdministration("cursor","   ")
        val sent=bodies.getValue("/rest/v1/rpc/admin_accounts").single()
        assertTrue(sent.isNull("p_search"));assertEquals("cursor",sent.getString("p_after"))
        val page=repo.loadActivity(42)
        assertEquals(42L,bodies.getValue("/rest/v1/rpc/admin_activity").last().getLong("p_before"))
        assertEquals(30,page.events.size)
    }
}
