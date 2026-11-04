package com.motivance.designsystem

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.motivance.R

/**
 * The standard content surface. [accent] tints the outline for a card that needs to stand apart
 * (a review step, a hero choice) without adding decoration.
 */
@Composable fun ClinicalCard(modifier: Modifier = Modifier, accent: Color? = null, content: @Composable ColumnScope.() -> Unit) {
    Surface(modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.surface, shape = MaterialTheme.shapes.large,
        border = BorderStroke(if (accent != null) 1.5.dp else 1.dp, accent?.copy(alpha = .45f) ?: MaterialTheme.colorScheme.outlineVariant)) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp), content = content)
    }
}

@Composable fun ActionButton(label: Int, onClick: () -> Unit, modifier: Modifier = Modifier,
    busy: Boolean = false, busyLabel: Int = R.string.ui_working, enabled: Boolean = true, outlined: Boolean = false) {
    val layout = modifier.fillMaxWidth().heightIn(min = 56.dp)
    val body: @Composable RowScope.() -> Unit = {
        AnimatedContent(busy, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "busy") { working ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (working) {
                    CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = LocalContentColor.current,
                        trackColor = LocalContentColor.current.copy(alpha = .15f))
                    Spacer(Modifier.width(12.dp))
                }
                Text(stringResource(if (working) busyLabel else label), textAlign = TextAlign.Center,
                    modifier = Modifier.weight(1f, fill = false).semantics { liveRegion = LiveRegionMode.Polite })
            }
        }
    }
    if (outlined) OutlinedButton(onClick, layout, enabled = enabled && !busy, shape = MaterialTheme.shapes.medium,
        border = BorderStroke(1.dp, if (enabled && !busy) MaterialTheme.colorScheme.outline.copy(alpha = .6f) else MaterialTheme.colorScheme.outlineVariant),
        contentPadding = PaddingValues(16.dp), content = body)
    else Button(onClick, layout, enabled = enabled && !busy, shape = MaterialTheme.shapes.medium,
        contentPadding = PaddingValues(16.dp), content = body)
}

@Composable fun LoadingNotice(label: Int) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainer.copy(alpha = .6f), shape = MaterialTheme.shapes.medium) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp).semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            CircularProgressIndicator(Modifier.size(20.dp), color = MaterialTheme.colorScheme.primary, strokeWidth = 2.dp,
                trackColor = MaterialTheme.colorScheme.primary.copy(alpha = .12f))
            Text(stringResource(label), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable fun FeedbackNotice(message: Int, error: Boolean = false, retry: (() -> Unit)? = null) {
    Surface(color = if (error) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.secondaryContainer.copy(alpha = .6f),
        shape = MaterialTheme.shapes.medium) {
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 12.dp, bottom = 12.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(Modifier.weight(1f).semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
                horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(if (error) Icons.Default.Warning else Icons.Default.CheckCircle, null, Modifier.size(20.dp),
                    tint = if (error) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.secondary)
                Text(stringResource(message), style = MaterialTheme.typography.bodyMedium,
                    color = if (error) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSecondaryContainer)
            }
            if (retry != null) TextButton(retry, Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.retry)) }
        }
    }
}

/** An empty screen is an invitation to act: an unfilled arc, a plain explanation, and the next step. */
@Composable fun EmptyState(title: Int, description: Int, action: (@Composable () -> Unit)? = null) {
    Surface(Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.surfaceContainerLow, shape = MaterialTheme.shapes.large,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
        Column(Modifier.padding(horizontal = 24.dp, vertical = 28.dp), horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp)) {
            MotionArc(0f, Modifier.size(64.dp), stroke = 6f) {
                Icon(Icons.Default.Info, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(24.dp))
            }
            Text(stringResource(title), style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
            Text(stringResource(description), style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            action?.invoke()
        }
    }
}
