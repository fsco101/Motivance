package com.motivance.designsystem

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.motivance.R
import java.util.concurrent.atomic.AtomicLong
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

enum class ToastTone { SUCCESS, PENDING, INFO, ERROR }
data class Toast(val id:Long,val message:Int,val tone:ToastTone)

/** How long every toast stays on screen, whatever its tone. */
const val TOAST_DURATION_MS=5_000L

/**
 * The one channel for action feedback. It is a singleton so a toast outlives the screen that raised it: "Signed in"
 * is raised on the login screen and read on Home. Only the latest toast is kept, which lets "Saving…" become "Saved".
 */
@Singleton class Toaster @Inject constructor() {
    private val ids=AtomicLong()
    private val mutable=MutableStateFlow<Toast?>(null)
    val current=mutable.asStateFlow()
    fun show(message:Int,tone:ToastTone=ToastTone.SUCCESS) {mutable.value=Toast(ids.incrementAndGet(),message,tone)}
    /** Clears [id] only, so an expiring toast cannot remove the newer one that replaced it. */
    fun dismiss(id:Long) {mutable.update {if(it?.id==id) null else it}}
}

val LocalToaster=staticCompositionLocalOf {Toaster()}

/** Draws the current toast above every screen. */
@Composable fun ToastHost(toaster:Toaster,modifier:Modifier=Modifier) {
    val toast by toaster.current.collectAsState()
    AnimatedContent(toast,modifier.fillMaxWidth().padding(horizontal=16.dp,vertical=8.dp),contentAlignment=Alignment.TopCenter,
        transitionSpec={(fadeIn(tween(180))+slideInVertically(tween(220)) {-it/3}) togetherWith fadeOut(tween(140))},
        contentKey={it?.id},label="toast") {shown ->
        if(shown!=null) ToastCard(shown) {toaster.dismiss(shown.id)}
    }
}

/** Always dark, so one design reads the same over the light workspace and the dark camera stage. */
@Composable private fun ToastCard(toast:Toast,dismiss:()->Unit) {
    val (icon,tint)=when(toast.tone) {
        ToastTone.SUCCESS -> Icons.Default.CheckCircle to Motion.SproutBright
        ToastTone.PENDING -> Icons.Default.Refresh to Motion.NightCaution
        ToastTone.INFO -> Icons.Default.Info to Motion.NightInk
        ToastTone.ERROR -> Icons.Default.Warning to Color(0xFFFFB4AB)
    }
    // One clock drives the bar and the closing, so the bar is empty exactly when the toast goes. It counts frames rather
    // than using an animation, which the system "remove animations" setting would finish instantly.
    var remaining by remember {mutableFloatStateOf(1f)}
    LaunchedEffect(Unit) {
        val start=withFrameMillis {it}
        while(remaining>0f) {
            val elapsed=withFrameMillis {it}-start
            remaining=(1f-elapsed.toFloat()/TOAST_DURATION_MS).coerceAtLeast(0f)
        }
        dismiss()
    }
    Surface(Modifier.widthIn(max=560.dp).fillMaxWidth().testTag("toast"),shape=MaterialTheme.shapes.medium,color=Motion.Ink,contentColor=Color.White,shadowElevation=6.dp) {
        Column {
            Row(Modifier.padding(start=16.dp,end=4.dp,top=6.dp,bottom=6.dp),verticalAlignment=Alignment.CenterVertically) {
                Row(Modifier.weight(1f).padding(vertical=8.dp).semantics(mergeDescendants=true) {
                    liveRegion=if(toast.tone==ToastTone.ERROR) LiveRegionMode.Assertive else LiveRegionMode.Polite
                },verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                    Icon(icon,null,Modifier.size(22.dp),tint=tint)
                    Text(stringResource(toast.message),style=MaterialTheme.typography.bodyMedium)
                }
                IconButton(dismiss) {Icon(Icons.Default.Close,stringResource(R.string.toast_close),Modifier.size(20.dp))}
            }
            // Read only while drawing, so the countdown repaints the bar without recomposing the card every frame.
            Box(Modifier.fillMaxWidth().height(3.dp).testTag("toast-time").drawBehind {
                drawRect(tint,size=Size(size.width*remaining,size.height))
            })
        }
    }
}
