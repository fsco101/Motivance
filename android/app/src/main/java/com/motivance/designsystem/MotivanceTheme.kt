package com.motivance.designsystem

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.material3.LocalContentColor
import androidx.compose.ui.graphics.Color

// Native adaptation of the Stitch Kinetic Clinical Precision design tokens.
private val ClinicalColors = lightColorScheme(
    primary = Color(0xFF002042), onPrimary = Color.White,
    primaryContainer = Color(0xFFD4E3FF), onPrimaryContainer = Color(0xFF001C3A),
    secondary = Color(0xFF006A61), onSecondary = Color.White,
    secondaryContainer = Color(0xFF86F2E4), onSecondaryContainer = Color(0xFF005049),
    background = Color(0xFFF8F9FF), onBackground = Color(0xFF0B1C30),
    surface = Color(0xFFF8F9FF), onSurface = Color(0xFF0B1C30),
    surfaceVariant = Color(0xFFE5EEFF), onSurfaceVariant = Color(0xFF43474F)
)
@Composable fun MotivanceTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = ClinicalColors) {
        CompositionLocalProvider(LocalContentColor provides ClinicalColors.onSurface, content=content)
    }
}
