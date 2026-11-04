package com.motivance.designsystem

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

/**
 * The colour drawn behind the system bars. The activity pads content away from the bars, so a screen with its
 * own ground (the dark camera stage) sets this to keep the bars from showing as light strips.
 */
val LocalStageColor = staticCompositionLocalOf<MutableState<Color?>> { mutableStateOf(null) }

private tailrec fun Context.activity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.activity()
    else -> null
}

/** Paints the system bar areas with [color] and switches to light bar icons while this is composed. */
@Composable fun DarkStage(color: Color = Motion.Night) {
    val stage = LocalStageColor.current
    val view = LocalView.current
    DisposableEffect(color) {
        stage.value = color
        val window = view.context.activity()?.window
        val controller = window?.let { WindowCompat.getInsetsController(it, view) }
        val status = controller?.isAppearanceLightStatusBars
        val navigation = controller?.isAppearanceLightNavigationBars
        controller?.isAppearanceLightStatusBars = false
        controller?.isAppearanceLightNavigationBars = false
        onDispose {
            stage.value = null
            if (controller != null) {
                status?.let { controller.isAppearanceLightStatusBars = it }
                navigation?.let { controller.isAppearanceLightNavigationBars = it }
            }
        }
    }
}
