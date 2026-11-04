package com.motivance.feature.admin

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.motivance.R
import com.motivance.designsystem.*
import com.motivance.domain.AdminExercise

private const val NAME_LIMIT=120
private const val INSTRUCTION_LIMIT=4000

@Composable internal fun ColumnScope.AdminCatalogue(state:AdministrationState,vm:AdministrationViewModel,confirm:(AdminConfirmation)->Unit) {
    Surface(color=MaterialTheme.colorScheme.surfaceContainerLow,shape=MaterialTheme.shapes.medium) {
        Row(Modifier.fillMaxWidth().padding(16.dp),horizontalArrangement=Arrangement.spacedBy(12.dp)) {
            Icon(Icons.Default.Info,null,tint=MaterialTheme.colorScheme.secondary)
            Text(stringResource(R.string.admin_catalogue_help),style=MaterialTheme.typography.bodySmall)
        }
    }
    val exercises=state.data.exercises
    SectionHeading(R.string.admin_catalogue) {if(exercises.isNotEmpty()) StatusPill(stringResource(R.string.admin_active_count,exercises.count {it.active}),PillTone.PRIMARY)}
    if(exercises.isEmpty() && !state.busy && !state.failed) EmptyState(R.string.admin_catalogue_empty,R.string.admin_catalogue_empty_detail)
    exercises.forEach {exercise -> key(exercise.id,exercise.version) {ExerciseCard(exercise,state,vm,confirm)}}
}

@Composable private fun ExerciseCard(exercise:AdminExercise,state:AdministrationState,vm:AdministrationViewModel,confirm:(AdminConfirmation)->Unit) {
    // Keyed by version, so a successful publish resets the editor to the newly published text.
    var editing by rememberSaveable(exercise.id) {mutableStateOf(false)}
    var name by rememberSaveable(exercise.id,exercise.version) {mutableStateOf(exercise.name)}
    var english by rememberSaveable(exercise.id,exercise.version) {mutableStateOf(exercise.english)}
    var filipino by rememberSaveable(exercise.id,exercise.version) {mutableStateOf(exercise.filipino)}
    val dirty=name!=exercise.name || english!=exercise.english || filipino!=exercise.filipino
    val title=exercise.name.ifBlank {exercise.code}
    ClinicalCard(accent=if(exercise.active) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.outline) {
        Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(14.dp)) {
            IconBadge(Icons.Default.PlayArrow,if(exercise.active) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.outline)
            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(2.dp)) {
                Text(title,style=MaterialTheme.typography.titleMedium)
                Text(listOfNotNull(exercise.code,stringResource(R.string.admin_version,exercise.version),exercise.algorithm.ifBlank {null}).joinToString(" · "),
                    style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
            StatusPill(stringResource(if(exercise.active) R.string.admin_exercise_active else R.string.admin_exercise_inactive),
                if(exercise.active) PillTone.POSITIVE else PillTone.NEUTRAL)
        }
        if(!editing) {
            if(exercise.english.isNotBlank()) Text(exercise.english,style=MaterialTheme.typography.bodyMedium,maxLines=3,
                overflow=androidx.compose.ui.text.style.TextOverflow.Ellipsis,color=MaterialTheme.colorScheme.onSurfaceVariant)
            Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                FilledTonalButton({editing=true},Modifier.weight(1f).heightIn(min=48.dp),enabled=!state.busy) {
                    Icon(Icons.Default.Edit,null,Modifier.size(18.dp));Spacer(Modifier.width(6.dp));Text(stringResource(R.string.admin_edit_instructions))
                }
                StatusToggle(exercise,title,!state.busy,confirm,vm,Modifier.weight(1f))
            }
            return@ClinicalCard
        }
        if(dirty) StatusPill(stringResource(R.string.admin_unsaved),PillTone.ATTENTION,Icons.Default.Edit)
        LimitedField(R.string.admin_name,name,NAME_LIMIT,!state.busy,singleLine=true) {name=it}
        LimitedField(R.string.admin_instructions_en,english,INSTRUCTION_LIMIT,!state.busy) {english=it}
        LimitedField(R.string.admin_instructions_fil,filipino,INSTRUCTION_LIMIT,!state.busy) {filipino=it}
        val valid=name.trim().length in 1..NAME_LIMIT && english.trim().length in 1..INSTRUCTION_LIMIT && filipino.trim().length in 1..INSTRUCTION_LIMIT
        val next=exercise.version+1
        val publishTitle=stringResource(R.string.admin_publish_version,next)
        val publishMessage=stringResource(R.string.admin_confirm_publish,title,next)
        ActionButton(R.string.admin_publish,{confirm(AdminConfirmation(publishTitle,publishMessage,publishTitle,false) {
            vm.publish(exercise.id,name,english,filipino)
        })},enabled=dirty && valid && !state.busy,busy=state.activeAction==AdminAction.PUBLISH,busyLabel=R.string.ui_publishing_catalogue)
        OutlinedButton({name=exercise.name;english=exercise.english;filipino=exercise.filipino;editing=false},
            Modifier.fillMaxWidth().heightIn(min=48.dp),enabled=!state.busy,shape=MaterialTheme.shapes.medium) {
            Text(stringResource(if(dirty) R.string.admin_discard else R.string.admin_close_editor))
        }
    }
}

@Composable private fun StatusToggle(exercise:AdminExercise,title:String,enabled:Boolean,confirm:(AdminConfirmation)->Unit,vm:AdministrationViewModel,modifier:Modifier) {
    val label=stringResource(if(exercise.active) R.string.admin_deactivate else R.string.admin_activate)
    val short=stringResource(if(exercise.active) R.string.admin_deactivate_short else R.string.admin_activate_short)
    val message=stringResource(if(exercise.active) R.string.admin_confirm_deactivate else R.string.admin_confirm_activate,title)
    OutlinedButton({confirm(AdminConfirmation(label,message,short,exercise.active) {vm.exercise(exercise.id,!exercise.active)})},
        modifier.heightIn(min=48.dp),enabled=enabled,
        colors=if(exercise.active) ButtonDefaults.outlinedButtonColors(contentColor=MaterialTheme.colorScheme.error) else ButtonDefaults.outlinedButtonColors()) {
        Text(short,maxLines=1,overflow=androidx.compose.ui.text.style.TextOverflow.Ellipsis,modifier=Modifier.semantics {contentDescription=label})
    }
}

/** Text field with a live character counter; the server trims and enforces the same limits. */
@Composable private fun LimitedField(label:Int,value:String,limit:Int,enabled:Boolean,singleLine:Boolean=false,onChange:(String)->Unit) {
    val blank=value.isBlank()
    OutlinedTextField(value,{onChange(it.take(limit))},Modifier.fillMaxWidth(),enabled=enabled,singleLine=singleLine,
        minLines=if(singleLine) 1 else 3,label={Text(stringResource(label))},isError=blank,shape=RoundedCornerShape(12.dp),
        supportingText={Row {
            Text(if(blank) stringResource(R.string.admin_required) else "",Modifier.weight(1f))
            Text("${value.length} / $limit")
        }})
}
