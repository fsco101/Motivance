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
@Composable fun LanguagePicker() {
    val context=LocalContext.current
    Column {
        Text(stringResource(R.string.language_label))
        Row(Modifier.fillMaxWidth()) {
            listOf("en" to "English","fil" to "Filipino").forEach {(tag,label) ->
                TextButton({context.getSharedPreferences("appearance",Context.MODE_PRIVATE).edit().putString("language",tag).commit();(context as? Activity)?.recreate()}) {Text(label)}
            }
        }
    }
}
