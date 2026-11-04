package com.motivance.designsystem

import android.os.Build
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.format.TextStyle as DateTextStyle
import java.time.temporal.TemporalAdjusters
import java.util.Locale
import kotlin.math.cos
import kotlin.math.sin

/** Small, named haptic vocabulary so every screen confirms the same things the same way. */
class Haptics internal constructor(private val view: View) {
    /** A light tick for selections, toggles and drag snapping. */
    fun tick() { view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK) }
    /** A firmer confirmation: a counted repetition, a published plan, a saved session. */
    fun confirm() {
        view.performHapticFeedback(if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY)
    }
    /** A rejection: an action that could not run. */
    fun reject() {
        view.performHapticFeedback(if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS)
    }
}

@Composable fun rememberHaptics(): Haptics { val view = LocalView.current; return remember(view) { Haptics(view) } }

/** A surface that answers a press by settling slightly, the way a physical card gives under a finger. */
@Composable fun TappableSurface(
    onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    shape: Shape = MaterialTheme.shapes.large, color: Color = MaterialTheme.colorScheme.surface,
    contentColor: Color = contentColorFor(color), border: BorderStroke? = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    content: @Composable () -> Unit,
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) .975f else 1f, spring(dampingRatio = .7f, stiffness = Spring.StiffnessMedium), label = "press")
    Surface(onClick, modifier.scale(scale), enabled = enabled, shape = shape, color = color, contentColor = contentColor,
        border = border, interactionSource = interaction, content = content)
}

/** Expands and collapses its content so the change is visible rather than a jump. */
@Composable fun Collapsible(expanded: Boolean, content: @Composable ColumnScope.() -> Unit) {
    AnimatedVisibility(expanded, enter = expandVertically(spring(stiffness = Spring.StiffnessMediumLow)) + fadeIn(),
        exit = shrinkVertically(spring(stiffness = Spring.StiffnessMedium)) + fadeOut()) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
    }
}

/** A count that rolls upward when it grows, so a new repetition is noticed without reading. */
@Composable fun RollingCount(value: Int, style: TextStyle, color: Color, modifier: Modifier = Modifier) {
    AnimatedContent(value, modifier, transitionSpec = {
        if (targetState > initialState) (slideInVertically { it } + fadeIn()) togetherWith (slideOutVertically { -it } + fadeOut())
        else fadeIn() togetherWith fadeOut()
    }, label = "count") { Text(it.toString(), style = style, color = color) }
}

/**
 * The Motivance signature: an open 240° arc, like a goniometer face. [progress] fills it with an animated
 * sweep. [band] optionally marks a 0–180° joint range on the same face.
 */
@Composable fun MotionArc(
    progress: Float, modifier: Modifier = Modifier, track: Color = MaterialTheme.colorScheme.surfaceContainerHigh,
    fill: Color = MaterialTheme.colorScheme.primary, stroke: Float = 14f, band: Pair<Double, Double>? = null,
    bandColor: Color = MaterialTheme.colorScheme.secondary, content: @Composable BoxScope.() -> Unit = {},
) {
    val animated by animateFloatAsState(progress.coerceIn(0f, 1f), tween(900, easing = FastOutSlowInEasing), label = "arc")
    Box(modifier, contentAlignment = Alignment.Center) {
        Canvas(Modifier.matchParentSize()) {
            val width = stroke.dp.toPx()
            val diameter = minOf(size.width, size.height) - width
            val topLeft = Offset((size.width - diameter) / 2, (size.height - diameter) / 2)
            val arc = Size(diameter, diameter)
            drawArc(track, 150f, 240f, false, topLeft, arc, style = Stroke(width, cap = StrokeCap.Round))
            if (band != null) {
                val from = band.first.coerceIn(0.0, 180.0); val to = band.second.coerceIn(0.0, 180.0)
                drawArc(bandColor.copy(alpha = .28f), 150f + (from / 180.0 * 240).toFloat(), ((to - from) / 180.0 * 240).toFloat(),
                    false, topLeft, arc, style = Stroke(width, cap = StrokeCap.Butt))
            }
            if (animated > 0f) drawArc(fill, 150f, 240f * animated, false, topLeft, arc, style = Stroke(width, cap = StrokeCap.Round))
            // Quiet ticks at each quarter of the face.
            val center = Offset(size.width / 2, size.height / 2); val r = diameter / 2
            listOf(0f, .25f, .5f, .75f, 1f).forEach {
                val radians = Math.toRadians(150.0 + 240.0 * it)
                val inner = r - width * 1.15f; val outer = r - width * .8f
                drawLine(track, Offset(center.x + inner * cos(radians).toFloat(), center.y + inner * sin(radians).toFloat()),
                    Offset(center.x + outer * cos(radians).toFloat(), center.y + outer * sin(radians).toFloat()), 2.dp.toPx(), StrokeCap.Round)
            }
        }
        content()
    }
}

/**
 * Monday-to-Sunday strip for the current week. A filled dot is a day with a completed session; today is ringed.
 * [description] summarises the week for screen readers, so individual dots stay silent.
 */
@Composable fun WeekStrip(activeDays: Set<LocalDate>, description: String, modifier: Modifier = Modifier, today: LocalDate = LocalDate.now()) {
    val monday = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
    Row(modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = description }, horizontalArrangement = Arrangement.SpaceBetween) {
        (0L until 7L).map { monday.plusDays(it) }.forEach { day ->
            val active = day in activeDays
            val isToday = day == today
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(day.dayOfWeek.getDisplayName(DateTextStyle.NARROW, Locale.getDefault()), style = MaterialTheme.typography.labelMedium,
                    color = if (isToday) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                    fontWeight = if (isToday) FontWeight.Bold else FontWeight.Medium, textAlign = TextAlign.Center)
                Surface(Modifier.size(34.dp), shape = CircleShape,
                    color = if (active) MaterialTheme.colorScheme.secondary else if (day.isAfter(today)) Color.Transparent else MaterialTheme.colorScheme.surfaceContainer,
                    border = when {
                        isToday && !active -> BorderStroke(2.dp, MaterialTheme.colorScheme.primary)
                        day.isAfter(today) -> BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
                        else -> null
                    }) {
                    if (active) Box(contentAlignment = Alignment.Center) {
                        Canvas(Modifier.size(14.dp)) {
                            val w = 2.4.dp.toPx(); val c = Color.White
                            drawLine(c, Offset(size.width * .1f, size.height * .55f), Offset(size.width * .4f, size.height * .85f), w, StrokeCap.Round)
                            drawLine(c, Offset(size.width * .4f, size.height * .85f), Offset(size.width * .92f, size.height * .18f), w, StrokeCap.Round)
                        }
                    }
                }
            }
        }
    }
}
