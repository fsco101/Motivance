package com.motivance.feature.auth

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.motivance.R

@Composable fun AuthScreen(viewModel: AuthViewModel, openCamera: () -> Unit, role: com.motivance.domain.UserRole? = null, onBack: () -> Unit = {}) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    var action by remember { mutableStateOf(AuthAction.SIGN_IN) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var otp by remember { mutableStateOf("") }
    LaunchedEffect(state.session?.userId,action) {
        password=""; otp=""
        if(state.session!=null) action=AuthAction.SIGN_IN
    }
    LaunchedEffect(state.notice) {
        if(state.notice==AuthNotice.CONFIRM_EMAIL) action=AuthAction.CONFIRM
        if(state.notice==AuthNotice.RECOVERY_SENT) action=AuthAction.RECOVER
    }
    Surface(Modifier.fillMaxSize()) {
        Column(Modifier.padding(24.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(16.dp)) {
            com.motivance.navigation.BrandHeader()
            Text(stringResource(if(role==com.motivance.domain.UserRole.THERAPIST) R.string.clinical_portal else R.string.rehabilitation_portal),style=MaterialTheme.typography.labelLarge,color=MaterialTheme.colorScheme.secondary)
            TextButton(onBack) { Text(stringResource(R.string.choose_role)) }
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
                    if(state.session==null) {
                        Text(stringResource(action.label()),style=MaterialTheme.typography.titleLarge)
                        OutlinedTextField(email,{email=it},label={Text(stringResource(R.string.email))},singleLine=true,enabled=!state.busy,modifier=Modifier.fillMaxWidth())
                        if(action in setOf(AuthAction.SIGN_IN,AuthAction.REGISTER,AuthAction.RECOVER)) {
                            OutlinedTextField(password,{password=it},label={Text(stringResource(R.string.password))},visualTransformation=PasswordVisualTransformation(),singleLine=true,enabled=!state.busy,modifier=Modifier.fillMaxWidth())
                        }
                        if(action in setOf(AuthAction.CONFIRM,AuthAction.RECOVER)) {
                            OutlinedTextField(otp,{otp=it},label={Text(stringResource(R.string.recovery_code))},singleLine=true,enabled=!state.busy,modifier=Modifier.fillMaxWidth())
                        }
                        Button({viewModel.act(action,email,password,otp)},enabled=!state.busy,modifier=Modifier.fillMaxWidth().heightIn(min=56.dp)) { Text(stringResource(action.label())) }
                        if(action==AuthAction.SIGN_IN) {
                            if(role!=com.motivance.domain.UserRole.THERAPIST) TextButton({action=AuthAction.REGISTER},enabled=!state.busy) { Text(stringResource(R.string.register)) }
                            TextButton({action=AuthAction.REQUEST_RECOVERY},enabled=!state.busy) { Text(stringResource(R.string.reset_password)) }
                            TextButton({action=AuthAction.CONFIRM},enabled=!state.busy) { Text(stringResource(R.string.confirm_registration)) }
                        } else TextButton({action=AuthAction.SIGN_IN},enabled=!state.busy) { Text(stringResource(R.string.back_to_sign_in)) }
                    } else {
                        Text(stringResource(R.string.signed_in),style=MaterialTheme.typography.titleLarge)
                        state.session!!.roles.forEach { role -> Text(stringResource(when(role) {
                            com.motivance.domain.UserRole.PATIENT -> R.string.role_patient
                            com.motivance.domain.UserRole.THERAPIST -> R.string.role_therapist
                            com.motivance.domain.UserRole.ADMIN -> R.string.role_admin
                        })) }
                        Text(stringResource(R.string.dashboard_pending))
                        OutlinedButton({viewModel.act(AuthAction.REFRESH)},enabled=!state.busy,modifier=Modifier.fillMaxWidth()) { Text(stringResource(R.string.refresh_session)) }
                        TextButton({viewModel.act(AuthAction.SIGN_OUT)},enabled=!state.busy) { Text(stringResource(R.string.sign_out)) }
                    }
                    if(state.busy) CircularProgressIndicator()
                    state.notice?.let { Text(stringResource(it.label())) }
                }
            }
            Text(stringResource(R.string.camera_privacy))
            Button(openCamera,enabled=!state.busy,modifier=Modifier.fillMaxWidth().heightIn(min=56.dp)) { Text(stringResource(R.string.open_camera)) }
        }
    }
}

private fun AuthAction.label()=when(this) {
    AuthAction.SIGN_IN -> R.string.sign_in
    AuthAction.REGISTER -> R.string.register
    AuthAction.CONFIRM -> R.string.confirm_registration
    AuthAction.REQUEST_RECOVERY -> R.string.reset_password
    AuthAction.RECOVER -> R.string.apply_recovery
    AuthAction.REFRESH -> R.string.refresh_session
    AuthAction.SIGN_OUT -> R.string.sign_out
}
private fun AuthNotice.label()=when(this) {
    AuthNotice.INVALID_EMAIL -> R.string.invalid_email
    AuthNotice.PASSWORD_REQUIRED -> R.string.password_required
    AuthNotice.CODE_REQUIRED -> R.string.code_required
    AuthNotice.CONFIRM_EMAIL -> R.string.confirm_email_notice
    AuthNotice.RECOVERY_SENT -> R.string.recovery_sent_notice
    AuthNotice.REQUEST_FAILED -> R.string.request_failed
    AuthNotice.SESSION_EXPIRED -> R.string.session_expired
}
