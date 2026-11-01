package com.motivance.feature.exercise

import android.graphics.Bitmap
import android.content.res.Configuration
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.*
import androidx.test.platform.app.InstrumentationRegistry
import com.motivance.R
import com.motivance.designsystem.MotivanceTheme
import com.motivance.domain.*
import java.io.File
import java.util.Locale
import org.junit.*

/** Synthetic renderer fixtures, not model accuracy/performance tests. */
class SkeletonPreviewTest {
    @get:Rule val compose=createComposeRule()
    private val base get()=InstrumentationRegistry.getInstrumentation().targetContext
    private val points=MutableList(33) {Landmark(.5f,.5f,0f)}.apply {
        this[0]=Landmark(.5f,.14f,1f)
        this[11]=Landmark(.38f,.3f,1f);this[12]=Landmark(.62f,.3f,1f)
        this[13]=Landmark(.3f,.46f,1f);this[15]=Landmark(.15f,.32f,1f)
        this[14]=Landmark(.69f,.47f,1f);this[16]=Landmark(.72f,.62f,1f)
        this[23]=Landmark(.42f,.58f,1f);this[24]=Landmark(.58f,.58f,1f)
        this[25]=Landmark(.39f,.75f,1f);this[26]=Landmark(.61f,.75f,1f)
        this[27]=Landmark(.36f,.92f,1f);this[28]=Landmark(.64f,.92f,1f)
    }
    private fun image():Bitmap=Bitmap.createBitmap(640,800,Bitmap.Config.ARGB_8888).apply {
        val paint=android.graphics.Paint().apply {shader=android.graphics.LinearGradient(0f,0f,640f,800f,0xFF284455.toInt(),0xFF142635.toInt(),android.graphics.Shader.TileMode.CLAMP)}
        android.graphics.Canvas(this).drawRect(0f,0f,640f,800f,paint)
    }
    private fun capture(name:String) {
        File(base.getExternalFilesDir(null),"skeleton-$name.png").outputStream().use {
            compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG,100,it)
        }
    }
    @Test fun selectedJointAndMetricsRenderWithoutShowingAnAngleForAmbiguousTracking() {
        val metrics=mutableStateOf(AssessmentSnapshot(quality=TrackingQuality.READY,angleDegrees=80.0,completed=3))
        val frame=image()
        compose.setContent {MotivanceTheme {Surface {Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
            SkeletonPreview(frame,points,false,ExerciseRules(),metrics.value,base.getString(if(metrics.value.quality==TrackingQuality.READY) R.string.quality_ready else R.string.quality_multiple))
        }}}}
        compose.onNodeWithText("80.0°").assertExists()
        compose.onNodeWithText("3 / 5").assertExists()
        capture("focused-elbow")
        compose.runOnIdle {metrics.value=metrics.value.copy(quality=TrackingQuality.MULTIPLE_PEOPLE)}
        compose.onNodeWithText("80.0°").assertDoesNotExist()
        compose.onNodeWithText(base.getString(R.string.quality_multiple)).assertExists()
        capture("ambiguous-tracking")
    }
    @Test fun mirroredShoulderPreviewSupportsLargeFilipinoText() {
        val config=Configuration(base.resources.configuration).apply {setLocale(Locale.forLanguageTag("fil"));fontScale=2f}
        val localized=base.createConfigurationContext(config)
        val frame=image()
        compose.setContent {
            CompositionLocalProvider(LocalContext provides localized,LocalConfiguration provides config,LocalDensity provides Density(base.resources.displayMetrics.density,2f)) {
                MotivanceTheme {Surface {Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
                    SkeletonPreview(frame,points,true,ExerciseRules(kind=ExerciseKind.SHOULDER_ABDUCTION,side=BodySide.RIGHT),AssessmentSnapshot(quality=TrackingQuality.READY,angleDegrees=45.0),localized.getString(R.string.quality_ready))
                }}}
            }
        }
        compose.onNodeWithText(localized.getString(R.string.skeleton_focus,localized.getString(R.string.right_side),localized.getString(R.string.skeleton_shoulder))).assertExists()
        compose.onNodeWithText(localized.getString(R.string.skeleton_angle)).performScrollTo().assertIsDisplayed()
        capture("shoulder-large-fil")
    }
}
