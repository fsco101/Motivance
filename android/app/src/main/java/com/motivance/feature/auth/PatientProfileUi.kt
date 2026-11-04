package com.motivance.feature.auth

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
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
        Icon(avatarIcon(p.avatar),
            stringResource(R.string.profile_avatar),modifier=Modifier.padding(14.dp).size(32.dp),tint=MaterialTheme.colorScheme.secondary)
    }
}

/**
 * One profile text field. Errors appear after the field is edited or left, or immediately when
 * [showErrors] is set (for example after an attempt to continue past an incomplete signup step).
 */
@Composable private fun ProfileTextField(
    label:Int,value:String,error:Int?,enabled:Boolean,showErrors:Boolean,
    type:KeyboardType=KeyboardType.Text,help:Int?=null,capitalization:KeyboardCapitalization=KeyboardCapitalization.None,
    multiline:Boolean=false,leading:ImageVector?=null,onValue:(String)->Unit,
) {
    var touched by remember {mutableStateOf(false)}
    var focused by remember {mutableStateOf(false)}
    val showError=error!=null && (touched || value.isNotEmpty() || showErrors)
    OutlinedTextField(value,{touched=true;onValue(it)},enabled=enabled,label={Text(stringResource(label))},
        leadingIcon=leading?.takeIf {fieldIconsFit()}?.let {icon -> {Icon(icon,null)}},
        isError=showError,supportingText={if(showError)Text(stringResource(error!!)) else if(help!=null)Text(stringResource(help))},
        modifier=Modifier.fillMaxWidth().onFocusChanged {if(focused && !it.isFocused)touched=true;focused=it.isFocused},
        shape=RoundedCornerShape(12.dp),singleLine=!multiline,minLines=if(multiline) 2 else 1,maxLines=if(multiline) 4 else 1,
        keyboardOptions=KeyboardOptions(keyboardType=type,capitalization=capitalization,imeAction=if(multiline) ImeAction.Default else ImeAction.Next))
}

@Composable private fun FormSection(title:Int,description:Int) {
    HorizontalDivider(color=MaterialTheme.colorScheme.outlineVariant)
    Text(stringResource(title),style=MaterialTheme.typography.titleMedium,color=MaterialTheme.colorScheme.primary)
    Text(stringResource(description),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
}

/** First/last name, birthdate with derived age, and gender. */
@OptIn(ExperimentalLayoutApi::class)
@Composable fun ColumnScope.PersonalFields(p:PatientProfile,enabled:Boolean,showErrors:Boolean=false,onChange:(PatientProfile)->Unit) {
    ProfileTextField(R.string.profile_first_name,p.firstName,if(validName(p.firstName))null else R.string.form_name_error,enabled,showErrors,
        capitalization=KeyboardCapitalization.Words) {onChange(p.copy(firstName=it))}
    ProfileTextField(R.string.profile_last_name,p.lastName,if(validName(p.lastName))null else R.string.form_name_error,enabled,showErrors,
        capitalization=KeyboardCapitalization.Words) {onChange(p.copy(lastName=it))}
    DateInput(R.string.profile_birthdate,p.birthdate,enabled=enabled,birthdate=true) {onChange(p.copy(birthdate=it))}
    if(p.age!=null) Text(stringResource(R.string.profile_age,p.age.toString()),style=MaterialTheme.typography.titleSmall,
        color=MaterialTheme.colorScheme.secondary,modifier=Modifier.semantics {liveRegion=LiveRegionMode.Polite})
    else if(showErrors) Text(stringResource(R.string.form_birthdate_required),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.error)
    Text(stringResource(R.string.profile_gender),style=MaterialTheme.typography.labelLarge)
    FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp),verticalArrangement=Arrangement.spacedBy(4.dp)) {
        listOf("female" to R.string.profile_female,"male" to R.string.profile_male,"nonbinary" to R.string.profile_nonbinary,"prefer_not_to_say" to R.string.profile_private).forEach {(key,label)->
            FilterChip(p.gender==key,{onChange(p.copy(gender=key))},enabled=enabled,label={Text(stringResource(label))},
                leadingIcon=if(p.gender==key) {{Icon(Icons.Default.Check,null,Modifier.size(18.dp))}} else null)
        }
    }
    if(showErrors && p.gender !in PatientProfile.GENDERS) Text(stringResource(R.string.form_gender_required),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.error)
}

/** Address and contact number. */
@Composable fun ColumnScope.ContactFields(p:PatientProfile,enabled:Boolean,showErrors:Boolean=false,onChange:(PatientProfile)->Unit) {
    ProfileTextField(R.string.profile_address,p.address,if(validAddress(p.address))null else R.string.form_address_error,enabled,showErrors,
        capitalization=KeyboardCapitalization.Words,multiline=true) {onChange(p.copy(address=it))}
    ProfileTextField(R.string.profile_contact,p.contact,if(validContact(p.contact))null else R.string.form_phone_error,enabled,showErrors,
        KeyboardType.Phone,R.string.form_phone_help,leading=Icons.Default.Phone) {onChange(p.copy(contact=it))}
}

/** Username and a selectable avatar tile row (the tiles are the preview). */
@Composable fun ColumnScope.IdentityFields(p:PatientProfile,enabled:Boolean,showErrors:Boolean=false,onChange:(PatientProfile)->Unit) {
    ProfileTextField(R.string.profile_username,p.username,when {UsernamePolicy.blocked(p.username)->R.string.form_username_blocked;!UsernamePolicy.allowed(p.username)->R.string.form_username_error;else->null},
        enabled,showErrors,KeyboardType.Ascii,R.string.profile_username_help,leading=Icons.Default.AccountCircle) {onChange(p.copy(username=it.trim()))}
    Text(stringResource(R.string.profile_avatar),style=MaterialTheme.typography.labelLarge)
    Row(Modifier.fillMaxWidth().selectableGroup(),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
        listOf("person" to R.string.profile_person,"star" to R.string.profile_star,"heart" to R.string.profile_heart).forEach {(key,label)->
            val selected=p.avatar==key
            Surface(Modifier.weight(1f).selectable(selected,enabled=enabled,role=Role.RadioButton) {onChange(p.copy(avatar=key))},
                shape=RoundedCornerShape(14.dp),
                color=if(selected) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surface,
                border=BorderStroke(if(selected) 2.dp else 1.dp,if(selected) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.outlineVariant)) {
                Column(Modifier.padding(vertical=12.dp,horizontal=4.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(6.dp)) {
                    Icon(avatarIcon(key),null,Modifier.size(30.dp),tint=MaterialTheme.colorScheme.secondary)
                    Text(stringResource(label),style=MaterialTheme.typography.labelLarge,textAlign=TextAlign.Center)
                }
            }
        }
    }
}

private fun avatarIcon(key:String)=when(key) {"star"->Icons.Default.Star;"heart"->Icons.Default.Favorite;else->Icons.Default.Person}

/** All profile fields in one column, used by the profile editor. */
@Composable fun ColumnScope.ProfileFields(p:PatientProfile,enabled:Boolean,onChange:(PatientProfile)->Unit) {
    FormSection(R.string.form_identity,R.string.form_identity_help)
    PersonalFields(p,enabled,onChange=onChange)
    FormSection(R.string.form_contact,R.string.form_contact_help)
    ContactFields(p,enabled,onChange=onChange)
    FormSection(R.string.form_account,R.string.form_account_help)
    IdentityFields(p,enabled,onChange=onChange)
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
