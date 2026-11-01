package com.motivance.feature.rehabilitation

import android.content.res.Configuration
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.*
import androidx.test.platform.app.InstrumentationRegistry
import com.motivance.R
import com.motivance.data.local.*
import com.motivance.designsystem.MotivanceTheme
import com.motivance.domain.ExerciseRules
import org.junit.*
import org.junit.Assert.*
import java.io.File
import java.util.Locale

class AccessibilityTest {
    @get:Rule val compose=createComposeRule()
    @Test fun filipinoAssignmentAtDoubleFontRetainsReachableLabeledStart() {
        val base=InstrumentationRegistry.getInstrumentation().targetContext
        val config=Configuration(base.resources.configuration).apply {setLocale(Locale.forLanguageTag("fil"));fontScale=2f}
        val localized=base.createConfigurationContext(config)
        val prescription=CachedPrescription("patient","version","assignment","patient",ExerciseJson.rules(ExerciseRules(demo=false,prescriptionVersionId="version")),"Ilagay ang camera sa matatag na patungan.",System.currentTimeMillis()+60_000,System.currentTimeMillis())
        var started=false
        compose.setContent {
            CompositionLocalProvider(LocalContext provides localized,LocalConfiguration provides config,LocalDensity provides Density(base.resources.displayMetrics.density,2f)) {
                MotivanceTheme {Surface {Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) {CachedAssignments(listOf(prescription),false) {started=true}}}}
            }
        }
        val label=localized.getString(R.string.start_assigned_exercise)
        val button=compose.onNode(hasText(label) and hasClickAction())
        button.performScrollTo().assertIsDisplayed()
        val bounds=button.fetchSemanticsNode().boundsInRoot
        assertTrue(bounds.height/base.resources.displayMetrics.density>=48f)
        File(base.getExternalFilesDir(null),"sprint-04-assignment-large-fil.png").outputStream().use {compose.onRoot().captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
        button.performClick();assertTrue(started)
    }
}
