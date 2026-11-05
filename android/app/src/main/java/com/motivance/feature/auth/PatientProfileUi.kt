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
    GenderField(p.gender,enabled,showErrors) {onChange(p.copy(gender=it))}
}

private val GENDER_LABELS=listOf("female" to R.string.profile_female,"male" to R.string.profile_male,"nonbinary" to R.string.profile_nonbinary,"prefer_not_to_say" to R.string.profile_private)

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun GenderField(gender:String,enabled:Boolean,showErrors:Boolean,onChange:(String)->Unit) {
    var expanded by remember {mutableStateOf(false)}
    val selected=GENDER_LABELS.firstOrNull {it.first==gender}
    val showError=showErrors && selected==null
    ExposedDropdownMenuBox(expanded && enabled,{expanded=it}) {
        OutlinedTextField(selected?.let {stringResource(it.second)}.orEmpty(),{},
            Modifier.fillMaxWidth().menuAnchor(MenuAnchorType.PrimaryNotEditable,enabled),enabled=enabled,readOnly=true,singleLine=true,
            label={Text(stringResource(R.string.profile_gender))},placeholder={Text(stringResource(R.string.profile_gender_choose))},
            trailingIcon={ExposedDropdownMenuDefaults.TrailingIcon(expanded)},isError=showError,
            supportingText=if(showError) ({Text(stringResource(R.string.form_gender_required))}) else null,shape=RoundedCornerShape(12.dp))
        ExposedDropdownMenu(expanded && enabled,{expanded=false}) {
            GENDER_LABELS.forEach {(key,label) ->
                DropdownMenuItem(text={Text(stringResource(label))},onClick={onChange(key);expanded=false},
                    trailingIcon=if(key==gender) ({Icon(Icons.Default.Check,null)}) else null,contentPadding=ExposedDropdownMenuDefaults.ItemContentPadding)
            }
        }
    }
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


/** All profile fields in one column, in the same order as the web page. */
@Composable fun ColumnScope.ProfileFields(p:PatientProfile,enabled:Boolean,onChange:(PatientProfile)->Unit) {
    PersonalFields(p,enabled,onChange=onChange)
    IdentityFields(p,enabled,onChange=onChange)
    ContactFields(p,enabled,onChange=onChange)
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

/**
 * The profile page, with the same three parts as the web app: who you are and your photo, your details, and your password.
 * [fallbackName] names staff accounts that have no details yet, and [badge] shows their role.
 */
@Composable fun ColumnScope.PatientProfileEditor(vm:PatientProfileViewModel,fallbackName:String="",badge:(@Composable ()->Unit)?=null,onSaved:()->Unit) {
    val state by vm.state.collectAsStateWithLifecycle()
    if(state.busy && state.profile==null) LoadingNotice(R.string.profile_loading)
    if(state.failed) FeedbackNotice(R.string.profile_failed,error=true,retry={vm.refresh()})
    LaunchedEffect(state.message) {if(state.message==R.string.profile_saved)onSaved()}
    state.profile?.let {loaded ->
        ProfileIdentityCard(loaded,fallbackName,badge,state,vm)
        // Keyed without the photo, so changing the photo does not discard an edit in progress.
        key(loaded.copy(photoUrl=null)) {ProfileDetailsCard(loaded,state.busy,vm)}
        PasswordCard(state,vm)
    }
}

/** A card title with an optional action in its corner, where the web app puts it. */
@Composable private fun CardTitle(title:Int,action:(@Composable () -> Unit)?=null) {
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)) {
        Text(stringResource(title),style=MaterialTheme.typography.titleMedium,modifier=Modifier.weight(1f))
        action?.invoke()
    }
}

/**
 * Who is signed in, and their photo. The system photo picker needs no storage permission. The picked image is prepared on the
 * device (see [preparePhoto]) and then uploaded through a server-signed Cloudinary request.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable private fun ProfileIdentityCard(p:PatientProfile,fallbackName:String,badge:(@Composable ()->Unit)?,state:ProfileState,vm:PatientProfileViewModel) {
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
                ProfileAvatar(p,72.dp)
                if(state.photoBusy) CircularProgressIndicator(Modifier.size(72.dp),strokeWidth=3.dp,color=MaterialTheme.colorScheme.secondary)
            }
            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(2.dp)) {
                Text(p.displayName.ifBlank {fallbackName}.ifBlank {p.email},style=MaterialTheme.typography.titleLarge)
                Text(p.email,style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
                badge?.invoke()
            }
        }
        Text(stringResource(R.string.profile_email_fixed),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        HorizontalDivider(color=MaterialTheme.colorScheme.outlineVariant)
        CardTitle(R.string.profile_photo)
        Text(stringResource(if(p.photoUrl==null) R.string.profile_photo_empty else R.string.profile_photo_set),
            style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        state.photoError?.let {FeedbackNotice(it,error=true)}
        state.message?.takeIf {it==R.string.profile_photo_saved || it==R.string.profile_photo_removed}?.let {FeedbackNotice(it)}
        FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp),verticalArrangement=Arrangement.spacedBy(4.dp)) {
            OutlinedButton({picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))},Modifier.heightIn(min=48.dp),enabled=!state.busy,shape=MaterialTheme.shapes.medium) {
                Text(stringResource(if(state.photoBusy) R.string.profile_photo_uploading else if(p.photoUrl==null) R.string.profile_photo_add else R.string.profile_photo_change))
            }
            if(p.photoUrl!=null) TextButton({confirmRemove=true},Modifier.heightIn(min=48.dp),enabled=!state.busy,colors=ButtonDefaults.textButtonColors(contentColor=MaterialTheme.colorScheme.error)) {
                Text(stringResource(R.string.profile_photo_remove))
            }
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

@Composable private fun ProfileFact(label:Int,value:String,modifier:Modifier=Modifier) {
    Column(modifier,verticalArrangement=Arrangement.spacedBy(2.dp)) {
        Text(stringResource(label),style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value,style=MaterialTheme.typography.bodyLarge)
    }
}

/** Facts sit side by side when there is room, and stack on a narrow phone or with large text. */
@Composable private fun ProfileFacts(p:PatientProfile) {
    val facts=listOf(
        R.string.profile_username to "@"+p.username,
        R.string.profile_birthdate to displayDate(p.birthdate),
        R.string.profile_gender to stringResource(GENDER_LABELS.firstOrNull {it.first==p.gender}?.second ?: R.string.profile_private),
        R.string.profile_contact to p.contact,
    )
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val columns=if(maxWidth>=320.dp && fieldIconsFit()) 2 else 1
        Column(verticalArrangement=Arrangement.spacedBy(14.dp)) {
            facts.chunked(columns).forEach {row ->
                Row(horizontalArrangement=Arrangement.spacedBy(16.dp)) {row.forEach {(label,value) -> ProfileFact(label,value,Modifier.weight(1f))}}
            }
            ProfileFact(R.string.profile_address,p.address)
        }
    }
}

@Composable private fun ProfileDetailsCard(loaded:PatientProfile,busy:Boolean,vm:PatientProfileViewModel) {
    var draft by remember {mutableStateOf(loaded)}
    var editing by remember {mutableStateOf(false)}
    val incomplete=loaded.username.isBlank()
    ClinicalCard {
        CardTitle(R.string.profile_details,if(editing || incomplete) null else ({
            TextButton({editing=true;draft=loaded},Modifier.heightIn(min=48.dp),enabled=!busy) {
                Icon(Icons.Default.Edit,null,Modifier.size(18.dp));Spacer(Modifier.width(6.dp));Text(stringResource(R.string.profile_edit))
            }
        }))
        if(incomplete) Text(stringResource(R.string.profile_incomplete),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        if(editing || incomplete) {
            ProfileFields(draft,!busy) {draft=it}
            if(!loaded.consent) PrivacyAgreement(draft.consent,!busy) {draft=draft.copy(consent=it)}
            Text(stringResource(R.string.profile_validation),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            Row(horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                if(!incomplete) ActionButton(R.string.cancel_action,{editing=false;draft=loaded},Modifier.weight(1f),outlined=true,enabled=!busy)
                ActionButton(R.string.profile_save,{vm.save(draft)},Modifier.weight(1f),enabled=draft.valid() && !busy,busy=busy,busyLabel=R.string.profile_loading)
            }
        } else ProfileFacts(loaded)
    }
}

@Composable private fun PasswordCard(state:ProfileState,vm:PatientProfileViewModel) {
    key(state.message) {
        var old by remember {mutableStateOf("")};var new by remember {mutableStateOf("")};var confirmation by remember {mutableStateOf("")}
        val same=new.isNotEmpty() && new==old
        val short=new.isNotEmpty() && new.length<8
        val mismatch=confirmation.isNotEmpty() && confirmation!=new
        @Composable fun field(label:Int,value:String,error:Int?,set:(String)->Unit) {
            OutlinedTextField(value,set,enabled=!state.busy,label={Text(stringResource(label))},isError=error!=null,
                supportingText=error?.let {message -> {Text(stringResource(message))}},visualTransformation=PasswordVisualTransformation(),singleLine=true,
                keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Password),shape=RoundedCornerShape(12.dp),modifier=Modifier.fillMaxWidth())
        }
        ClinicalCard {
            CardTitle(R.string.profile_change_password)
            Text(stringResource(R.string.profile_password_help),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            field(R.string.profile_current_password,old,null) {old=it}
            field(R.string.auth_new_password,new,if(same) R.string.profile_password_same else if(short) R.string.form_password_length else null) {new=it}
            field(R.string.profile_confirm_password,confirmation,if(mismatch) R.string.form_password_match else null) {confirmation=it}
            ActionButton(R.string.profile_change_password,{vm.password(old,new);old="";new="";confirmation=""},outlined=true,
                enabled=!state.busy && old.isNotBlank() && new.length>=8 && new==confirmation && old!=new,busy=state.busy,busyLabel=R.string.profile_loading)
        }
    }
}
