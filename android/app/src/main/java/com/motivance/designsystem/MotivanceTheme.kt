package com.motivance.designsystem

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.motivance.R

/**
 * Motivance "motion arc" tokens, drawn from the logo: lagoon teal for action, sprout green for a range that
 * was reached, and a cool mist ground. Amber is reserved for caution and holds so it never reads as success.
 */
object Motion {
    val Ink = Color(0xFF0D2B36)
    val Lagoon = Color(0xFF0E7C86)
    val LagoonDeep = Color(0xFF075A63)
    val Sprout = Color(0xFF1B7F45)
    val SproutBright = Color(0xFF6FE08F)
    val Amber = Color(0xFFE8A33D)
    val Mist = Color(0xFFF1F6F5)
    val Tide = Color(0xFFDCEFEC)

    /** Dark session palette: the camera stage, where the image and skeleton must carry the contrast. */
    val Night = Color(0xFF062229)
    val NightPanel = Color(0xFF0E3640)
    val NightLine = Color(0xFF285661)
    val NightInk = Color(0xFFBFE3DD)
    val NightCaution = Color(0xFFFFC56B)
}

val DisplayFamily = FontFamily(
    Font(R.font.bricolage_regular, FontWeight.Normal),
    Font(R.font.bricolage_regular, FontWeight.Medium),
    Font(R.font.bricolage_bold, FontWeight.SemiBold),
    Font(R.font.bricolage_bold, FontWeight.Bold),
    Font(R.font.bricolage_bold, FontWeight.ExtraBold),
)

private val MotionColors = lightColorScheme(
    primary = Motion.Lagoon, onPrimary = Color.White,
    primaryContainer = Color(0xFFCDEDEA), onPrimaryContainer = Color(0xFF053B40),
    secondary = Motion.Sprout, onSecondary = Color.White,
    secondaryContainer = Color(0xFFD3F2DC), onSecondaryContainer = Color(0xFF0B3D20),
    tertiary = Color(0xFF9A5B00), onTertiary = Color.White,
    tertiaryContainer = Color(0xFFFCE7C4), onTertiaryContainer = Color(0xFF4A2C00),
    background = Motion.Mist, onBackground = Motion.Ink,
    surface = Color.White, onSurface = Motion.Ink,
    surfaceContainerLowest = Color.White, surfaceContainerLow = Color(0xFFF6FAF9),
    surfaceContainer = Color(0xFFE8F1EF), surfaceContainerHigh = Color(0xFFDFEBE8),
    surfaceContainerHighest = Color(0xFFD4E4E0),
    surfaceVariant = Motion.Tide, onSurfaceVariant = Color(0xFF4B6168),
    outline = Color(0xFF7A9096), outlineVariant = Color(0xFFDCE7E4),
    error = Color(0xFFBA3B35), onError = Color.White,
    errorContainer = Color(0xFFFBE1DE), onErrorContainer = Color(0xFF5C1210),
)

// Display type carries the numbers patients watch (angles, repetitions) and page titles; body stays on the
// system face so long Filipino words wrap predictably at large font scales.
private val MotionTypography = Typography(
    displayLarge = TextStyle(fontFamily = DisplayFamily, fontWeight = FontWeight.Bold, fontSize = 64.sp, lineHeight = 68.sp, letterSpacing = (-1.5).sp),
    displayMedium = TextStyle(fontFamily = DisplayFamily, fontWeight = FontWeight.Bold, fontSize = 48.sp, lineHeight = 52.sp, letterSpacing = (-1).sp),
    displaySmall = TextStyle(fontFamily = DisplayFamily, fontWeight = FontWeight.Bold, fontSize = 38.sp, lineHeight = 44.sp, letterSpacing = (-.6).sp),
    headlineLarge = TextStyle(fontFamily = DisplayFamily, fontWeight = FontWeight.Bold, fontSize = 32.sp, lineHeight = 38.sp, letterSpacing = (-.6).sp),
    headlineMedium = TextStyle(fontFamily = DisplayFamily, fontWeight = FontWeight.Bold, fontSize = 28.sp, lineHeight = 34.sp, letterSpacing = (-.4).sp),
    headlineSmall = TextStyle(fontFamily = DisplayFamily, fontWeight = FontWeight.SemiBold, fontSize = 24.sp, lineHeight = 30.sp, letterSpacing = (-.2).sp),
    titleLarge = TextStyle(fontFamily = DisplayFamily, fontWeight = FontWeight.SemiBold, fontSize = 21.sp, lineHeight = 27.sp),
    titleMedium = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 17.sp, lineHeight = 24.sp),
    titleSmall = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 15.sp, lineHeight = 22.sp),
    bodyLarge = TextStyle(fontSize = 16.sp, lineHeight = 25.sp),
    bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 22.sp),
    bodySmall = TextStyle(fontSize = 13.sp, lineHeight = 19.sp),
    labelLarge = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 15.sp, lineHeight = 20.sp),
    labelMedium = TextStyle(fontWeight = FontWeight.Medium, fontSize = 12.sp, lineHeight = 16.sp, letterSpacing = .2.sp),
    labelSmall = TextStyle(fontWeight = FontWeight.Medium, fontSize = 11.sp, lineHeight = 16.sp, letterSpacing = .3.sp),
)

private val SessionColors = darkColorScheme(
    primary = Color(0xFF7FD8DE), onPrimary = Motion.Night,
    primaryContainer = Color(0xFF0F4E56), onPrimaryContainer = Color(0xFFCDEDEA),
    secondary = Motion.SproutBright, onSecondary = Motion.Ink,
    secondaryContainer = Color(0xFF14492A), onSecondaryContainer = Color(0xFFD3F2DC),
    tertiary = Motion.NightCaution, onTertiary = Motion.Ink,
    background = Motion.Night, onBackground = Color.White,
    surface = Motion.NightPanel, onSurface = Color.White,
    surfaceContainerLowest = Motion.Night, surfaceContainerLow = Color(0xFF0A2C34),
    surfaceContainer = Motion.NightPanel, surfaceContainerHigh = Color(0xFF16424D), surfaceContainerHighest = Color(0xFF1E4F5B),
    surfaceVariant = Motion.NightPanel, onSurfaceVariant = Motion.NightInk,
    outline = Color(0xFF5E8A93), outlineVariant = Motion.NightLine,
    error = Color(0xFFFFB4AB), onError = Color(0xFF690005),
    errorContainer = Color(0xFF5C1A17), onErrorContainer = Color(0xFFFFDAD6),
)

/** The camera session runs on a dark stage so the image, skeleton and live numbers carry the contrast. */
@Composable fun SessionTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = SessionColors, typography = MaterialTheme.typography, shapes = MaterialTheme.shapes) {
        CompositionLocalProvider(LocalContentColor provides Color.White, content = content)
    }
}

@Composable fun MotivanceTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = MotionColors, typography = MotionTypography,
        shapes = Shapes(extraSmall = RoundedCornerShape(8.dp), small = RoundedCornerShape(12.dp), medium = RoundedCornerShape(16.dp),
            large = RoundedCornerShape(24.dp), extraLarge = RoundedCornerShape(32.dp))) {
        CompositionLocalProvider(LocalContentColor provides MotionColors.onSurface, content = content)
    }
}
