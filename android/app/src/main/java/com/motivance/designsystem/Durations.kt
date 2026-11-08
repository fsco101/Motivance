package com.motivance.designsystem

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.motivance.R
import com.motivance.domain.Seconds

/** A stored millisecond duration in everyday words: "1 second", "0.6 seconds" (issue #97). */
@Composable fun durationText(ms:Long):String=
    if(ms==1000L) stringResource(R.string.duration_one_second) else stringResource(R.string.duration_seconds,Seconds.text(ms))
