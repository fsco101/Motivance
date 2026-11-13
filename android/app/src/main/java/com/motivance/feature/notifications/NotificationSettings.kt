package com.motivance.feature.notifications

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.motivance.R
import com.motivance.designsystem.*
import com.motivance.domain.*
import dagger.hilt.android.lifecycle.HiltViewModel
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import javax.inject.Inject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class NotificationSettingsState(
    val owner:String="",val settings:NotificationSettings=NotificationSettings(),val loading:Boolean=false,val loaded:Boolean=false,val failed:Boolean=false,
    val saving:Boolean=false,
)

/** One save at a time, and the switches wait for it, so what they show is always what the server holds. */
@HiltViewModel class NotificationSettingsViewModel @Inject constructor(private val repository:NotificationRepository,private val toasts:Toaster=Toaster()):ViewModel() {
    private val mutable=MutableStateFlow(NotificationSettingsState())
    val state=mutable.asStateFlow()
    private var job:Job?=null

    fun configure(owner:String?) {
        if(mutable.value.owner==owner.orEmpty()) return
        job?.cancel()
        mutable.value=NotificationSettingsState(owner=owner.orEmpty())
    }

    fun load() {
        val owner=mutable.value.owner
        if(owner.isBlank() || mutable.value.loading || mutable.value.saving) return
        mutable.value=mutable.value.copy(loading=true,failed=false)
        job=viewModelScope.launch {
            try {
                val settings=repository.loadNotificationSettings()
                if(mutable.value.owner==owner) mutable.value=mutable.value.copy(settings=settings,loading=false,loaded=true)
            } catch(e:CancellationException) {throw e}
            catch(_:Exception) {if(mutable.value.owner==owner) mutable.value=mutable.value.copy(loading=false,failed=true)}
        }
    }

    fun toggle(group:NotificationGroup,on:Boolean)=save(mutable.value.settings.with(group,on))

    fun setReminder(time:String) {if(NotificationSettings.validTime(time)) save(mutable.value.settings.copy(reminderTime=time))}

    /** The switch moves at once. A failed save puts it back and says so. */
    private fun save(next:NotificationSettings) {
        val current=mutable.value
        if(current.owner.isBlank() || !current.loaded || current.saving || next==current.settings) return
        val before=current.settings
        mutable.value=current.copy(settings=next,saving=true)
        job=viewModelScope.launch {
            try {
                val saved=repository.saveNotificationSettings(next)
                if(mutable.value.owner==current.owner) mutable.value=mutable.value.copy(settings=saved,saving=false)
            } catch(e:CancellationException) {throw e}
            catch(_:Exception) {
                if(mutable.value.owner==current.owner) {
                    mutable.value=mutable.value.copy(settings=before,saving=false)
                    toasts.show(R.string.notification_settings_failed,ToastTone.ERROR)
                }
            }
        }
    }
}

@Composable private fun groupTitle(group:NotificationGroup)=stringResource(when(group) {
    NotificationGroup.BOOKINGS -> R.string.notification_settings_bookings
    NotificationGroup.EXERCISE_PLAN -> R.string.notification_settings_exercise_plan
    NotificationGroup.SESSION_RESULTS -> R.string.notification_settings_session_results
    NotificationGroup.INACTIVITY -> R.string.notification_settings_inactivity
    NotificationGroup.CARE_TEAM -> R.string.notification_settings_care_team
    NotificationGroup.PRACTICE -> R.string.notification_settings_practice
})

@Composable private fun groupDetail(group:NotificationGroup)=stringResource(when(group) {
    NotificationGroup.BOOKINGS -> R.string.notification_settings_bookings_detail
    NotificationGroup.EXERCISE_PLAN -> R.string.notification_settings_exercise_plan_detail
    NotificationGroup.SESSION_RESULTS -> R.string.notification_settings_session_results_detail
    NotificationGroup.INACTIVITY -> R.string.notification_settings_inactivity_detail
    NotificationGroup.CARE_TEAM -> R.string.notification_settings_care_team_detail
    NotificationGroup.PRACTICE -> R.string.notification_settings_practice_detail
})

/** "18:00" as this phone writes a time, such as 6:00 PM. */
internal fun reminderLabel(value:String):String=runCatching {LocalTime.parse(value).format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT))}.getOrDefault(value)

/** The whole row toggles, so the switch, title and explanation read as one control. */
@Composable private fun GroupSwitch(group:NotificationGroup,checked:Boolean,enabled:Boolean,onToggle:(Boolean)->Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min=48.dp).toggleable(checked,enabled=enabled,role=Role.Switch) {onToggle(it)}.padding(vertical=4.dp),
        verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
        Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(2.dp)) {
            Text(groupTitle(group),style=MaterialTheme.typography.bodyLarge)
            Text(groupDetail(group),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked,null,enabled=enabled)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun ReminderTimeDialog(initial:String,dismiss:()->Unit,choose:(String)->Unit) {
    val start=runCatching {LocalTime.parse(initial)}.getOrDefault(LocalTime.of(18,0))
    val picker=rememberTimePickerState(start.hour,start.minute)
    AlertDialog(dismiss,title={Text(stringResource(R.string.notification_settings_pick_time))},text={TimePicker(picker)},
        confirmButton={TextButton({choose("%02d:%02d".format(picker.hour,picker.minute))}) {Text(stringResource(R.string.notification_settings_time_ok))}},
        dismissButton={TextButton(dismiss) {Text(stringResource(R.string.notification_settings_time_cancel))}})
}

/**
 * The push switches for this account's roles, on Profile. Push only exists on the phone, so the web has none of this. The bell is
 * never affected, which the card says. [pushAvailable] is false in a build with no Firebase values, and [allowed] is Android's permission.
 */
@Composable fun ColumnScope.NotificationSettingsCard(roles:Set<UserRole>,state:NotificationSettingsState,vm:NotificationSettingsViewModel,
    pushAvailable:Boolean,allowed:Boolean,askPermission:()->Unit) {
    val groups=notificationGroupsFor(roles)
    if(groups.isEmpty()) return
    LaunchedEffect(state.owner) {if(!state.loaded) vm.load()}
    var picking by remember {mutableStateOf(false)}
    SectionHeading(R.string.notification_settings_title)
    ClinicalCard {
        Text(stringResource(R.string.notification_settings_detail),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        if(!pushAvailable) FeedbackNotice(R.string.notification_settings_unavailable)
        else if(!allowed) {
            FeedbackNotice(R.string.notification_settings_blocked)
            ActionButton(R.string.notification_settings_allow,askPermission,outlined=true)
        }
        if(state.failed && !state.loaded) FeedbackNotice(R.string.notification_settings_load_failed,error=true) {vm.load()}
        if(state.loading && !state.loaded) LoadingNotice(R.string.notification_settings_title)
        if(state.loaded) groups.forEach {group ->
            key(group) {
                GroupSwitch(group,state.settings.allows(group),!state.saving) {vm.toggle(group,it)}
                val time=state.settings.reminderTime
                if(group==NotificationGroup.PRACTICE && time!=null) {
                    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                        Text(stringResource(R.string.notification_settings_practice_at,reminderLabel(time)),Modifier.weight(1f),style=MaterialTheme.typography.bodyMedium)
                        TextButton({picking=true},Modifier.heightIn(min=48.dp),enabled=!state.saving) {Text(stringResource(R.string.notification_settings_change_time))}
                    }
                    if(picking) ReminderTimeDialog(time,{picking=false}) {picking=false;vm.setReminder(it)}
                }
            }
        }
    }
}
