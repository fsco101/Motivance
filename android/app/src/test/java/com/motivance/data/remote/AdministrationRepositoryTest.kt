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
    private fun account(i:Int)=JSONObject().put("id","%08d-0000-0000-0000-000000000000".format(i)).put("display_name",if(i==0) "" else "Person $i")
        .put("active",i!=1).put("email","p$i@example.test").put("created_at","2026-11-01T08:00:00+00:00")
        .put("last_sign_in_at",if(i==0) JSONObject.NULL else "2026-11-03T09:30:00.123456+00:00")
        .put("username",if(i==2) "person_two" else JSONObject.NULL).put("roles",JSONArray(if(i==2) listOf("patient","therapist") else listOf("patient")))
    private fun event(id:Long)=JSONObject().put("id",id).put("action","insert").put("target_type","therapist_patients").put("target_id","t:p")
        .put("recorded_at","2026-11-04T01:00:00+00:00").put("actor_id",if(id%2==0L) JSONObject.NULL else "actor").put("actor_name","Ada")
        .put("target_name","Thea").put("related_name","Pat")
    private fun repository():SupabaseAuthRepository {
        val client=OkHttpClient.Builder().addInterceptor {chain ->
            val request=chain.request();val path=request.url.encodedPath
            request.body?.let {val b=okio.Buffer();it.writeTo(b);val text=b.readUtf8();if(text.startsWith("{")) bodies.getOrPut(path) {mutableListOf()}+=JSONObject(text)}
            val body=when(path) {
                "/rest/v1/user_roles" -> """[{"role":"admin"}]"""
                "/rest/v1/rpc/admin_accounts" -> JSONArray((0..50).map {account(it)}).toString()
                "/rest/v1/rpc/admin_links" -> """[{"therapist_id":"t","patient_id":"p","active":true,"therapist_name":"Thea","patient_name":null}]"""
                "/rest/v1/exercises" -> """[{"id":"e","code":"elbow","active":true,"exercise_versions":[{"version":1,"algorithm_key":"elbow-flexion-v1","definition":{"name":"Old"}},{"version":2,"algorithm_key":"elbow-flexion-v1","definition":{"name":"Elbow","instructions_en":"Bend","instructions_fil":"Baluktot"}}]}]"""
                "/rest/v1/rpc/admin_summary" -> """{"accounts":51,"disabled":1,"patients":49,"therapists":1,"admins":1,"active_links":1,"unlinked_patients":48,"exercises":2,"active_exercises":1,"sessions_week":7,"pending_requests":2}"""
                "/rest/v1/rpc/admin_activity" -> JSONArray((31L downTo 1L).map {event(it)}).toString()
                else -> """{"access_token":"fixture-access","refresh_token":"fixture-refresh","user":{"id":"fixture-admin"}}"""
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("fixture").body(body.toResponseBody("application/json".toMediaType())).build()
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
        assertEquals(48,workspace.summary!!.unlinkedPatients);assertEquals(2,workspace.summary!!.pendingRequests)
        assertEquals(30,workspace.activity.size);assertEquals(2L,workspace.activityNext)
        assertTrue(workspace.activity.first { it.id==30L }.system);assertFalse(workspace.activity.first { it.id==31L }.system)
        assertEquals("maria",bodies.getValue("/rest/v1/rpc/admin_accounts").single().getString("p_search"))
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
