package com.motivance.designsystem

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlin.math.cos
import kotlin.math.sin

/** Page title block shared by every workspace screen. */
@Composable fun PageHeader(title: Int, subtitle: Int? = null, eyebrow: String? = null) {
    Column(Modifier.fillMaxWidth().padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (eyebrow != null) Text(eyebrow.uppercase(), style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.secondary, fontWeight = FontWeight.Bold)
        Text(stringResource(title), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.primary, modifier = Modifier.semantics { heading() })
        if (subtitle != null) Text(stringResource(subtitle), style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** A smaller heading that introduces a group of cards, with an optional trailing action. */
@Composable fun SectionHeading(title: Int, trailing: (@Composable () -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(stringResource(title), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.primary, modifier = Modifier.weight(1f).semantics { heading() })
        trailing?.invoke()
    }
}

enum class PillTone { NEUTRAL, POSITIVE, ATTENTION, PRIMARY }

@Composable fun StatusPill(text: String, tone: PillTone = PillTone.NEUTRAL, icon: ImageVector? = null) {
    val (container, content) = when (tone) {
        PillTone.POSITIVE -> MaterialTheme.colorScheme.secondaryContainer.copy(alpha = .55f) to MaterialTheme.colorScheme.onSecondaryContainer
        PillTone.ATTENTION -> MaterialTheme.colorScheme.errorContainer to MaterialTheme.colorScheme.onErrorContainer
        PillTone.PRIMARY -> MaterialTheme.colorScheme.primaryContainer to MaterialTheme.colorScheme.onPrimaryContainer
        PillTone.NEUTRAL -> MaterialTheme.colorScheme.surfaceContainer to MaterialTheme.colorScheme.onSurfaceVariant
    }
    Surface(color = container, contentColor = content, shape = CircleShape) {
        Row(Modifier.padding(horizontal = 10.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (icon != null) Icon(icon, null, Modifier.size(14.dp))
            Text(text, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, maxLines = 1,
                overflow = TextOverflow.Ellipsis)
        }
    }
}

/** Rounded tinted square holding an icon; used to anchor cards and list rows. */
@Composable fun IconBadge(icon: ImageVector, tint: Color = MaterialTheme.colorScheme.secondary, size: Int = 44) {
    Surface(color = tint.copy(alpha = .1f), shape = RoundedCornerShape(14.dp), modifier = Modifier.size(size.dp)) {
        Box(contentAlignment = Alignment.Center) { Icon(icon, null, tint = tint, modifier = Modifier.size((size * .55f).dp)) }
    }
}

/**
 * A card-sized radio option. Title and description merge into one accessible node so the whole tile
 * reads and responds as a single choice.
 */
@Composable fun SelectionTile(
    selected: Boolean, onClick: () -> Unit, title: String, modifier: Modifier = Modifier,
    description: String? = null, enabled: Boolean = true, leading: (@Composable () -> Unit)? = null,
) {
    val border = if (selected) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.outlineVariant
    Surface(
        modifier.selectable(selected, enabled = enabled, role = Role.RadioButton, onClick = onClick),
        shape = MaterialTheme.shapes.medium,
        color = if (selected) MaterialTheme.colorScheme.secondaryContainer.copy(alpha = .28f) else MaterialTheme.colorScheme.surface,
        border = BorderStroke(if (selected) 2.dp else 1.dp, border),
    ) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 14.dp).heightIn(min = 28.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            leading?.invoke()
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(title, style = MaterialTheme.typography.titleMedium,
                    color = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.outline)
                if (description != null) Text(description, style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            if (selected) Icon(Icons.Default.CheckCircle, null, tint = MaterialTheme.colorScheme.secondary, modifier = Modifier.size(22.dp))
            else Spacer(Modifier.size(22.dp))
        }
    }
}

/** A card introduced by a numbered step marker, for long forms split into stages. */
@Composable fun StepCard(number: Int, title: Int, help: Int? = null, complete: Boolean = false,
    content: @Composable ColumnScope.() -> Unit) {
    ClinicalCard {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Surface(shape = CircleShape, modifier = Modifier.size(32.dp),
                color = if (complete) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.primaryContainer,
                contentColor = if (complete) MaterialTheme.colorScheme.onSecondary else MaterialTheme.colorScheme.onPrimaryContainer) {
                Box(contentAlignment = Alignment.Center) {
                    if (complete) Icon(Icons.Default.CheckCircle, null, Modifier.size(20.dp))
                    else Text(number.toString(), style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
                }
            }
            Text(stringResource(title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.primary, modifier = Modifier.weight(1f).semantics { heading() })
        }
        if (help != null) Text(stringResource(help), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        content()
    }
}

/** Label above value, merged for screen readers. */
@Composable fun DetailRow(label: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier.semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
    }
}

/**
 * Semicircular protractor showing the 0–180° joint range with the prescribed band highlighted.
 * Values outside the valid range are clamped for drawing only.
 */
@Composable fun RangeArc(low: Double?, high: Double?, description: String, modifier: Modifier = Modifier) {
    val track = MaterialTheme.colorScheme.surfaceContainerHigh
    val band = MaterialTheme.colorScheme.secondary
    val tick = MaterialTheme.colorScheme.outline
    val marker = MaterialTheme.colorScheme.primary
    Canvas(modifier.fillMaxWidth().aspectRatio(2.1f).semantics { contentDescription = description }) {
        val stroke = 18.dp.toPx()
        val radius = minOf(size.width / 2, size.height) - stroke
        val center = Offset(size.width / 2, size.height - stroke / 2)
        val topLeft = Offset(center.x - radius, center.y - radius)
        val arc = Size(radius * 2, radius * 2)
        drawArc(track, 180f, 180f, false, topLeft, arc, style = Stroke(stroke, cap = StrokeCap.Round))
        fun point(degrees: Double, distance: Float): Offset {
            val radians = Math.toRadians(180.0 + degrees)
            return Offset(center.x + distance * cos(radians).toFloat(), center.y + distance * sin(radians).toFloat())
        }
        listOf(0.0, 45.0, 90.0, 135.0, 180.0).forEach {
            drawLine(tick, point(it, radius - stroke * 1.1f), point(it, radius - stroke * .75f), 2.dp.toPx(), StrokeCap.Round)
        }
        if (low != null && high != null && high > low) {
            val from = low.coerceIn(0.0, 180.0); val to = high.coerceIn(0.0, 180.0)
            drawArc(band, 180f + from.toFloat(), (to - from).toFloat(), false, topLeft, arc, style = Stroke(stroke, cap = StrokeCap.Butt))
            listOf(from, to).forEach {
                drawLine(marker, center, point(it, radius - stroke * 1.4f), 3.dp.toPx(), StrokeCap.Round)
                drawCircle(marker, stroke * .42f, point(it, radius))
            }
        }
        drawCircle(marker, 6.dp.toPx(), center)
    }
}
