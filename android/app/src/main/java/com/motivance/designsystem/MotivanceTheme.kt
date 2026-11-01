package com.motivance.designsystem

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.material3.LocalContentColor
import androidx.compose.ui.graphics.Color
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// Native adaptation of the Stitch Kinetic Clinical Precision design tokens.
private val ClinicalColors = lightColorScheme(
    primary = Color(0xFF002042), onPrimary = Color.White,
    primaryContainer = Color(0xFFD4E3FF), onPrimaryContainer = Color(0xFF001C3A),
    secondary = Color(0xFF006A61), onSecondary = Color.White,
    secondaryContainer = Color(0xFF86F2E4), onSecondaryContainer = Color(0xFF005049),
    background = Color(0xFFF8F9FF), onBackground = Color(0xFF0B1C30),
    surface = Color.White, onSurface = Color(0xFF0B1C30),
    surfaceContainerLowest = Color.White, surfaceContainerLow = Color(0xFFF0F5FA),
    surfaceContainer = Color(0xFFEAF0F7), surfaceContainerHigh = Color(0xFFE2EBF5),
    surfaceContainerHighest = Color(0xFFD9E5F1),
    surfaceVariant = Color(0xFFE5EEFF), onSurfaceVariant = Color(0xFF526174),
    outline = Color(0xFF718096), outlineVariant = Color(0xFFDFE7EF)
)
private val ClinicalTypography = Typography(
    headlineLarge = TextStyle(fontFamily=FontFamily.SansSerif, fontWeight=FontWeight.Bold, fontSize=32.sp, lineHeight=40.sp, letterSpacing=(-.6).sp),
    headlineMedium = TextStyle(fontWeight=FontWeight.Bold, fontSize=28.sp, lineHeight=36.sp, letterSpacing=(-.4).sp),
    headlineSmall = TextStyle(fontWeight=FontWeight.SemiBold, fontSize=24.sp, lineHeight=32.sp),
    titleLarge = TextStyle(fontWeight=FontWeight.SemiBold, fontSize=21.sp, lineHeight=28.sp),
    titleMedium = TextStyle(fontWeight=FontWeight.SemiBold, fontSize=17.sp, lineHeight=24.sp),
    bodyLarge = TextStyle(fontSize=16.sp, lineHeight=25.sp),
    bodyMedium = TextStyle(fontSize=14.sp, lineHeight=22.sp),
    labelLarge = TextStyle(fontWeight=FontWeight.SemiBold, fontSize=14.sp, lineHeight=20.sp),
)
@Composable fun MotivanceTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = ClinicalColors, typography = ClinicalTypography,
        shapes = Shapes(small=RoundedCornerShape(12.dp), medium=RoundedCornerShape(16.dp),
            large=RoundedCornerShape(24.dp), extraLarge=RoundedCornerShape(28.dp))) {
        CompositionLocalProvider(LocalContentColor provides ClinicalColors.onSurface, content=content)
    }
}
