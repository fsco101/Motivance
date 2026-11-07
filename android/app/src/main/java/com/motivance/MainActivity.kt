package com.motivance

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import com.motivance.designsystem.MotivanceTheme
import com.motivance.feature.auth.AuthScreen
import com.motivance.feature.auth.AuthViewModel
import com.motivance.feature.exercise.CameraPrototype
import dagger.hilt.android.AndroidEntryPoint
import com.motivance.navigation.MotivanceApp
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun attachBaseContext(newBase:android.content.Context) {super.attachBaseContext(com.motivance.designsystem.AppLanguage.wrap(newBase))}
    private val auth: AuthViewModel by viewModels()
    @javax.inject.Inject lateinit var toaster: com.motivance.designsystem.Toaster
    private val openInbox=mutableStateOf(false)

    override fun onNewIntent(intent:android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if(intent.getBooleanExtra(com.motivance.data.push.PushNotifier.OPEN_NOTIFICATIONS,false)) openInbox.value=true
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if(savedInstanceState==null) openInbox.value=intent.getBooleanExtra(com.motivance.data.push.PushNotifier.OPEN_NOTIFICATIONS,false)
        setContent {
            MotivanceTheme {
                val stage=androidx.compose.runtime.remember {mutableStateOf<androidx.compose.ui.graphics.Color?>(null)}
                androidx.compose.runtime.CompositionLocalProvider(com.motivance.designsystem.LocalStageColor provides stage) {
                    Surface(Modifier.fillMaxSize(),color=stage.value ?: androidx.compose.material3.MaterialTheme.colorScheme.background) {
                        Box(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
                            MotivanceApp(auth,toaster,openInbox.value) {openInbox.value=false}
                        }
                    }
                }
            }
        }
    }
}
