package com.motivance.feature.auth

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.ui.platform.LocalContext
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

/** The patient's profile photo, or their initials when none is set. */
@Composable fun ProfileAvatar(p:PatientProfile,size:androidx.compose.ui.unit.Dp=60.dp) {
    PersonAvatar(p.photoUrl,p.displayName.ifBlank {p.username},size,container=MaterialTheme.colorScheme.secondaryContainer,
        content=MaterialTheme.colorScheme.onSecondaryContainer,description=stringResource(R.string.profile_avatar))
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

/** Username. At signup, a note explains that a profile photo can be added after the email is confirmed. */
@Composable fun ColumnScope.IdentityFields(p:PatientProfile,enabled:Boolean,showErrors:Boolean=false,signup:Boolean=false,onChange:(PatientProfile)->Unit) {
    ProfileTextField(R.string.profile_username,p.username,when {UsernamePolicy.blocked(p.username)->R.string.form_username_blocked;!UsernamePolicy.allowed(p.username)->R.string.form_username_error;else->null},
        enabled,showErrors,KeyboardType.Ascii,R.string.profile_username_help,leading=Icons.Default.AccountCircle) {onChange(p.copy(username=it.trim()))}
    if(signup) Row(horizontalArrangement=Arrangement.spacedBy(10.dp)) {
        Icon(Icons.Default.AccountCircle,null,tint=MaterialTheme.colorScheme.secondary)
        Text(stringResource(R.string.profile_photo_later),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    }
}


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

data class ProfileState(val owner:String="",val profile:PatientProfile?=null,val busy:Boolean=false,val failed:Boolean=false,val message:Int?=null,
    val photoBusy:Boolean=false,val photoError:Int?=null)
/** Photo errors name the cause where the server or device makes it known. */
internal fun photoFailure(e:Exception)=when {
    e is RemoteFailure && e.status==503 -> R.string.profile_photo_unconfigured
    e is RemoteFailure && e.status==429 -> R.string.profile_photo_limit
    e is UnreadablePhoto || e is IllegalArgumentException -> R.string.profile_photo_unreadable
    else -> R.string.profile_photo_failed
}

@HiltViewModel class PatientProfileViewModel @Inject constructor(private val repository:AuthRepository,private val toasts:Toaster=Toaster()):ViewModel() {
    private val mutable=MutableStateFlow(ProfileState());val state=mutable.asStateFlow()
    private var job:Job?=null
    private var generation=0
    fun configure(owner:String?) {if(owner.orEmpty()==mutable.value.owner)return;generation++;job?.cancel();mutable.value=ProfileState(owner=owner.orEmpty());if(owner!=null)refresh()}
    fun refresh()=perform {repository.loadProfile()}
    fun save(p:PatientProfile)=perform(R.string.profile_saved) {repository.saveProfile(p);repository.loadProfile()}
    fun password(old:String,new:String)=perform(R.string.profile_password_saved) {repository.changePassword(old,new);repository.loadProfile()}
    fun uploadPhoto(jpeg:ByteArray)=perform(R.string.profile_photo_saved,photo=true) {repository.uploadProfilePhoto(jpeg);repository.loadProfile()}
    fun removePhoto()=perform(R.string.profile_photo_removed,photo=true) {repository.removeProfilePhoto();repository.loadProfile()}
    /** The picked file could not be decoded on the device; nothing was uploaded. */
    fun photoUnreadable() {mutable.value=mutable.value.copy(photoError=R.string.profile_photo_unreadable,message=null);toasts.show(R.string.profile_photo_unreadable,ToastTone.ERROR)}
    private fun perform(message:Int?=null,photo:Boolean=false,action:suspend ()->PatientProfile) {
        if(mutable.value.owner.isBlank() || mutable.value.busy)return
        val ticket=++generation
        mutable.value=mutable.value.copy(busy=true,photoBusy=photo,failed=false,message=null,photoError=null)
        // Only a change has a message; the plain profile load stays silent.
        if(message!=null) toasts.show(R.string.profile_loading,ToastTone.PENDING)
        job=viewModelScope.launch {
            try {val p=action();if(ticket==generation) {mutable.value=mutable.value.copy(profile=p,busy=false,photoBusy=false,message=message);message?.let {toasts.show(it)}}}
            catch(e:CancellationException){throw e}
            catch(e:Exception){if(ticket==generation) {mutable.value=mutable.value.copy(busy=false,photoBusy=false,
                failed=!photo,photoError=if(photo) photoFailure(e) else null)
                if(message!=null) toasts.show(if(photo) photoFailure(e) else R.string.profile_failed,ToastTone.ERROR)}}
        }
    }
}

@Composable fun ColumnScope.PatientProfileEditor(vm:PatientProfileViewModel,onSaved:()->Unit) {
    val state by vm.state.collectAsStateWithLifecycle()
    if(state.busy) LoadingNotice(R.string.profile_loading)
    if(state.failed) FeedbackNotice(R.string.profile_failed,error=true,retry={vm.refresh()})
    LaunchedEffect(state.message) {if(state.message==R.string.profile_saved)onSaved()}
    state.profile?.let {ProfilePhotoCard(it,state,vm)}
    // Keyed without the photo, so changing the photo does not discard an edit in progress.
    state.profile?.let {loaded -> key(loaded.copy(photoUrl=null)) {
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

/**
 * Photo picker, preview and removal. The system photo picker needs no storage permission. The picked image is
 * prepared on the device (see [preparePhoto]) and then uploaded through a server-signed Cloudinary request.
 */
@Composable private fun ProfilePhotoCard(p:PatientProfile,state:ProfileState,vm:PatientProfileViewModel) {
    val resolver=LocalContext.current.contentResolver
    val scope=rememberCoroutineScope()
    var confirmRemove by remember {mutableStateOf(false)}
    val picker=rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) {uri ->
        if(uri!=null) scope.launch {
            val jpeg=withContext(Dispatchers.Default) {runCatching {preparePhoto(resolver,uri)}.getOrNull()}
            if(jpeg==null) vm.photoUnreadable() else vm.uploadPhoto(jpeg)
        }
    }
    ClinicalCard {
        Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(16.dp)) {
            Box(contentAlignment=Alignment.Center) {
                ProfileAvatar(p,88.dp)
                if(state.photoBusy) CircularProgressIndicator(Modifier.size(88.dp),strokeWidth=3.dp,color=MaterialTheme.colorScheme.secondary)
            }
            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)) {
                Text(stringResource(R.string.profile_photo),style=MaterialTheme.typography.titleMedium)
                Text(stringResource(if(p.photoUrl==null) R.string.profile_photo_empty else R.string.profile_photo_set),
                    style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        state.photoError?.let {FeedbackNotice(it,error=true)}
        state.message?.takeIf {it==R.string.profile_photo_saved || it==R.string.profile_photo_removed}?.let {FeedbackNotice(it)}
        ActionButton(if(p.photoUrl==null) R.string.profile_photo_add else R.string.profile_photo_change,
            {picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))},
            enabled=!state.busy,busy=state.photoBusy,busyLabel=R.string.profile_photo_uploading)
        if(p.photoUrl!=null) OutlinedButton({confirmRemove=true},Modifier.fillMaxWidth().heightIn(min=48.dp),enabled=!state.busy,
            shape=MaterialTheme.shapes.medium,colors=ButtonDefaults.outlinedButtonColors(contentColor=MaterialTheme.colorScheme.error)) {
            Icon(Icons.Default.Delete,null,Modifier.size(18.dp));Spacer(Modifier.width(8.dp));Text(stringResource(R.string.profile_photo_remove))
        }
        Text(stringResource(R.string.profile_photo_notice),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    }
    if(confirmRemove) AlertDialog(onDismissRequest={confirmRemove=false},
        icon={Icon(Icons.Default.Warning,null,tint=MaterialTheme.colorScheme.error)},
        title={Text(stringResource(R.string.profile_photo_remove))},text={Text(stringResource(R.string.profile_photo_remove_confirm))},
        confirmButton={TextButton({confirmRemove=false;vm.removePhoto()},colors=ButtonDefaults.textButtonColors(contentColor=MaterialTheme.colorScheme.error)) {
            Text(stringResource(R.string.profile_photo_remove))}},
        dismissButton={TextButton({confirmRemove=false}) {Text(stringResource(R.string.cancel_action))}})
}
