package com.motivance.feature.exercise

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.motivance.R
import com.motivance.designsystem.Motion
import com.motivance.designsystem.MotivanceTheme
import com.motivance.domain.*
import java.io.File
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ExerciseGuideTest {
    @get:Rule val compose=createComposeRule()
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private fun text(id:Int)=context.getString(id)
    private fun capture(name:String) {
        File(context.getExternalFilesDir(null),name).outputStream().use {compose.onRoot().captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
    }

    @Test fun everyExerciseHasAGuide() {
        val all=listOf(
            "Elbow" to guideMotion(BodyJoint.ELBOW,BodySide.RIGHT),"Shoulder" to guideMotion(BodyJoint.SHOULDER,BodySide.LEFT),"Wrist" to guideMotion(BodyJoint.WRIST,BodySide.RIGHT),
            "Hip" to guideMotion(BodyJoint.HIP,BodySide.RIGHT),"Knee" to guideMotion(BodyJoint.KNEE,BodySide.RIGHT),"Ankle" to guideMotion(BodyJoint.ANKLE,BodySide.RIGHT),
        )
        compose.mainClock.autoAdvance=false
        compose.setContent {MotivanceTheme {Surface {Column(Modifier.fillMaxSize().padding(8.dp),verticalArrangement=Arrangement.spacedBy(6.dp)) {
            all.chunked(2).forEach {row ->
                Row(horizontalArrangement=Arrangement.spacedBy(6.dp)) {
                    row.forEach {(name,motion) ->
                        Column(Modifier.weight(1f)) {
                            Text(name)
                            ExerciseThumbnail(motion,Modifier.fillMaxWidth().height(190.dp).background(Motion.Tide))
                        }
                    }
                }
            }
        }}}}
        compose.mainClock.advanceTimeBy(100)
        capture("guide-all.png")
    }

    @Test fun everyMovementIsDrawnAsAPersonAtBothEnds() {
        val all=listOf(
            "Shoulder" to guideMotion(BodyJoint.SHOULDER,BodySide.LEFT),"Elbow" to guideMotion(BodyJoint.ELBOW,BodySide.RIGHT),"Wrist" to guideMotion(BodyJoint.WRIST,BodySide.RIGHT),
            "Hip" to guideMotion(BodyJoint.HIP,BodySide.LEFT),"Seated knee" to guideMotion(BodyJoint.KNEE,BodySide.RIGHT),"Standing knee" to guideMotion(BodyJoint.KNEE,BodySide.LEFT,"Standing knee curl"),
            "Ankle" to guideMotion(BodyJoint.ANKLE,BodySide.RIGHT),"Seated hip" to guideMotion(BodyJoint.HIP,BodySide.RIGHT,"Seated hip flexion"),"Full shoulder" to guideMotion(BodyJoint.SHOULDER,BodySide.RIGHT,low=15.0,high=170.0),
        )
        compose.mainClock.autoAdvance=false
        compose.setContent {MotivanceTheme {Surface {Column(Modifier.fillMaxSize().padding(4.dp),verticalArrangement=Arrangement.spacedBy(4.dp)) {
            all.chunked(3).forEach {row ->
                Row(horizontalArrangement=Arrangement.spacedBy(4.dp)) {
                    row.forEach {(name,motion) -> ExerciseGuide(motion,name,Modifier.weight(1f).height(200.dp).background(Motion.Tide),still=false)}
                }
            }
        }}}}
        compose.mainClock.advanceTimeBy(100)
        val skin=0xFFC98E66.toInt()
        assertTrue("A body is drawn at the start",frame().count {it==skin}>2000)
        capture("guide-person-start.png")
        compose.mainClock.advanceTimeBy(2000)
        assertTrue("A body is drawn at the target",frame().count {it==skin}>2000)
        capture("guide-person-target.png")
    }

    @Test fun lowPoseAndDarkStageRender() {
        compose.mainClock.autoAdvance=false
        compose.setContent {MotivanceTheme {Surface {Column(Modifier.fillMaxSize().padding(8.dp),verticalArrangement=Arrangement.spacedBy(6.dp)) {
            ExerciseGuide(guideMotion(BodyJoint.SHOULDER,BodySide.RIGHT,low=15.0,high=170.0),"Shoulder abduction",Modifier.fillMaxWidth().height(300.dp).background(Motion.Night),dark=true)
            ExerciseGuide(guideMotion(BodyJoint.KNEE,BodySide.LEFT,"Standing knee curl"),"Standing knee curl",Modifier.fillMaxWidth().height(300.dp).background(Motion.Tide))
        }}}}
        compose.mainClock.advanceTimeBy(2100)
        capture("guide-stage.png")
    }

    @Test fun thePrepareCameraSceneUsesTheModelPerson() {
        compose.mainClock.autoAdvance=false
        val rules=ExerciseRules(side=BodySide.RIGHT,lowDegrees=20.0,highDegrees=120.0)
        compose.setContent {MotivanceTheme {Surface {Column(Modifier.fillMaxSize().padding(16.dp)) {com.motivance.navigation.SetupIllustration(rules)}}}}
        compose.mainClock.advanceTimeBy(2100)
        compose.onNodeWithContentDescription(text(R.string.setup_figure)).assertExists()
        capture("guide-setup.png")
    }

    private fun frame()=compose.onRoot().captureToImage().asAndroidBitmap().let {bitmap -> IntArray(bitmap.width*bitmap.height).also {bitmap.getPixels(it,0,bitmap.width,0,0,bitmap.width,bitmap.height)}}

    @Test fun theCharacterMovesThroughTheRepetitionAndStopsWhenPaused() {
        compose.mainClock.autoAdvance=false
        val motion=guideMotion(BodyJoint.ELBOW,low=20.0,high=120.0)
        compose.setContent {MotivanceTheme {Surface {ExerciseGuide(motion,"Elbow flexion",Modifier.size(240.dp),still=false)}}}
        compose.mainClock.advanceTimeBy(100)
        val start=frame()
        compose.mainClock.advanceTimeBy(2000)
        val target=frame()
        assertFalse("The character moved",start.contentEquals(target))
        capture("guide-frame-target.png")
        compose.mainClock.advanceTimeBy(2100)
        val back=frame()
        assertFalse("It came back from the target",back.contentEquals(target))
        compose.onNodeWithContentDescription(context.getString(R.string.guide_description,"Elbow flexion",20,120)).performClick()
        compose.mainClock.advanceTimeBy(100)
        val paused=frame()
        compose.mainClock.advanceTimeBy(1500)
        assertArrayEquals("Paused means still",paused,frame())
    }

    @Test fun withAnimationsOffItHoldsTheTarget() {
        compose.mainClock.autoAdvance=false
        compose.setContent {MotivanceTheme {Surface {ExerciseGuide(guideMotion(BodyJoint.ELBOW),"Elbow flexion",Modifier.size(240.dp),still=true)}}}
        compose.mainClock.advanceTimeBy(100)
        val first=frame()
        compose.mainClock.advanceTimeBy(1500)
        assertArrayEquals(first,frame())
    }

    @Test fun theGuideCanBePausedAndDescribesItself() {
        compose.mainClock.autoAdvance=false
        val motion=guideMotion(BodyJoint.ELBOW,low=20.0,high=120.0)
        compose.setContent {MotivanceTheme {Surface {ExerciseGuide(motion,"Elbow flexion",Modifier.size(240.dp),still=false)}}}
        compose.mainClock.advanceTimeBy(100)
        val guide=compose.onNodeWithContentDescription(context.getString(R.string.guide_description,"Elbow flexion",20,120))
        guide.assertExists().assert(hasClickAction()).assert(SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.Role,androidx.compose.ui.semantics.Role.Button))
        guide.performClick()
        compose.mainClock.advanceTimeBy(100)
        guide.assertExists()
    }
}
