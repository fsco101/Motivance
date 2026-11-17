package com.motivance.feature.auth

import android.graphics.Bitmap
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import com.motivance.R

/**
 * Lets the person choose which square of their picture becomes the photo, as the web app does: drag to move, pinch or the
 * slider to zoom, and TalkBack actions to move. The circle shows what avatars will show; the corners outside it are kept too.
 */
@Composable internal fun PhotoCropDialog(photo:Bitmap,busy:Boolean,onCancel:()->Unit,onConfirm:(PhotoCrop)->Unit) {
    val image=remember(photo) {photo.asImageBitmap()}
    val width=photo.width;val height=photo.height
    var crop by remember(photo) {mutableStateOf(initialCrop(width,height))}
    var viewport by remember {mutableFloatStateOf(1f)}
    val step={dx:Float,dy:Float -> crop=panCrop(width,height,crop,dx*viewport/10,dy*viewport/10,viewport);true}
    val moves=listOf(R.string.profile_crop_move_left to (1f to 0f),R.string.profile_crop_move_right to (-1f to 0f),
        R.string.profile_crop_move_up to (0f to 1f),R.string.profile_crop_move_down to (0f to -1f))
        .map {(label,shift) -> CustomAccessibilityAction(stringResource(label)) {step(shift.first,shift.second)}}
    val area=stringResource(R.string.profile_crop_area)
    val zoomLabel=stringResource(R.string.profile_crop_zoom)
    AlertDialog(onDismissRequest={if(!busy) onCancel()},
        title={Text(stringResource(R.string.profile_crop_title))},
        text={
            Column(horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(12.dp)) {
                Text(stringResource(R.string.profile_crop_help),style=MaterialTheme.typography.bodyMedium)
                Canvas(Modifier.widthIn(max=320.dp).fillMaxWidth().aspectRatio(1f).clip(MaterialTheme.shapes.medium)
                    .onSizeChanged {viewport=it.width.toFloat().coerceAtLeast(1f)}
                    .pointerInput(photo) {
                        detectTransformGestures {_,pan,zoom,_ ->
                            crop=panCrop(width,height,zoomCrop(width,height,crop,crop.zoom*zoom),pan.x,pan.y,size.width.toFloat())
                        }
                    }
                    .semantics {contentDescription=area;customActions=moves}) {
                    val source=cropPixels(width,height,crop)
                    drawImage(image,srcOffset=IntOffset(source.left,source.top),srcSize=IntSize(source.side,source.side),
                        dstSize=IntSize(size.width.toInt(),size.height.toInt()),filterQuality=FilterQuality.High)
                    // Shade the corners avatars do not show, and outline the circle they do.
                    val radius=size.minDimension/2-2.dp.toPx()
                    val hole=Path().apply {fillType=PathFillType.EvenOdd;addRect(Rect(0f,0f,size.width,size.height));addOval(Rect(center,radius))}
                    drawPath(hole,Color(0x800F172A))
                    drawCircle(Color.White.copy(alpha=0.9f),radius,style=Stroke(2.dp.toPx()))
                }
                Row(Modifier.widthIn(max=320.dp).fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                    Text("−",Modifier.clearAndSetSemantics {},style=MaterialTheme.typography.titleLarge,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    Slider(crop.zoom,{crop=zoomCrop(width,height,crop,it)},Modifier.weight(1f).semantics {contentDescription=zoomLabel},
                        enabled=!busy,valueRange=1f..MAX_ZOOM)
                    Text("+",Modifier.clearAndSetSemantics {},style=MaterialTheme.typography.titleLarge,color=MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        },
        confirmButton={
            TextButton({onConfirm(crop)},Modifier.heightIn(min=48.dp),enabled=!busy) {
                Text(stringResource(if(busy) R.string.profile_crop_preparing else R.string.profile_crop_use))
            }
        },
        dismissButton={TextButton(onCancel,Modifier.heightIn(min=48.dp),enabled=!busy) {Text(stringResource(R.string.cancel_action))}})
}
