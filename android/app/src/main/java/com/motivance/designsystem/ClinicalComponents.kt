package com.motivance.designsystem

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Info
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

/** Shared surfaces and feedback keep every workspace on the same visual system. */
@Composable fun ClinicalCard(modifier: Modifier = Modifier, accent: Color? = null, content: @Composable ColumnScope.() -> Unit) {
    Surface(modifier.fillMaxWidth(), color=MaterialTheme.colorScheme.surface, shape=MaterialTheme.shapes.large,
        border=BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
        Column(Modifier.padding(20.dp), verticalArrangement=Arrangement.spacedBy(14.dp)) {
            if (accent != null) HorizontalDivider(Modifier.width(32.dp), thickness=4.dp, color=accent)
            content()
        }
    }
}

@Composable fun ActionButton(label: Int, onClick: () -> Unit, modifier: Modifier = Modifier,
    busy: Boolean = false, busyLabel: Int = R.string.ui_working, enabled: Boolean = true, outlined: Boolean = false) {
    val layout = modifier.fillMaxWidth().heightIn(min=56.dp)
    val body: @Composable RowScope.() -> Unit = {
        if (busy) {
            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth=2.dp, color=MaterialTheme.colorScheme.secondary,
                trackColor=MaterialTheme.colorScheme.secondary.copy(alpha=.12f))
            Spacer(Modifier.width(12.dp))
        }
        Text(stringResource(if (busy) busyLabel else label), textAlign=TextAlign.Center,
            modifier=Modifier.weight(1f, fill=false).semantics { liveRegion=LiveRegionMode.Polite })
    }
    if (outlined) OutlinedButton(onClick, layout, enabled=enabled && !busy, shape=MaterialTheme.shapes.medium,
        contentPadding=PaddingValues(16.dp), content=body)
    else Button(onClick, layout, enabled=enabled && !busy, shape=MaterialTheme.shapes.medium,
        contentPadding=PaddingValues(16.dp), content=body)
}

@Composable fun LoadingNotice(label: Int) {
    Surface(color=MaterialTheme.colorScheme.surfaceContainerLow, shape=MaterialTheme.shapes.medium) {
        Row(Modifier.fillMaxWidth().padding(16.dp).semantics(mergeDescendants=true) {liveRegion=LiveRegionMode.Polite},
            verticalAlignment=Alignment.CenterVertically, horizontalArrangement=Arrangement.spacedBy(14.dp)) {
            CircularProgressIndicator(Modifier.size(24.dp), color=MaterialTheme.colorScheme.secondary, strokeWidth=2.dp,
                trackColor=MaterialTheme.colorScheme.secondary.copy(alpha=.12f))
            Text(stringResource(label), style=MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable fun FeedbackNotice(message: Int, error: Boolean = false, retry: (() -> Unit)? = null) {
    Surface(color=if(error) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.secondaryContainer.copy(alpha=.3f),
        shape=MaterialTheme.shapes.medium) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement=Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement=Arrangement.spacedBy(12.dp), modifier=Modifier.semantics(mergeDescendants=true) {liveRegion=LiveRegionMode.Polite}) {
                Icon(if(error) Icons.Default.Info else Icons.Default.CheckCircle, null,
                    tint=if(error) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.secondary)
                Text(stringResource(message), style=MaterialTheme.typography.bodyMedium,
                    color=if(error) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSurface)
            }
            if(retry!=null) TextButton(retry) {Text(stringResource(R.string.retry))}
        }
    }
}

@Composable fun EmptyState(title: Int, description: Int) {
    ClinicalCard {
        Icon(Icons.Default.Info, null, tint=MaterialTheme.colorScheme.secondary, modifier=Modifier.size(28.dp))
        Text(stringResource(title), style=MaterialTheme.typography.titleMedium)
        Text(stringResource(description), color=MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
