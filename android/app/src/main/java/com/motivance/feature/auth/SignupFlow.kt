package com.motivance.feature.auth

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.motivance.R
import com.motivance.designsystem.displayDate
import com.motivance.domain.PatientProfile

/** Patient signup, one concern per step. Validation rules come from the domain profile checks. */
internal enum class SignupStep(val title:Int,val help:Int) {
    ACCOUNT(R.string.signup_step_account,R.string.signup_step_account_help),
    PERSONAL(R.string.form_identity,R.string.form_identity_help),
    CONTACT(R.string.signup_step_contact,R.string.signup_step_contact_help),
    REVIEW(R.string.signup_step_review,R.string.signup_step_review_help);
    val number get()=ordinal+1
}

internal fun validEmail(value:String)=android.util.Patterns.EMAIL_ADDRESS.matcher(value.trim()).matches()
internal fun signupAccountValid(email:String,password:String,confirmation:String)=validEmail(email) && password.length>=8 && password==confirmation
internal fun SignupStep.complete(email:String,password:String,confirmation:String,p:PatientProfile)=when(this) {
    SignupStep.ACCOUNT -> signupAccountValid(email,password,confirmation)
    SignupStep.PERSONAL -> p.personalValid
    SignupStep.CONTACT -> p.contactValid
    SignupStep.REVIEW -> signupAccountValid(email,password,confirmation) && p.valid()
}

@Composable internal fun ColumnScope.SignupFlow(
    step:SignupStep,onStep:(SignupStep)->Unit,
    email:String,onEmail:(String)->Unit,
    password:String,onPassword:(String)->Unit,
    confirmation:String,onConfirmation:(String)->Unit,
    profile:PatientProfile,onProfile:(PatientProfile)->Unit,
    busy:Boolean,busyLabel:Int,onCreate:()->Unit,notice:@Composable ()->Unit,
) {
    // Errors for untouched fields appear only after an attempt to continue, never on arrival.
    var showErrors by remember(step) {mutableStateOf(false)}
    val focus=LocalFocusManager.current
    val ready=step.complete(email,password,confirmation,profile)
    StepHeader(step)
    when(step) {
        SignupStep.ACCOUNT -> AccountStep(email,onEmail,password,onPassword,confirmation,onConfirmation,!busy,showErrors)
        SignupStep.PERSONAL -> PersonalFields(profile,!busy,showErrors,onProfile)
        SignupStep.CONTACT -> {
            ContactFields(profile,!busy,showErrors,onProfile)
            HorizontalDivider(color=MaterialTheme.colorScheme.outlineVariant)
            Text(stringResource(R.string.form_account),style=MaterialTheme.typography.titleMedium,color=MaterialTheme.colorScheme.primary)
            Text(stringResource(R.string.form_account_help),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            IdentityFields(profile,!busy,showErrors,onProfile)
        }
        SignupStep.REVIEW -> ReviewStep(email,profile,!busy,onStep) {onProfile(profile.copy(consent=it))}
    }
    if(showErrors && !ready && step!=SignupStep.REVIEW) Surface(color=MaterialTheme.colorScheme.errorContainer,contentColor=MaterialTheme.colorScheme.onErrorContainer,shape=RoundedCornerShape(12.dp)) {
        Text(stringResource(R.string.signup_fix_fields),Modifier.fillMaxWidth().padding(14.dp).semantics {liveRegion=LiveRegionMode.Polite},style=MaterialTheme.typography.bodyMedium)
    }
    notice()
    if(step==SignupStep.REVIEW) {
        Button({focus.clearFocus();onCreate()},enabled=!busy && ready,modifier=Modifier.fillMaxWidth().heightIn(min=56.dp),
            shape=RoundedCornerShape(14.dp),contentPadding=PaddingValues(16.dp)) {
            if(busy) {CircularProgressIndicator(Modifier.size(20.dp),strokeWidth=2.dp,color=LocalContentColor.current);Spacer(Modifier.width(12.dp))}
            Text(stringResource(if(busy) busyLabel else R.string.auth_create_account),textAlign=TextAlign.Center,
                modifier=Modifier.semantics {liveRegion=LiveRegionMode.Polite})
        }
        if(!profile.consent) Text(stringResource(R.string.signup_consent_needed),style=MaterialTheme.typography.bodySmall,
            color=MaterialTheme.colorScheme.onSurfaceVariant,textAlign=TextAlign.Center,modifier=Modifier.fillMaxWidth())
    }
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(12.dp)) {
        if(step!=SignupStep.ACCOUNT) OutlinedButton({focus.clearFocus();onStep(SignupStep.entries[step.ordinal-1])},enabled=!busy,
            modifier=Modifier.weight(1f).heightIn(min=56.dp),shape=RoundedCornerShape(14.dp)) {Text(stringResource(R.string.signup_back),textAlign=TextAlign.Center)}
        if(step!=SignupStep.REVIEW) Button({
            focus.clearFocus()
            if(ready) onStep(SignupStep.entries[step.ordinal+1]) else showErrors=true
        },enabled=!busy,modifier=Modifier.weight(1f).heightIn(min=56.dp),shape=RoundedCornerShape(14.dp)) {Text(stringResource(R.string.signup_continue),textAlign=TextAlign.Center)}
    }
}

@Composable private fun StepHeader(step:SignupStep) {
    val total=SignupStep.entries.size
    val title=stringResource(step.title)
    val progress=stringResource(R.string.signup_progress_description,step.number,total,title)
    Column(Modifier.fillMaxWidth().semantics(mergeDescendants=true) {contentDescription=progress;heading()},verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.signup_step_counter,step.number,total),style=MaterialTheme.typography.labelLarge,
            color=MaterialTheme.colorScheme.secondary,fontWeight=FontWeight.Bold)
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(6.dp)) {
            repeat(total) {index ->
                Box(Modifier.weight(1f).height(6.dp).clip(CircleShape)
                    .background(if(index<=step.ordinal) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.secondary.copy(alpha=.15f)))
            }
        }
        Text(title,style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.SemiBold,color=MaterialTheme.colorScheme.primary)
        Text(stringResource(step.help),style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable private fun ColumnScope.AccountStep(
    email:String,onEmail:(String)->Unit,password:String,onPassword:(String)->Unit,
    confirmation:String,onConfirmation:(String)->Unit,enabled:Boolean,showErrors:Boolean,
) {
    var visible by remember {mutableStateOf(false)}
    val focus=LocalFocusManager.current
    val icons=fieldIconsFit()
    val emailError=(email.isNotEmpty() || showErrors) && !validEmail(email)
    OutlinedTextField(email,onEmail,label={Text(stringResource(R.string.email))},leadingIcon=if(icons) {{Icon(Icons.Default.Email,null)}} else null,
        singleLine=true,enabled=enabled,isError=emailError,supportingText={if(emailError) Text(stringResource(R.string.invalid_email))},
        modifier=Modifier.fillMaxWidth(),shape=RoundedCornerShape(12.dp),
        keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Email,imeAction=ImeAction.Next))
    val transform=if(visible) VisualTransformation.None else PasswordVisualTransformation()
    OutlinedTextField(password,onPassword,label={Text(stringResource(R.string.auth_password))},leadingIcon=if(icons) {{Icon(Icons.Default.Lock,null)}} else null,
        trailingIcon={PasswordVisibilityButton(visible,enabled) {visible=it}},visualTransformation=transform,singleLine=true,enabled=enabled,
        isError=(password.isNotEmpty() || showErrors) && password.length<8,modifier=Modifier.fillMaxWidth(),shape=RoundedCornerShape(12.dp),
        keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Password,imeAction=ImeAction.Next))
    val mismatch=(confirmation.isNotEmpty() || showErrors) && confirmation!=password
    OutlinedTextField(confirmation,onConfirmation,label={Text(stringResource(R.string.signup_confirm_password))},leadingIcon=if(icons) {{Icon(Icons.Default.Lock,null)}} else null,
        visualTransformation=transform,singleLine=true,enabled=enabled,isError=mismatch,
        supportingText={if(mismatch) Text(stringResource(R.string.form_password_match))},modifier=Modifier.fillMaxWidth(),shape=RoundedCornerShape(12.dp),
        keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Password,imeAction=ImeAction.Done),keyboardActions=KeyboardActions(onDone={focus.clearFocus()}))
    // A live checklist instead of a rule paragraph: each requirement turns green as it is met.
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.secondary.copy(alpha=.06f)).padding(12.dp),
        verticalArrangement=Arrangement.spacedBy(6.dp)) {
        Requirement(R.string.signup_req_email,validEmail(email))
        Requirement(R.string.signup_req_length,password.length>=8)
        Requirement(R.string.signup_req_match,password.isNotEmpty() && password==confirmation)
    }
}

@Composable private fun Requirement(label:Int,met:Boolean) {
    val state=stringResource(if(met) R.string.signup_req_met else R.string.signup_req_unmet)
    Row(Modifier.semantics(mergeDescendants=true) {stateDescription=state},verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)) {
        if(met) Icon(Icons.Filled.CheckCircle,null,Modifier.size(20.dp),tint=MaterialTheme.colorScheme.secondary)
        else Box(Modifier.size(20.dp).padding(2.dp).border(2.dp,MaterialTheme.colorScheme.outline,CircleShape))
        Text(stringResource(label),style=MaterialTheme.typography.bodyMedium,
            color=if(met) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable private fun ColumnScope.ReviewStep(email:String,p:PatientProfile,enabled:Boolean,onStep:(SignupStep)->Unit,onConsent:(Boolean)->Unit) {
    ReviewSection(R.string.signup_review_account,SignupStep.ACCOUNT,enabled,onStep,listOf(R.string.email to email.trim()))
    ReviewSection(R.string.form_identity,SignupStep.PERSONAL,enabled,onStep,listOf(
        R.string.profile_name to p.displayName,
        R.string.profile_birthdate to "${displayDate(p.birthdate)} · ${stringResource(R.string.profile_age,p.age?.toString() ?: "--")}",
        R.string.profile_gender to stringResource(genderLabel(p.gender))))
    ReviewSection(R.string.signup_step_contact,SignupStep.CONTACT,enabled,onStep,listOf(
        R.string.profile_address to p.address.trim(),R.string.profile_contact to p.contact,
        R.string.profile_username to "@${p.username}",R.string.profile_avatar to stringResource(avatarLabel(p.avatar))))
    PrivacyCard(p.consent,enabled,onConsent)
}

@Composable private fun ReviewSection(title:Int,step:SignupStep,enabled:Boolean,onStep:(SignupStep)->Unit,rows:List<Pair<Int,String>>) {
    val sectionTitle=stringResource(title)
    val edit=stringResource(R.string.signup_edit_section,sectionTitle)
    OutlinedCard(Modifier.fillMaxWidth(),shape=RoundedCornerShape(16.dp)) {
        Column(Modifier.padding(start=16.dp,end=4.dp,top=4.dp,bottom=12.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment=Alignment.CenterVertically) {
                Text(sectionTitle,Modifier.weight(1f).semantics {heading()},style=MaterialTheme.typography.titleSmall,
                    fontWeight=FontWeight.SemiBold,color=MaterialTheme.colorScheme.primary)
                TextButton({onStep(step)},enabled=enabled,modifier=Modifier.semantics {contentDescription=edit}) {Text(stringResource(R.string.signup_edit))}
            }
            rows.forEach {(label,value) ->
                Column(Modifier.padding(end=12.dp).semantics(mergeDescendants=true) {}) {
                    Text(stringResource(label),style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(value,style=MaterialTheme.typography.bodyLarge)
                }
            }
        }
    }
}

/** Key points first, full agreement on demand, then an explicit consent row. The full text and version are unchanged. */
@Composable private fun PrivacyCard(accepted:Boolean,enabled:Boolean,onChange:(Boolean)->Unit) {
    var expanded by remember {mutableStateOf(false)}
    OutlinedCard(Modifier.fillMaxWidth(),shape=RoundedCornerShape(16.dp)) {
        Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
            Text(stringResource(R.string.profile_privacy_title),style=MaterialTheme.typography.titleMedium,
                fontWeight=FontWeight.SemiBold,color=MaterialTheme.colorScheme.primary,modifier=Modifier.semantics {heading()})
            listOf(R.string.signup_privacy_point_1,R.string.signup_privacy_point_2,R.string.signup_privacy_point_3,R.string.signup_privacy_point_4).forEach {
                Row(horizontalArrangement=Arrangement.spacedBy(10.dp)) {
                    Box(Modifier.padding(top=8.dp).size(6.dp).clip(CircleShape).background(MaterialTheme.colorScheme.secondary))
                    Text(stringResource(it),style=MaterialTheme.typography.bodyMedium)
                }
            }
            TextButton({expanded=!expanded},contentPadding=PaddingValues(horizontal=0.dp)) {
                Text(stringResource(if(expanded) R.string.signup_privacy_hide_full else R.string.signup_privacy_read_full))
            }
            AnimatedVisibility(expanded) {
                Text(stringResource(R.string.profile_privacy_text),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Surface(Modifier.fillMaxWidth().toggleable(accepted,enabled=enabled,role=Role.Checkbox,onValueChange=onChange),
                shape=RoundedCornerShape(12.dp),
                color=if(accepted) MaterialTheme.colorScheme.secondary.copy(alpha=.1f) else MaterialTheme.colorScheme.surface,
                border=BorderStroke(if(accepted) 2.dp else 1.dp,if(accepted) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.outlineVariant)) {
                Row(Modifier.padding(12.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                    Checkbox(accepted,null,enabled=enabled)
                    Text(stringResource(R.string.profile_agree),Modifier.weight(1f),style=MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
}

private fun genderLabel(key:String)=when(key) {"female"->R.string.profile_female;"male"->R.string.profile_male;"nonbinary"->R.string.profile_nonbinary;else->R.string.profile_private}
private fun avatarLabel(key:String)=when(key) {"star"->R.string.profile_star;"heart"->R.string.profile_heart;else->R.string.profile_person}

/** Decorative leading icons are dropped at large font scales so field labels keep their width and do not break mid-word. */
@Composable internal fun fieldIconsFit()=androidx.compose.ui.platform.LocalDensity.current.fontScale<1.3f
