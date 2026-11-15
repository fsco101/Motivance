package com.motivance.data.remote

import com.motivance.domain.*
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test

/**
 * The real repository and the real websocket client against the local Supabase stack: two linked people and an outsider,
 * with Realtime deciding row by row who hears what. It runs only when the stack's keys are given, so an ordinary build skips it:
 *
 *     MOTIVANCE_STACK_ANON=... MOTIVANCE_STACK_SERVICE=... gradlew :app:testDebugUnitTest --tests "*LiveChatStackTest*"
 *
 * The keys come from `npx supabase status -o json`. Accounts are synthetic and removed afterwards through the local database container.
 */
class LiveChatStackTest {
    private val url="http://127.0.0.1:54321"
    private val anon=System.getenv("MOTIVANCE_STACK_ANON").orEmpty()
    private val service=System.getenv("MOTIVANCE_STACK_SERVICE").orEmpty()
    private val http=OkHttpClient.Builder().readTimeout(30,TimeUnit.SECONDS).build()
    private val people=mutableListOf<Pair<String,String>>()

    @Before fun stack() {assumeTrue("Local stack keys not given",anon.isNotBlank() && service.isNotBlank())}

    @After fun cleanUp() {
        if(people.isEmpty()) return
        val ids=people.joinToString(",") {"'${it.first}'"}
        val sql="""begin; set local session_replication_role=replica;
delete from public.notification_deliveries where notification_id in (select id from public.notifications where user_id in ($ids) or subject_id in ($ids));
delete from public.notifications where user_id in ($ids) or subject_id in ($ids);
delete from public.patient_invitations where therapist_id in ($ids);
insert into public.chat_media_trash(path) select unnest(array[a.media_path,a.preview_path]) from public.chat_attachments a join public.conversations c on c.id=a.conversation_id where (c.therapist_id in ($ids) or c.patient_id in ($ids)) and a.removed_at is null on conflict do nothing;
delete from public.chat_attachments where conversation_id in (select id from public.conversations where therapist_id in ($ids) or patient_id in ($ids));
delete from public.chat_reads where user_id in ($ids) or conversation_id in (select id from public.conversations where therapist_id in ($ids) or patient_id in ($ids));
delete from public.chat_messages where conversation_id in (select id from public.conversations where therapist_id in ($ids) or patient_id in ($ids));
delete from public.conversations where therapist_id in ($ids) or patient_id in ($ids);
delete from public.therapist_patients where therapist_id in ($ids) or patient_id in ($ids);
delete from public.audit_events where actor_id in ($ids) or target_id in ($ids);
delete from public.patient_profiles where user_id in ($ids); delete from public.patients where id in ($ids); delete from public.user_roles where user_id in ($ids);
delete from public.notification_settings where user_id in ($ids);
delete from public.profiles where id in ($ids); delete from auth.users where id in ($ids); commit;"""
        val process=ProcessBuilder("docker","exec","-i","supabase_db_motivance","psql","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1").redirectErrorStream(true).start()
        process.outputStream.use {it.write(sql.toByteArray())}
        val output=process.inputStream.bufferedReader().readText()
        check(process.waitFor(60,TimeUnit.SECONDS) && process.exitValue()==0) {output}
    }

    private fun admin(method:String,path:String,body:Any?=null):String {
        val request=Request.Builder().url(url+path).header("apikey",service).header("Authorization","Bearer $service").header("Prefer","return=minimal")
            .method(method,body?.toString()?.toRequestBody("application/json".toMediaType())).build()
        return http.newCall(request).execute().use {check(it.isSuccessful) {"$path ${it.code} ${it.body?.string()}"}; it.body?.string().orEmpty()}
    }

    private fun person(role:String,name:String):Pair<String,String> {
        val email="motivance-android-${UUID.randomUUID()}@example.test"
        val id=JSONObject(admin("POST","/auth/v1/admin/users",JSONObject().put("email",email).put("password",PASSWORD).put("email_confirm",true))).getString("id")
        people+=id to email
        admin("DELETE","/rest/v1/user_roles?user_id=eq.$id")
        admin("POST","/rest/v1/user_roles",JSONObject().put("user_id",id).put("role",role))
        admin("PATCH","/rest/v1/profiles?id=eq.$id",JSONObject().put("display_name",name))
        return id to email
    }

    private suspend fun signedIn(who:Pair<String,String>)=SupabaseAuthRepository(http,url,anon,true).also {it.signIn(who.second,PASSWORD)}

    /** Collects one account's live events until the test ends, and waits for what it needs. */
    private class Listener(scope:CoroutineScope,repository:SupabaseAuthRepository) {
        val events=MutableStateFlow<List<LiveEvent>>(emptyList())
        val job=scope.launch(Dispatchers.IO) {LiveChat(OkHttpClient(),{repository.liveAccess()}).events().collect {event -> events.update {it+event}}}
        suspend fun until(what:String,check:(List<LiveEvent>)->Boolean)=withTimeoutOrNull(15_000) {events.first(check)} ?: throw AssertionError("Timed out waiting for $what: ${events.value}")
        val live get()=events.value.filterIsInstance<LiveEvent.Connection>().lastOrNull()?.live==true
    }

    @Test fun messagesReadMarksAndDeletionsArriveLiveOnlyForTheTwoPeople() = runBlocking {
        val therapistAccount=person("therapist","Android Therapist")
        val patientAccount=person("patient","Android Patient")
        val outsiderAccount=person("therapist","Android Outsider")
        val therapist=signedIn(therapistAccount)
        val patient=signedIn(patientAccount)
        val outsider=signedIn(outsiderAccount)
        patient.acceptInvitation(therapist.invitePatient(patientAccount.second))

        val conversation=therapist.loadConversations().single()
        assertEquals(patientAccount.first,conversation.otherId)
        assertEquals("Android Patient",conversation.otherName)
        assertEquals(conversation.id,patient.loadConversations().single().id)
        assertTrue(outsider.loadConversations().isEmpty())
        // Nobody writes until the patient turns messages on, and only the patient can.
        assertFalse(conversation.open)
        assertFalse(conversation.consented)
        assertEquals("chat_consent_required",(runCatching {therapist.sendMessage(UUID.randomUUID().toString(),conversation.id,"Hello")}.exceptionOrNull() as RemoteFailure).code)
        assertEquals(403,(runCatching {therapist.setChatConsent(true)}.exceptionOrNull() as RemoteFailure).status)
        assertEquals(ChatConsent("care-chat-v2",false,null,false,null),patient.loadChatConsent())
        assertTrue(patient.setChatConsent(true).granted)
        assertTrue(therapist.loadConversations().single().let {it.open && it.consented})

        coroutineScope {
            val patientLive=Listener(this,patient)
            val therapistLive=Listener(this,therapist)
            val outsiderLive=Listener(this,outsider)
            listOf(patientLive,therapistLive,outsiderLive).forEach {it.until("the live connection") {_ -> it.live}}

            val id=UUID.randomUUID().toString()
            val sent=therapist.sendMessage(id,conversation.id,"Try ten repetitions tonight.")
            assertEquals(sent,therapist.sendMessage(id,conversation.id,"Try ten repetitions tonight."))
            val heard=patientLive.until("the live message") {events -> events.any {it is LiveEvent.Message && it.message.id==id}}
                .filterIsInstance<LiveEvent.Message>().first {it.message.id==id}.message
            assertEquals("Try ten repetitions tonight.",heard.body)
            assertEquals(therapistAccount.first,heard.senderId)
            // The live row and the function's reply name the same moment, whatever their spelling.
            assertEquals(sent.at,heard.at)

            // The same function the web reads, so both apps show the same count.
            assertEquals(1,patient.loadConversations().single().unread)
            assertEquals(0,therapist.loadConversations().single().unread)
            patient.markConversationRead(conversation.id)
            assertEquals(0,patient.loadConversations().single().unread)
            therapistLive.until("the read mark") {events -> events.any {it is LiveEvent.Read && it.mark.userId==patientAccount.first}}

            assertTrue(therapist.deleteMessage(id).deleted)
            val gone=patientLive.until("the deletion") {events -> events.any {it is LiveEvent.Message && it.message.id==id && it.message.deleted}}
                .filterIsInstance<LiveEvent.Message>().last {it.message.id==id}.message
            assertEquals("",gone.body)

            val reply=patient.sendMessage(UUID.randomUUID().toString(),conversation.id,"Better, thank you.")
            therapistLive.until("the reply") {events -> events.any {it is LiveEvent.Message && it.message.id==reply.id}}
            assertTrue("The outsider heard: ${outsiderLive.events.value}",outsiderLive.events.value.none {it !is LiveEvent.Connection})

            // A photo, the way the app sends one, opened by the other person and by nobody else.
            val photoId=UUID.randomUUID().toString()
            val draft=MediaDraft(MediaKind.IMAGE,"","image/jpeg","",1600,1200,null)
            val places=therapist.startAttachment(photoId,conversation.id,draft)
            val picture=ByteArray(150_000) {(it%251).toByte()}
            therapist.uploadMedia(places.mediaPath,picture,"image/jpeg")
            therapist.uploadMedia(places.previewPath,ByteArray(10_000),"image/jpeg")
            // An upload repeated after a lost reply is harmless.
            therapist.uploadMedia(places.previewPath,ByteArray(10_000),"image/jpeg")
            val photo=therapist.sendAttachment(photoId,"Your posture")
            assertEquals(MediaKind.IMAGE,photo.attachment?.kind)
            patientLive.until("the live photo") {events -> events.any {it is LiveEvent.Message && it.message.id==photoId && it.message.attachment!=null}}
            val link=patient.mediaLink(places.mediaPath)
            assertArrayEquals(picture,http.newCall(Request.Builder().url(link).build()).execute().use {it.body!!.bytes()})
            assertTrue(runCatching {outsider.mediaLink(places.mediaPath)}.isFailure)
            val tooLarge=UUID.randomUUID().toString()
            val big=therapist.startAttachment(tooLarge,conversation.id,draft)
            therapist.uploadMedia(big.mediaPath,ByteArray(1_048_577),"image/jpeg")
            therapist.uploadMedia(big.previewPath,ByteArray(100),"image/jpeg")
            assertEquals("chat_media_too_large",(runCatching {therapist.sendAttachment(tooLarge,"")}.exceptionOrNull() as RemoteFailure).code)

            val page=patient.loadMessages(conversation.id)
            assertEquals(listOf(photoId,reply.id,id),page.messages.map {it.id})
            assertTrue(page.messages.last().deleted)
            assertEquals(places.mediaPath,page.messages.first().attachment?.mediaPath)
            val failure=runCatching {outsider.sendMessage(UUID.randomUUID().toString(),conversation.id,"Hello")}.exceptionOrNull() as RemoteFailure
            assertEquals("chat_closed",failure.code)
            listOf(patientLive,therapistLive,outsiderLive).forEach {it.job.cancel()}
        }
    }

    private companion object {const val PASSWORD="Synthetic-Passw0rd!"}
}
