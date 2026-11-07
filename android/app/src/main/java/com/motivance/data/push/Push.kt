package com.motivance.data.push

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.motivance.BuildConfig
import com.motivance.MainActivity
import com.motivance.R
import com.motivance.domain.NotificationRepository
import com.motivance.domain.PushDevices
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull

/** Firebase's public values come from android/.env, so the app builds and runs without them. All four are needed before anything push-related happens. */
data class FirebaseValues(val projectId:String,val appId:String,val apiKey:String,val senderId:String) {
    val complete get()=listOf(projectId,appId,apiKey,senderId).all {it.isNotBlank()}
}

object PushSetup {
    private val values=FirebaseValues(BuildConfig.FIREBASE_PROJECT_ID,BuildConfig.FIREBASE_APP_ID,BuildConfig.FIREBASE_API_KEY,BuildConfig.FIREBASE_SENDER_ID)
    val enabled get()=values.complete

    /** Started by hand rather than from google-services.json, so an unset project leaves no trace of Firebase running. */
    fun start(context:Context) {
        if(!enabled || FirebaseApp.getApps(context).isNotEmpty()) return
        runCatching {
            FirebaseApp.initializeApp(context,FirebaseOptions.Builder().setProjectId(values.projectId).setApplicationId(values.appId).setApiKey(values.apiKey).setGcmSenderId(values.senderId).build())
        }
    }
}

enum class PushPrompt { NOTHING, ASK, REGISTER }

/** Android 13 needs the person's permission to show a notification. Earlier versions have it already. */
fun pushPrompt(enabled:Boolean,signedIn:Boolean,sdk:Int,granted:Boolean)=when {
    !enabled || !signedIn -> PushPrompt.NOTHING
    sdk>=Build.VERSION_CODES.TIRAMISU && !granted -> PushPrompt.ASK
    else -> PushPrompt.REGISTER
}

fun notificationsAllowed(context:Context)=Build.VERSION.SDK_INT<Build.VERSION_CODES.TIRAMISU || ContextCompat.checkSelfPermission(context,Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED

/** Where a phone's token comes from, apart from the rules below, so they can be tested without Firebase. */
fun interface DeviceTokens {suspend fun current():String?}

@Singleton class FirebaseDeviceTokens @Inject constructor():DeviceTokens {
    override suspend fun current():String? {
        if(!PushSetup.enabled) return null
        return suspendCancellableCoroutine {wait ->
            try {FirebaseMessaging.getInstance().token.addOnCompleteListener {task -> wait.resume(if(task.isSuccessful) task.result else null)}}
            // Values that are set but wrong fail here. Push simply stays off, because nothing else depends on it.
            catch(_:Exception) {wait.resume(null)}
        }
    }
}

/** Push is a convenience on top of the bell and email, so a failure here is never allowed to reach the person. */
@Singleton class PushRegistrar @Inject constructor(private val repository:NotificationRepository,private val tokens:DeviceTokens):PushDevices {
    override suspend fun register() {quietly {tokens.current()?.let {repository.registerDevice(it)}}}

    /** Signing out must not wait on a poor connection, so it tries briefly. A token left behind is removed when FCM reports it gone or the next person signs in. */
    override suspend fun unregister() {withTimeoutOrNull(UNREGISTER_MS) {quietly {tokens.current()?.let {repository.unregisterDevice(it)}}}}

    suspend fun tokenChanged(token:String) {quietly {repository.registerDevice(token)}}

    private suspend fun quietly(work:suspend ()->Unit) {
        try {work()}
        catch(e:CancellationException) {throw e}
        catch(_:Exception) {}
    }

    private companion object {const val UNREGISTER_MS=3_000L}
}

object PushNotifier {
    const val OPEN_NOTIFICATIONS="com.motivance.OPEN_NOTIFICATIONS"
    private const val CHANNEL="booking_updates"

    /** The words arrive already in the reader's language. A lock screen shows only that there is news, because a message can name a patient. */
    fun show(context:Context,data:Map<String,String>) {
        val title=data["title"]?.takeIf {it.isNotBlank()} ?: return
        val body=data["body"]?.takeIf {it.isNotBlank()} ?: return
        val manager=context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL,context.getString(R.string.push_channel),NotificationManager.IMPORTANCE_DEFAULT))
        val open=PendingIntent.getActivity(context,0,Intent(context,MainActivity::class.java).putExtra(OPEN_NOTIFICATIONS,true).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val hidden=Notification.Builder(context,CHANNEL).setSmallIcon(R.drawable.ic_notification).setContentTitle(context.getString(R.string.push_public_title)).build()
        val note=Notification.Builder(context,CHANNEL).setSmallIcon(R.drawable.ic_notification).setContentTitle(title).setContentText(body).setStyle(Notification.BigTextStyle().bigText(body))
            .setVisibility(Notification.VISIBILITY_PRIVATE).setPublicVersion(hidden).setContentIntent(open).setAutoCancel(true).build()
        manager.notify("${data["kind"]}:${data["booking_id"]}:$body".hashCode(),note)
    }
}

@AndroidEntryPoint class MotivanceMessagingService:FirebaseMessagingService() {
    @Inject lateinit var registrar:PushRegistrar
    private val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)

    override fun onNewToken(token:String) {scope.launch {registrar.tokenChanged(token)}}
    override fun onMessageReceived(message:RemoteMessage) {PushNotifier.show(this,message.data)}
    override fun onDestroy() {scope.cancel();super.onDestroy()}
}
