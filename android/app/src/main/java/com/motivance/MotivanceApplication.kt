package com.motivance
import android.app.Application
import dagger.hilt.android.HiltAndroidApp
@HiltAndroidApp class MotivanceApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        com.motivance.data.push.PushSetup.start(this)
    }
}
