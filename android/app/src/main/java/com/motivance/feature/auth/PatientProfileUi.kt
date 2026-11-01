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
    @Composable fun field(label:Int,value:String,type:KeyboardType=KeyboardType.Text,change:(String)->PatientProfile) {
        OutlinedTextField(value,{onChange(change(it))},enabled=enabled,label={Text(stringResource(label))},
            modifier=Modifier.fillMaxWidth(),keyboardOptions=KeyboardOptions(keyboardType=type),singleLine=label!=R.string.profile_address)
    }
    field(R.string.profile_name,p.name) {p.copy(name=it)}
    field(R.string.profile_username,p.username) {p.copy(username=it)}
    Text(stringResource(R.string.profile_username_help),style=MaterialTheme.typography.bodySmall)
    Text(stringResource(R.string.profile_gender),style=MaterialTheme.typography.titleSmall)
    FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
        listOf("female" to R.string.profile_female,"male" to R.string.profile_male,"nonbinary" to R.string.profile_nonbinary,"prefer_not_to_say" to R.string.profile_private).forEach {(key,label)->
            FilterChip(p.gender==key,{onChange(p.copy(gender=key))},enabled=enabled,label={Text(stringResource(label))})
        }
    }
    field(R.string.profile_birthdate,p.birthdate) {p.copy(birthdate=it)}
    Text(stringResource(R.string.profile_date_help),style=MaterialTheme.typography.bodySmall)
    Text(stringResource(R.string.profile_age,p.age?.toString() ?: "--"))
    field(R.string.profile_address,p.address) {p.copy(address=it)}
    field(R.string.profile_contact,p.contact,KeyboardType.Phone) {p.copy(contact=it)}
    Text(stringResource(R.string.profile_avatar),style=MaterialTheme.typography.titleSmall)
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

@Composable fun PatientProfileSummary(p:PatientProfile) {
    ClinicalCard {
        ProfileAvatar(p)
        Text("@"+p.username,style=MaterialTheme.typography.titleLarge)
        Text(p.name)
        Text(stringResource(R.string.profile_age,p.age?.toString() ?: "--"))
        Text(stringResource(when(p.gender) {"female"->R.string.profile_female;"male"->R.string.profile_male;"nonbinary"->R.string.profile_nonbinary;else->R.string.profile_private}))
        Text(stringResource(R.string.profile_address)+": "+p.address)
        Text(stringResource(R.string.profile_contact)+": "+p.contact)
        Text(stringResource(R.string.profile_birthdate)+": "+p.birthdate)
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
                OutlinedTextField(value,set,enabled=!state.busy,label={Text(stringResource(label))},visualTransformation=PasswordVisualTransformation(),singleLine=true,keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Password),modifier=Modifier.fillMaxWidth())
            }
            Text(stringResource(R.string.profile_password_help),style=MaterialTheme.typography.bodySmall)
            ActionButton(R.string.profile_change_password,{vm.password(old,new);old="";new="";confirmation=""},enabled=!state.busy && old.isNotBlank() && new.length>=8 && new==confirmation && old!=new,busy=state.busy,busyLabel=R.string.profile_loading)
        }
    }
}
