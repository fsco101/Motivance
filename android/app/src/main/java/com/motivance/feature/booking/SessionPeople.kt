package com.motivance.feature.booking

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.motivance.R
import com.motivance.designsystem.PersonAvatar
import com.motivance.domain.VISIT_REASON_MAX
import com.motivance.domain.VISIT_REASON_MIN

/** One person in a session, as the web app's session card shows them. [you] marks the reader's own place. */
data class SessionPerson(val name:String?,val photo:String?,val you:Boolean=false)

/**
 * Both people in a session, each as a small profile card with their face, part and name. Side by side when there is room,
 * stacked on a narrow phone or with large text. A therapist not yet chosen still has a place.
 */
@Composable fun SessionPeople(patient:SessionPerson,therapist:SessionPerson) {
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val tiles=listOf(patient to R.string.booking_patient_role,therapist to R.string.booking_therapist_role)
        if(maxWidth>=420.dp) Row(Modifier.height(IntrinsicSize.Min),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            tiles.forEach {(person,role) -> PersonTile(person,role,Modifier.weight(1f).fillMaxHeight())}
        } else Column(verticalArrangement=Arrangement.spacedBy(8.dp)) {
            tiles.forEach {(person,role) -> PersonTile(person,role,Modifier.fillMaxWidth())}
        }
    }
}

@Composable private fun PersonTile(person:SessionPerson,role:Int,modifier:Modifier) {
    val missing=person.name.isNullOrBlank()
    val name=if(missing) stringResource(R.string.booking_no_therapist) else person.name!!
    val part=stringResource(role)+if(person.you) " · "+stringResource(R.string.booking_you) else ""
    Surface(modifier.semantics(mergeDescendants=true) {},shape=MaterialTheme.shapes.medium,color=MaterialTheme.colorScheme.surface,
        border=BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant)) {
        Row(Modifier.padding(12.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
            if(missing) Box(Modifier.size(48.dp).border(1.dp,MaterialTheme.colorScheme.outline,CircleShape),contentAlignment=Alignment.Center) {
                Text("?",style=MaterialTheme.typography.titleMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
            } else PersonAvatar(person.photo,name,48.dp)
            Column(verticalArrangement=Arrangement.spacedBy(2.dp)) {
                Text(part.uppercase(),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                Text(name,style=MaterialTheme.typography.titleSmall,fontWeight=if(missing) FontWeight.Normal else FontWeight.SemiBold,
                    color=if(missing) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface)
            }
        }
    }
}

/** Why the patient is coming, kept as they wrote it. Older bookings have none, and then nothing is shown. */
@Composable fun VisitReasonBox(reason:String?) {
    if(reason.isNullOrBlank()) return
    Surface(Modifier.fillMaxWidth().semantics(mergeDescendants=true) {},shape=MaterialTheme.shapes.medium,color=MaterialTheme.colorScheme.surfaceVariant) {
        Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(2.dp)) {
            Text(stringResource(R.string.booking_visit_reason).uppercase(),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            Text(reason,style=MaterialTheme.typography.bodyMedium)
        }
    }
}

/**
 * The reason for a visit, as the patient writes it. The count shows how much room is left, and the error appears only once
 * they have tried to send, so it does not scold them while they type.
 */
@Composable fun VisitReasonField(value:String,onChange:(String)->Unit,showError:Boolean,enabled:Boolean=true) {
    val length=value.trim().length
    val invalid=length<VISIT_REASON_MIN || length>VISIT_REASON_MAX
    OutlinedTextField(value,{onChange(it.take(VISIT_REASON_MAX))},Modifier.fillMaxWidth(),enabled=enabled,minLines=3,
        label={Text(stringResource(R.string.booking_visit_reason))},isError=showError && invalid,
        supportingText={
            Column {
                Text(stringResource(if(showError && invalid) R.string.booking_visit_reason_error else R.string.booking_visit_reason_hint))
                Text(stringResource(R.string.booking_visit_reason_count,value.length),modifier=Modifier.align(Alignment.End))
            }
        })
}
