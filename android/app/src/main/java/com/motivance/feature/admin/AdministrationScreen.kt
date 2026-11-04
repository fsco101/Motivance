package com.motivance.feature.admin

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.motivance.R
import com.motivance.designsystem.PageHeader
import com.motivance.domain.AccountFilter

/**
 * Administrator workspace: an overview of the whole system plus accounts, therapist–patient links, the exercise
 * catalogue and the audit activity feed. Every change is confirmed in a dialog that names the affected record.
 */
@Composable fun ColumnScope.AdministrationScreen(vm:AdministrationViewModel) {
    val state by vm.state.collectAsStateWithLifecycle()
    LaunchedEffect(state.owner) {vm.refresh()}
    var section by rememberSaveable {mutableStateOf(AdminSection.OVERVIEW)}
    var accountFilter by rememberSaveable {mutableStateOf(AccountFilter.ALL)}
    var linkTherapist by rememberSaveable {mutableStateOf("")}
    var linkPatient by rememberSaveable {mutableStateOf("")}
    var confirmation by remember {mutableStateOf<AdminConfirmation?>(null)}
    val confirm:(AdminConfirmation)->Unit={confirmation=it}

    PageHeader(R.string.admin_title,R.string.admin_scope,eyebrow=stringResource(R.string.admin_eyebrow))
    AdminStatus(state) {vm.refresh()}
    ChoiceChips(AdminSection.entries,section,{stringResource(it.label)},{it.icon}) {section=it}
    when(section) {
        AdminSection.OVERVIEW -> AdminOverview(state,open={section=it},accounts={accountFilter=it;section=AdminSection.ACCOUNTS})
        AdminSection.ACCOUNTS -> AdminAccounts(state,vm,accountFilter,{accountFilter=it},confirm) {therapist,patient ->
            linkTherapist=therapist;linkPatient=patient;section=AdminSection.LINKS
        }
        AdminSection.LINKS -> AdminLinks(state,vm,linkTherapist,{linkTherapist=it},linkPatient,{linkPatient=it},confirm)
        AdminSection.CATALOGUE -> AdminCatalogue(state,vm,confirm)
        AdminSection.ACTIVITY -> AdminActivity(state,vm)
    }
    confirmation?.let {AdminConfirmDialog(it) {confirmation=null}}
}
