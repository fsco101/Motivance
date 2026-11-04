package com.motivance.designsystem

import android.app.Activity
import android.content.Context
import android.content.res.Configuration
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.motivance.R
import java.util.Locale

object AppLanguage {
    fun wrap(context:Context):Context {
        val language=context.getSharedPreferences("appearance",Context.MODE_PRIVATE).getString("language",null) ?: return context
        val locale=Locale.forLanguageTag(language)
        val config=Configuration(context.resources.configuration).apply {setLocale(locale)}
        Locale.setDefault(locale)
        return context.createConfigurationContext(config)
    }
}

/** Two-way language switch; the current language is shown as selected so the control reads as a setting. */
@Composable fun LanguagePicker(modifier:Modifier=Modifier) {
    val context=LocalContext.current
    val haptics=rememberHaptics()
    val current=context.getSharedPreferences("appearance",Context.MODE_PRIVATE).getString("language",null)
        ?: androidx.compose.ui.platform.LocalConfiguration.current.locales[0].language.let {if(it=="fil" || it=="tl") "fil" else "en"}
    Column(modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.language_label),style=MaterialTheme.typography.labelLarge,color=MaterialTheme.colorScheme.onSurfaceVariant)
        val options=listOf("en" to "English","fil" to "Filipino")
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            options.forEachIndexed {index,(tag,label) ->
                SegmentedButton(selected=current==tag,onClick={
                    if(current!=tag) {
                        haptics.tick()
                        context.getSharedPreferences("appearance",Context.MODE_PRIVATE).edit().putString("language",tag).commit()
                        (context as? Activity)?.recreate()
                    }
                },shape=SegmentedButtonDefaults.itemShape(index,options.size),modifier=Modifier.heightIn(min=48.dp)) {Text(label)}
            }
        }
    }
}
