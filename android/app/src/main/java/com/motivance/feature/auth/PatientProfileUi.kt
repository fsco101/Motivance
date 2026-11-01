package com.motivance.feature.auth

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.motivance.R
import com.motivance.domain.*
import com.motivance.designsystem.*
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

@Composable fun ProfileAvatar(p:PatientProfile) {
    Surface(shape=CircleShape,color=MaterialTheme.colorScheme.secondaryContainer) {
        Icon(when(p.avatar) {"star"->Icons.Default.Star;"heart"->Icons.Default.Favorite;else->Icons.Default.Person},
            stringResource(R.string.profile_avatar),modifier=Modifier.padding(14.dp).size(32.dp),tint=MaterialTheme.colorScheme.secondary)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable fun ColumnScope.ProfileFields(p:PatientProfile,enabled:Boolean,onChange:(PatientProfile)->Unit) {
    @Composable fun section(title:Int,description:Int) {
        HorizontalDivider(color=MaterialTheme.colorScheme.outlineVariant)
        Text(stringResource(title),style=MaterialTheme.typography.titleMedium,color=MaterialTheme.colorScheme.primary)
        Text(stringResource(description),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    }
    @Composable fun field(label:Int,value:String,error:Int?,type:KeyboardType=KeyboardType.Text,help:Int?=null,change:(String)->PatientProfile) {
        var touched by remember {mutableStateOf(false)}
        var focused by remember {mutableStateOf(false)}
        val showError=error!=null && (touched || value.isNotEmpty())
        OutlinedTextField(value,{touched=true;onChange(change(it))},enabled=enabled,label={Text(stringResource(label))},
            isError=showError,supportingText={if(showError)Text(stringResource(error!!)) else if(help!=null)Text(stringResource(help))},
            modifier=Modifier.fillMaxWidth().onFocusChanged {if(focused && !it.isFocused)touched=true;focused=it.isFocused},
            shape=MaterialTheme.shapes.small,keyboardOptions=KeyboardOptions(keyboardType=type),singleLine=label!=R.string.profile_address)
    }
    section(R.string.form_identity,R.string.form_identity_help)
    field(R.string.profile_first_name,p.firstName,if(validName(p.firstName))null else R.string.form_name_error) {p.copy(firstName=it)}
    field(R.string.profile_last_name,p.lastName,if(validName(p.lastName))null else R.string.form_name_error) {p.copy(lastName=it)}
    DateInput(R.string.profile_birthdate,p.birthdate,enabled=enabled,birthdate=true) {onChange(p.copy(birthdate=it))}
    if(p.age!=null) SuggestionChip(onClick={},label={Text(stringResource(R.string.profile_age,p.age.toString()))})
    Text(stringResource(R.string.profile_gender),style=MaterialTheme.typography.labelLarge)
    FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
        listOf("female" to R.string.profile_female,"male" to R.string.profile_male,"nonbinary" to R.string.profile_nonbinary,"prefer_not_to_say" to R.string.profile_private).forEach {(key,label)->
            FilterChip(p.gender==key,{onChange(p.copy(gender=key))},enabled=enabled,label={Text(stringResource(label))})
        }
    }
    section(R.string.form_contact,R.string.form_contact_help)
    field(R.string.profile_address,p.address,if(p.address.trim().length in 5..500)null else R.string.form_address_error) {p.copy(address=it)}
    field(R.string.profile_contact,p.contact,if(validContact(p.contact))null else R.string.form_phone_error,KeyboardType.Phone, R.string.form_phone_help) {p.copy(contact=it)}
    section(R.string.form_account,R.string.form_account_help)
    field(R.string.profile_username,p.username,when {UsernamePolicy.blocked(p.username)->R.string.form_username_blocked;!UsernamePolicy.allowed(p.username)->R.string.form_username_error;else->null},help=R.string.profile_username_help) {p.copy(username=it)}
    Text(stringResource(R.string.profile_avatar),style=MaterialTheme.typography.labelLarge)
    FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
        listOf("person" to R.string.profile_person,"star" to R.string.profile_star,"heart" to R.string.profile_heart).forEach {(key,label)->
            FilterChip(p.avatar==key,{onChange(p.copy(avatar=key))},enabled=enabled,label={Text(stringResource(label))})
        }
    }
    ProfileAvatar(p)
}

@Composable fun PrivacyAgreement(accepted:Boolean,enabled:Boolean,onChange:(Boolean)->Unit) {
    Column(verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.profile_privacy_title),style=MaterialTheme.typography.titleMedium)
        Text(stringResource(R.string.profile_privacy_text),style=MaterialTheme.typography.bodyMedium)
        Row(verticalAlignment=Alignment.CenterVertically,modifier=Modifier.toggleable(value=accepted,enabled=enabled,role=Role.Checkbox,onValueChange=onChange)) {
            Checkbox(accepted,null,enabled=enabled)
            Text(stringResource(R.string.profile_agree),modifier=Modifier.weight(1f))
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable fun PatientProfileSummary(p:PatientProfile) {
    ClinicalCard {
        Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(16.dp)) {
            ProfileAvatar(p)
            Column(Modifier.weight(1f)) {
                Text("@"+p.username,style=MaterialTheme.typography.titleLarge)
                Text(p.displayName,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        HorizontalDivider()
        @Composable fun detail(label:Int,value:String) {
            Column(verticalArrangement=Arrangement.spacedBy(4.dp)) {
                Text(stringResource(label),style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
                Text(value,style=MaterialTheme.typography.bodyLarge)
            }
        }
        Text(stringResource(R.string.profile_age,p.age?.toString() ?: "--"),style=MaterialTheme.typography.titleMedium)
        detail(R.string.profile_gender,stringResource(when(p.gender) {"female"->R.string.profile_female;"male"->R.string.profile_male;"nonbinary"->R.string.profile_nonbinary;else->R.string.profile_private}))
        detail(R.string.profile_birthdate,displayDate(p.birthdate))
        detail(R.string.profile_address,p.address)
        detail(R.string.profile_contact,p.contact)
    }
}

data class ProfileState(val owner:String="",val profile:PatientProfile?=null,val busy:Boolean=false,val failed:Boolean=false,val message:Int?=null)
@HiltViewModel class PatientProfileViewModel @Inject constructor(private val repository:AuthRepository):ViewModel() {
    private val mutable=MutableStateFlow(ProfileState());val state=mutable.asStateFlow()
    private var job:Job?=null
    private var generation=0
    fun configure(owner:String?) {if(owner.orEmpty()==mutable.value.owner)return;generation++;job?.cancel();mutable.value=ProfileState(owner=owner.orEmpty());if(owner!=null)refresh()}
    fun refresh()=perform {repository.loadProfile()}
    fun save(p:PatientProfile)=perform(R.string.profile_saved) {repository.saveProfile(p);repository.loadProfile()}
    fun password(old:String,new:String)=perform(R.string.profile_password_saved) {repository.changePassword(old,new);repository.loadProfile()}
    private fun perform(message:Int?=null,action:suspend ()->PatientProfile) {
        if(mutable.value.owner.isBlank() || mutable.value.busy)return
        val ticket=++generation
        mutable.value=mutable.value.copy(busy=true,failed=false,message=null)
        job=viewModelScope.launch {
            try {val p=action();if(ticket==generation)mutable.value=mutable.value.copy(profile=p,busy=false,message=message)}
            catch(e:CancellationException){throw e}
            catch(_:Exception){if(ticket==generation)mutable.value=mutable.value.copy(busy=false,failed=true)}
        }
    }
}

@Composable fun ColumnScope.PatientProfileEditor(vm:PatientProfileViewModel,onSaved:()->Unit) {
    val state by vm.state.collectAsStateWithLifecycle()
    if(state.busy) LoadingNotice(R.string.profile_loading)
    if(state.failed) FeedbackNotice(R.string.profile_failed,error=true,retry={vm.refresh()})
    state.message?.let {FeedbackNotice(it)}
    LaunchedEffect(state.message) {if(state.message==R.string.profile_saved)onSaved()}
    state.profile?.let {loaded -> key(loaded) {
        var draft by remember {mutableStateOf(loaded)}
        var editing by remember {mutableStateOf(false)}
        Text(stringResource(R.string.email),style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
        Text(loaded.email,style=MaterialTheme.typography.titleMedium)
        Text(stringResource(R.string.profile_email_fixed),style=MaterialTheme.typography.bodySmall)
        if(!editing && loaded.username.isNotBlank()) PatientProfileSummary(loaded)
        ActionButton(if(editing) R.string.cancel_action else R.string.profile_edit,{editing=!editing;draft=loaded},outlined=true,enabled=!state.busy)
        if(editing || loaded.username.isBlank()) ClinicalCard {
            ProfileFields(draft,!state.busy) {draft=it}
            if(!loaded.consent) PrivacyAgreement(draft.consent,!state.busy) {draft=draft.copy(consent=it)}
            Text(stringResource(R.string.profile_validation),style=MaterialTheme.typography.bodySmall)
            ActionButton(R.string.profile_save,{vm.save(draft)},enabled=draft.valid() && !state.busy,busy=state.busy,busyLabel=R.string.profile_loading)
        }
    }}
    var changing by remember {mutableStateOf(false)}
    ActionButton(R.string.profile_change_password,{changing=!changing},outlined=true,enabled=!state.busy)
    if(changing) key(state.message) {
        var old by remember {mutableStateOf("")};var new by remember {mutableStateOf("")};var confirmation by remember {mutableStateOf("")}
        ClinicalCard {
            listOf(Triple(R.string.profile_current_password,old,{v:String->old=v}),Triple(R.string.auth_new_password,new,{v:String->new=v}),Triple(R.string.profile_confirm_password,confirmation,{v:String->confirmation=v})).forEach {(label,value,set)->
                OutlinedTextField(value,set,enabled=!state.busy,label={Text(stringResource(label))},isError=label==R.string.profile_confirm_password && value.isNotEmpty() && value!=new,
                    supportingText={if(label==R.string.profile_confirm_password && value.isNotEmpty() && value!=new)Text(stringResource(R.string.form_password_match)) else if(label==R.string.auth_new_password && value.isNotEmpty() && value.length<8)Text(stringResource(R.string.form_password_length))},
                    visualTransformation=PasswordVisualTransformation(),singleLine=true,keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Password),modifier=Modifier.fillMaxWidth())
            }
            Text(stringResource(R.string.profile_password_help),style=MaterialTheme.typography.bodySmall)
            ActionButton(R.string.profile_change_password,{vm.password(old,new);old="";new="";confirmation=""},enabled=!state.busy && old.isNotBlank() && new.length>=8 && new==confirmation && old!=new,busy=state.busy,busyLabel=R.string.profile_loading)
        }
    }
}
