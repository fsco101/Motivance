package com.motivance.designsystem

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.stringResource
import com.motivance.R
import java.time.*
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

fun displayDate(value:String):String=runCatching {
    LocalDate.parse(value).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(Locale.getDefault()))
}.getOrDefault(value)

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun DateInput(label:Int,value:String,enabled:Boolean=true,birthdate:Boolean=false,onChange:(String)->Unit) {
    var open by remember {mutableStateOf(false)}
    val title=stringResource(label)
    OutlinedTextField(displayDate(value),{},readOnly=true,enabled=enabled,label={Text(title)},modifier=Modifier.fillMaxWidth(),
        placeholder={Text(stringResource(R.string.form_choose_date))},
        trailingIcon={IconButton({open=true},enabled=enabled) {Icon(Icons.Default.DateRange,title)}},
        supportingText={Text(stringResource(if(birthdate) R.string.form_birthdate_help else R.string.history_date_help))})
    if(open) {
        val today=LocalDate.now()
        val state=rememberDatePickerState(initialSelectedDateMillis=runCatching {LocalDate.parse(value).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()}.getOrNull(),
            yearRange=if(birthdate) (today.year-120)..today.year else 1900..(today.year+10),
            selectableDates=object:SelectableDates {
                override fun isSelectableDate(utcTimeMillis:Long):Boolean {
                    val date=Instant.ofEpochMilli(utcTimeMillis).atZone(ZoneOffset.UTC).toLocalDate()
                    return !birthdate || (date<=today && date>=today.minusYears(120))
                }
            })
        DatePickerDialog(onDismissRequest={open=false},confirmButton={TextButton({
            state.selectedDateMillis?.let {onChange(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString())};open=false
        },enabled=state.selectedDateMillis!=null) {Text(stringResource(R.string.confirm_action))}},dismissButton={TextButton({open=false}) {Text(stringResource(R.string.cancel_action))}}) {
            DatePicker(state,title={Text(title,Modifier.padding(24.dp))})
        }
    }
}
