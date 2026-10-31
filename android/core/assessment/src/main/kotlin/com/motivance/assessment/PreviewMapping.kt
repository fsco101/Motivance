package com.motivance.assessment

import com.motivance.domain.Landmark
import kotlin.math.min

/** FIT_CENTER transform shared by the rendered frame and its landmark overlay. */
data class PreviewMapping(val frameWidth: Int, val frameHeight: Int, val viewWidth: Float, val viewHeight: Float, val mirror: Boolean) {
    init { require(frameWidth > 0 && frameHeight > 0 && viewWidth > 0 && viewHeight > 0) }
    private val scale = min(viewWidth / frameWidth, viewHeight / frameHeight)
    val width = frameWidth * scale
    val height = frameHeight * scale
    val left = (viewWidth - width) / 2
    val top = (viewHeight - height) / 2
    fun map(point: Landmark): Pair<Float, Float> = (left + (if (mirror) 1 - point.x else point.x) * width) to (top + point.y * height)
}
