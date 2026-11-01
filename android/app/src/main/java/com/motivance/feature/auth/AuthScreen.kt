package com.motivance.feature.auth

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Email
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.motivance.R
import com.motivance.domain.UserRole

@Composable
fun AuthScreen(viewModel: AuthViewModel, openCamera: () -> Unit, role: UserRole? = null, onBack: () -> Unit = {}) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    AuthContent(state, role, viewModel::act, viewModel::clearNotice, openCamera, onBack,viewModel::registerProfile)
}

@Composable
internal fun AuthContent(
    state: AuthState,
    role: UserRole?,
    onSubmit: (AuthAction, String, String, String) -> Unit,
    clearNotice: () -> Unit,
    openCamera: () -> Unit,
    onBack: () -> Unit,
    onRegister: ((String,String,com.motivance.domain.PatientProfile)->Unit)? = null,
    initialProfile: com.motivance.domain.PatientProfile = com.motivance.domain.PatientProfile(),
) {
    var action by rememberSaveable { mutableStateOf(AuthAction.SIGN_IN) }
    var email by rememberSaveable { mutableStateOf("") }
    // Credentials deliberately stay out of saved instance state.
    var password by remember { mutableStateOf("") }
    var otp by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    var profile by remember {mutableStateOf(initialProfile)}
    val focus = LocalFocusManager.current
    fun changeAction(next: AuthAction) {
        focus.clearFocus()
        password = ""; otp = ""; showPassword = false
        clearNotice()
        action = next
    }
    fun submit() {
        if (!state.busy) { focus.clearFocus(); if(action==AuthAction.REGISTER) {if(profile.valid() && password.length>=8) {if(onRegister!=null)onRegister(email,password,profile) else onSubmit(action,email,password,otp)}} else onSubmit(action, email, password, otp) }
    }
    LaunchedEffect(state.session?.userId, action) {
        password = ""; otp = ""; showPassword = false
    }
    LaunchedEffect(state.notice) {
        if (state.notice == AuthNotice.CONFIRM_EMAIL) action = AuthAction.CONFIRM
        if (state.notice == AuthNotice.EMAIL_UNCONFIRMED) action = AuthAction.CONFIRM
        if (state.notice == AuthNotice.RECOVERY_SENT) action = AuthAction.RECOVER
    }
    BackHandler(enabled = state.busy || action != AuthAction.SIGN_IN) {
        if (!state.busy) changeAction(AuthAction.SIGN_IN)
    }
    val hasPassword = action in setOf(AuthAction.SIGN_IN, AuthAction.REGISTER, AuthAction.RECOVER)
    val hasCode = action in setOf(AuthAction.CONFIRM, AuthAction.RECOVER)
    AuthBackground {
        Column(
            Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Row(Modifier.widthIn(max = 480.dp).fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { if (action == AuthAction.SIGN_IN) onBack() else changeAction(AuthAction.SIGN_IN) }, enabled = !state.busy) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(if (action == AuthAction.SIGN_IN) R.string.choose_role else R.string.back_to_sign_in))
                }
                Spacer(Modifier.width(12.dp))
                AuthBrand(Modifier.weight(1f))
            }
            Column(Modifier.widthIn(max = 480.dp).fillMaxWidth().padding(top = 28.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Surface(color = MaterialTheme.colorScheme.secondary.copy(alpha = .08f), shape = CircleShape) {
                    Text(stringResource(when(role) {UserRole.THERAPIST->R.string.clinical_portal;UserRole.ADMIN->R.string.admin_title;else->R.string.rehabilitation_portal}),
                        Modifier.padding(horizontal = 14.dp, vertical = 8.dp), color = MaterialTheme.colorScheme.secondary,
                        style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                }
                Text(stringResource(action.heading()), style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                Text(stringResource(action.description(role)), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Surface(Modifier.widthIn(max = 480.dp).fillMaxWidth(), shape = RoundedCornerShape(24.dp), color = Color.White,
                shadowElevation = 3.dp, border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = .06f))) {
                Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Text(stringResource(action.label()), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                    OutlinedTextField(
                        value = email, onValueChange = { email = it; clearNotice() }, label = { Text(stringResource(R.string.email)) },
                        leadingIcon = { Icon(Icons.Default.Email, null) }, singleLine = true, enabled = !state.busy,
                        isError = state.notice == AuthNotice.INVALID_EMAIL, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = if (hasPassword || hasCode) ImeAction.Next else ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { submit() }),
                    )
                    if (hasPassword) OutlinedTextField(
                        value = password, onValueChange = { password = it; clearNotice() },
                        label = { Text(stringResource(if (action == AuthAction.RECOVER) R.string.auth_new_password else R.string.auth_password)) },
                        trailingIcon = { PasswordVisibilityButton(showPassword, !state.busy) { showPassword = it } },
                        visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                        singleLine = true, enabled = !state.busy, isError = state.notice == AuthNotice.PASSWORD_REQUIRED,
                        modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = if (hasCode) ImeAction.Next else ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { submit() }),
                    )
                    if (hasCode) OutlinedTextField(
                        value = otp, onValueChange = { otp = it; clearNotice() }, label = { Text(stringResource(R.string.auth_email_code)) },
                        singleLine = true, enabled = !state.busy, isError = state.notice == AuthNotice.CODE_REQUIRED,
                        modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { submit() }),
                    )
                    if (action == AuthAction.SIGN_IN) TextButton(
                        onClick = { changeAction(AuthAction.REQUEST_RECOVERY) }, enabled = !state.busy, modifier = Modifier.align(Alignment.End),
                    ) { Text(stringResource(R.string.auth_forgot_password)) }
                    if(action==AuthAction.REGISTER) {
                        ProfileFields(profile,!state.busy) {profile=it}
                        PrivacyAgreement(profile.consent,!state.busy) {profile=profile.copy(consent=it)}
                        Text(stringResource(R.string.profile_validation),style=MaterialTheme.typography.bodySmall)
                    }
                    state.notice?.let { AuthNoticeCard(it) }
                    Button(onClick = { submit() }, enabled = !state.busy && (action!=AuthAction.REGISTER || (profile.valid() && password.length>=8)), modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
                        shape = RoundedCornerShape(14.dp), contentPadding = PaddingValues(16.dp)) {
                        if (state.busy) {
                            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = LocalContentColor.current)
                            Spacer(Modifier.width(12.dp))
                        }
                        Text(stringResource(if (state.busy) (state.activeAction ?: action).busyLabel() else action.label()), textAlign = TextAlign.Center,
                            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                    }
                    if(action==AuthAction.CONFIRM || action==AuthAction.RECOVER) {
                        Text(stringResource(R.string.auth_delivery_help),style=MaterialTheme.typography.bodySmall)
                        TextButton(onClick={if(!state.busy) {otp="";onSubmit(if(action==AuthAction.CONFIRM) AuthAction.RESEND_CONFIRMATION else AuthAction.REQUEST_RECOVERY,email,"","")}},enabled=!state.busy,modifier=Modifier.fillMaxWidth()) {
                            Text(stringResource(R.string.auth_resend_code))
                        }
                    }
                    if (action == AuthAction.SIGN_IN && role != UserRole.THERAPIST && role != UserRole.ADMIN) {
                        HorizontalDivider(color = MaterialTheme.colorScheme.primary.copy(alpha = .08f))
                        Text(stringResource(R.string.auth_new_here), Modifier.fillMaxWidth(), textAlign = TextAlign.Center, style = MaterialTheme.typography.bodyMedium)
                        OutlinedButton(onClick = { changeAction(AuthAction.REGISTER) }, enabled = !state.busy,
                            modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp), shape = RoundedCornerShape(14.dp)) {
                            Text(stringResource(R.string.auth_create_account), textAlign = TextAlign.Center)
                        }
                    }
                    if (action != AuthAction.SIGN_IN) TextButton(onClick = { changeAction(AuthAction.SIGN_IN) }, enabled = !state.busy, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(R.string.back_to_sign_in), textAlign = TextAlign.Center)
                    }
                }
            }
            if (action == AuthAction.SIGN_IN) TextButton(onClick = { changeAction(AuthAction.CONFIRM) }, enabled = !state.busy,
                modifier = Modifier.widthIn(max = 480.dp).padding(top = 12.dp)) { Text(stringResource(R.string.auth_have_code), textAlign = TextAlign.Center) }
            Column(Modifier.widthIn(max = 480.dp).fillMaxWidth().padding(top = 24.dp, bottom = 16.dp),
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(openCamera, enabled = !state.busy) { Text(stringResource(R.string.auth_try_camera)) }
                Text(stringResource(R.string.camera_privacy), style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
            }
        }
    }
}

@Composable
fun AuthLoadingScreen() {
    AuthBackground {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Box(Modifier.size(176.dp).background(MaterialTheme.colorScheme.secondary.copy(alpha = .05f), CircleShape), contentAlignment = Alignment.Center) {
                Box(Modifier.size(136.dp).background(MaterialTheme.colorScheme.secondary.copy(alpha = .07f), CircleShape), contentAlignment = Alignment.Center) {
                    Surface(shape = RoundedCornerShape(28.dp), color = Color.White, shadowElevation = 4.dp) {
                        Image(painterResource(R.drawable.motivance_logo), null, Modifier.padding(16.dp).size(64.dp))
                    }
                }
            }
            Spacer(Modifier.height(28.dp))
            Text(stringResource(R.string.app_name), style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
            Text(stringResource(R.string.auth_loading_tagline), Modifier.padding(top = 8.dp), style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.secondary, textAlign = TextAlign.Center)
            Spacer(Modifier.height(40.dp))
            LinearProgressIndicator(Modifier.widthIn(max = 200.dp).fillMaxWidth(), color = MaterialTheme.colorScheme.secondary,
                trackColor = MaterialTheme.colorScheme.secondary.copy(alpha = .1f))
            Text(stringResource(R.string.auth_restoring), Modifier.padding(top = 16.dp).semantics { liveRegion = LiveRegionMode.Polite },
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        }
    }
}

@Composable private fun AuthBackground(content: @Composable BoxScope.() -> Unit) {
    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0xFFEAF5F3), MaterialTheme.colorScheme.background, Color(0xFFF0F4FC)))), content = content)
}

@Composable private fun AuthBrand(modifier: Modifier = Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Image(painterResource(R.drawable.motivance_logo), null, Modifier.size(36.dp))
        Text(stringResource(R.string.app_name), Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
    }
}

@Composable private fun PasswordVisibilityButton(visible: Boolean, enabled: Boolean, onChange: (Boolean) -> Unit) {
    val label = stringResource(if (visible) R.string.auth_hide_password else R.string.auth_show_password)
    IconToggleButton(checked = visible, onCheckedChange = onChange, enabled = enabled,
        modifier = Modifier.semantics { contentDescription = label }) {
        val color = LocalContentColor.current
        Canvas(Modifier.size(24.dp)) {
            val unit = size.width / 24f
            val eye = Path().apply {
                moveTo(2 * unit, 12 * unit)
                cubicTo(7 * unit, 3 * unit, 17 * unit, 3 * unit, 22 * unit, 12 * unit)
                cubicTo(17 * unit, 21 * unit, 7 * unit, 21 * unit, 2 * unit, 12 * unit)
                close()
            }
            drawPath(eye, color, style = Stroke(1.8f * unit))
            drawCircle(color, 3 * unit, style = Stroke(1.8f * unit))
            if (visible) drawLine(color, Offset(3 * unit, 3 * unit), Offset(21 * unit, 21 * unit), 1.8f * unit)
        }
    }
}

@Composable private fun AuthNoticeCard(notice: AuthNotice) {
    val info = notice == AuthNotice.CONFIRM_EMAIL || notice == AuthNotice.RECOVERY_SENT
    Surface(color = if (info) MaterialTheme.colorScheme.secondary.copy(alpha = .08f) else MaterialTheme.colorScheme.errorContainer,
        contentColor = if (info) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.onErrorContainer, shape = RoundedCornerShape(12.dp)) {
        Text(stringResource(notice.label()), Modifier.fillMaxWidth().padding(14.dp).semantics { liveRegion = LiveRegionMode.Polite }, style = MaterialTheme.typography.bodyMedium)
    }
}

private fun AuthAction.heading() = when (this) {
    AuthAction.SIGN_IN -> R.string.auth_welcome_back
    AuthAction.REGISTER -> R.string.auth_signup_heading
    AuthAction.CONFIRM -> R.string.auth_confirm_heading
    AuthAction.REQUEST_RECOVERY, AuthAction.RECOVER -> R.string.auth_recovery_heading
    else -> R.string.app_name
}
private fun AuthAction.description(role: UserRole?) = when (this) {
    AuthAction.SIGN_IN -> if (role == UserRole.THERAPIST) R.string.auth_therapist_description else R.string.auth_patient_description
    AuthAction.REGISTER -> R.string.auth_signup_description
    AuthAction.CONFIRM -> R.string.auth_confirm_description
    AuthAction.REQUEST_RECOVERY -> R.string.auth_recovery_description
    AuthAction.RECOVER -> R.string.auth_new_password_description
    else -> R.string.auth_restoring
}
private fun AuthAction.busyLabel() = when (this) {
    AuthAction.SIGN_IN -> R.string.auth_signing_in
    AuthAction.REGISTER -> R.string.auth_creating_account
    AuthAction.CONFIRM -> R.string.auth_verifying
    AuthAction.REQUEST_RECOVERY -> R.string.auth_sending_code
    AuthAction.RESEND_CONFIRMATION -> R.string.auth_sending_code
    AuthAction.SIGN_OUT -> R.string.ui_signing_out
    AuthAction.REFRESH -> R.string.ui_refreshing_session
    AuthAction.RECOVER -> R.string.auth_updating_password
}
private fun AuthAction.label() = when (this) {
    AuthAction.SIGN_IN -> R.string.sign_in
    AuthAction.REGISTER -> R.string.auth_create_account
    AuthAction.CONFIRM -> R.string.auth_verify_email
    AuthAction.REQUEST_RECOVERY -> R.string.auth_send_code
    AuthAction.RESEND_CONFIRMATION -> R.string.auth_resend_code
    AuthAction.RECOVER -> R.string.auth_save_password
    AuthAction.REFRESH -> R.string.refresh_session
    AuthAction.SIGN_OUT -> R.string.sign_out
}
private fun AuthNotice.label() = when (this) {
    AuthNotice.INVALID_EMAIL -> R.string.invalid_email
    AuthNotice.PASSWORD_REQUIRED -> R.string.password_required
    AuthNotice.CODE_REQUIRED -> R.string.code_required
    AuthNotice.CONFIRM_EMAIL -> R.string.confirm_email_notice
    AuthNotice.RECOVERY_SENT -> R.string.recovery_sent_notice
    AuthNotice.REQUEST_FAILED -> R.string.request_failed
    AuthNotice.SESSION_EXPIRED -> R.string.session_expired
    AuthNotice.EMAIL_UNCONFIRMED -> R.string.auth_unconfirmed
    AuthNotice.INVALID_CODE -> R.string.auth_invalid_code
    AuthNotice.RATE_LIMITED -> R.string.auth_rate_limited
    AuthNotice.PASSWORD_POLICY -> R.string.auth_password_policy
}
