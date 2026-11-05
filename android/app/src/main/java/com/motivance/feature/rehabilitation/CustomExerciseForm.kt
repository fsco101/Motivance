package com.motivance.feature.rehabilitation

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.motivance.R
import com.motivance.designsystem.*
import com.motivance.domain.BodyJoint
import com.motivance.domain.CustomExerciseDraft
import java.util.UUID

/** A therapist's own exercise: the words the patient reads and the joint the camera measures. Targets are set per assignment. */
@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun CustomExerciseForm(enabled:Boolean,saving:Boolean,cancel:()->Unit,save:(CustomExerciseDraft)->Unit) {
    var requestId by rememberSaveable {mutableStateOf(UUID.randomUUID().toString())}
    var name by rememberSaveable {mutableStateOf("")}
    var joint by rememberSaveable {mutableStateOf<BodyJoint?>(null)}
    var english by rememberSaveable {mutableStateOf("")}
    var filipino by rememberSaveable {mutableStateOf("")}
    fun changed() {requestId=UUID.randomUUID().toString()}
    val draft=joint?.let {CustomExerciseDraft(requestId,name,it,english,filipino)}?.takeIf {it.valid}
    Surface(Modifier.fillMaxWidth(),shape=MaterialTheme.shapes.large,color=MaterialTheme.colorScheme.surfaceContainer) {
        Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            Text(stringResource(R.string.custom_exercise_title),style=MaterialTheme.typography.titleMedium)
            Text(stringResource(R.string.custom_exercise_help),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedTextField(name,{name=it.take(CustomExerciseDraft.NAME_LIMIT); changed()},Modifier.fillMaxWidth(),enabled=enabled,singleLine=true,
                label={Text(stringResource(R.string.custom_exercise_name))})
            Text(stringResource(R.string.custom_exercise_joint),style=MaterialTheme.typography.labelLarge)
            FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp),verticalArrangement=Arrangement.spacedBy(4.dp)) {
                BodyJoint.entries.forEach {item ->
                    val selected=joint==item
                    FilterChip(selected,{joint=item; changed()},enabled=enabled,label={Text(stringResource(item.label()))},
                        leadingIcon=if(selected) {{Icon(Icons.Default.Check,null,Modifier.size(18.dp))}} else null)
                }
            }
            joint?.let {Text(stringResource(it.zeroHint()),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
            Text(stringResource(R.string.custom_camera_limit),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedTextField(english,{english=it.take(CustomExerciseDraft.INSTRUCTIONS_LIMIT); changed()},Modifier.fillMaxWidth(),enabled=enabled,minLines=3,
                label={Text(stringResource(R.string.custom_exercise_instructions))})
            OutlinedTextField(filipino,{filipino=it.take(CustomExerciseDraft.INSTRUCTIONS_LIMIT); changed()},Modifier.fillMaxWidth(),enabled=enabled,minLines=3,
                label={Text(stringResource(R.string.custom_exercise_instructions_fil))})
            ActionButton(R.string.custom_exercise_save,{draft?.let(save)},enabled=enabled && draft!=null,busy=saving,busyLabel=R.string.custom_exercise_saving)
            TextButton(cancel,Modifier.heightIn(min=48.dp),enabled=enabled) {Text(stringResource(R.string.custom_exercise_cancel))}
        }
    }
}
