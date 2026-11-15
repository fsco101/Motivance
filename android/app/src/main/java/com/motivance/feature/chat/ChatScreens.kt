package com.motivance.feature.chat

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.motivance.R
import com.motivance.designsystem.*
import com.motivance.domain.*
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlinx.coroutines.awaitCancellation

private fun time(at:Instant,zone:ZoneId)=DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(Locale.getDefault()).withZone(zone).format(at)
private fun day(at:Instant,zone:ZoneId)=DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(Locale.getDefault()).withZone(zone).format(at)
private fun shortDay(at:Instant,zone:ZoneId)=DateTimeFormatter.ofPattern("MMM d",Locale.getDefault()).withZone(zone).format(at)

@Composable private fun words(message:ChatMessage)=when {
    message.deleted -> stringResource(R.string.chat_deleted)
    message.kind==MessageKind.TEXT || message.kind==MessageKind.SYSTEM -> message.body
    message.kind==MessageKind.ATTACHMENT -> message.body.ifBlank {
        stringResource(if(message.attachment?.kind==MediaKind.VIDEO) R.string.chat_media_video else R.string.chat_media_photo)
    }
    else -> stringResource(R.string.chat_unsupported)
}

/** Every conversation the person has, newest activity first, with what is unread. */
@Composable fun ColumnScope.MessagesScreen(state:ChatState,me:String,asPatient:Boolean,retry:()->Unit,accept:()->Unit,open:(String)->Unit) {
    val zone=remember {ZoneId.systemDefault()}
    PageHeader(R.string.nav_messages,if(asPatient) R.string.chat_description_self else R.string.chat_description)
    if(asPatient && state.consent?.granted==false && state.conversations.isNotEmpty()) AgreementCard(state.consentBusy,accept)
    if(asPatient && state.consent?.granted==true && state.consent.media==false && state.conversations.isNotEmpty()) MediaAgreementCard(state.consentBusy,accept)
    if(state.listLoading && !state.listLoaded) LoadingNotice(R.string.chat_loading)
    if(state.listFailed && state.conversations.isEmpty()) FeedbackNotice(R.string.chat_list_failed,error=true,retry=retry)
    if(state.listLoaded && state.conversations.isEmpty()) {
        EmptyState(if(asPatient) R.string.chat_empty_self_title else R.string.chat_empty_title,if(asPatient) R.string.chat_empty_self_detail else R.string.chat_empty_detail)
        return
    }
    if(state.conversations.isNotEmpty()) ClinicalCard {
        state.conversations.forEachIndexed {index,conversation ->
            if(index>0) HorizontalDivider(color=MaterialTheme.colorScheme.outlineVariant)
            ConversationRow(conversation,me,zone) {open(conversation.id)}
        }
    }
    Text(stringResource(if(asPatient) R.string.chat_urgent_self else R.string.chat_urgent),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable private fun ConversationRow(conversation:Conversation,me:String,zone:ZoneId,open:()->Unit) {
    val name=conversation.otherName.ifBlank {stringResource(R.string.chat_unnamed)}
    val last=conversation.lastMessage?.let {message -> words(message).let {if(message.senderId==me) stringResource(R.string.chat_you_said,it) else it}}
        ?: stringResource(when {
            conversation.consented -> R.string.chat_no_messages_yet
            conversation.asPatient -> R.string.chat_turn_on_to_start
            else -> R.string.chat_not_turned_on
        })
    val unread=if(conversation.unread>0) pluralStringResource(R.plurals.chat_unread,conversation.unread,conversation.unread) else null
    Row(Modifier.fillMaxWidth().heightIn(min=64.dp).clickable(onClickLabel=stringResource(R.string.chat_open)) {open()}
        .semantics(mergeDescendants=true) {contentDescription=listOfNotNull(name,last,unread).joinToString(". ")},
        verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
        PersonAvatar(conversation.otherPhoto,name,44.dp)
        Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment=Alignment.CenterVertically) {
                Text(name,style=MaterialTheme.typography.titleMedium,maxLines=1,overflow=TextOverflow.Ellipsis,modifier=Modifier.weight(1f))
                conversation.lastMessageAt?.let {Text(shortDay(parseServerTime(it),zone),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
            }
            Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                Text(last,style=MaterialTheme.typography.bodyMedium,maxLines=1,overflow=TextOverflow.Ellipsis,modifier=Modifier.weight(1f),
                    fontWeight=if(conversation.unread>0) FontWeight.SemiBold else FontWeight.Normal,
                    color=if(conversation.unread>0) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
                if(conversation.unread>0) Badge(containerColor=MaterialTheme.colorScheme.primary) {Text(if(conversation.unread>99) "99+" else conversation.unread.toString())}
            }
        }
    }
}

/**
 * One conversation, filling the screen: who it is with, the thread with the newest at the bottom, and the box to write in.
 * It keeps its own scrolling, so it sits outside the page's scroll.
 */
@Composable fun ConversationScreen(state:ChatState,me:String,vm:ChatViewModel,modifier:Modifier=Modifier) {
    val zone=remember {ZoneId.systemDefault()}
    val conversation=state.conversation
    Column(modifier.fillMaxSize().imePadding()) {
        if(conversation==null) {
            Column(Modifier.padding(20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
                if(state.wantedOther!=null || state.listLoading || !state.listLoaded) LoadingNotice(R.string.chat_loading)
                else FeedbackNotice(R.string.chat_not_found,error=true)
            }
            return@Column
        }
        val name=conversation.otherName.ifBlank {stringResource(R.string.chat_unnamed)}
        Row(Modifier.fillMaxWidth().padding(horizontal=20.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
            PersonAvatar(conversation.otherPhoto,name,40.dp)
            Column(Modifier.weight(1f)) {
                Text(name,style=MaterialTheme.typography.titleMedium,maxLines=1,overflow=TextOverflow.Ellipsis,modifier=Modifier.semantics {heading()})
                Text(stringResource(if(conversation.asPatient) R.string.chat_your_therapist else R.string.chat_your_patient),style=MaterialTheme.typography.bodySmall,
                    color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if(!state.live) Box(Modifier.semantics {liveRegion=LiveRegionMode.Polite}) {StatusPill(stringResource(R.string.chat_reconnecting),PillTone.NEUTRAL)}
        }
        HorizontalDivider(color=MaterialTheme.colorScheme.outlineVariant)
        val items=remember(state.messages,state.waiting,state.otherReadAt,me) {threadItems(state.messages,state.waiting,me,state.otherReadAt,zone).reversed()}
        val list=rememberLazyListState()
        val newest=items.firstOrNull()?.key
        val newestTheirs=state.messages.firstOrNull {it.senderId!=me}?.id
        // A new message brings the thread to its end, if the reader was there or wrote it. Reading older ones is left alone.
        LaunchedEffect(newest) {
            val mine=(items.firstOrNull() as? ThreadItem.Message)?.mine==true
            if(list.firstVisibleItemIndex<=1 || mine) list.animateScrollToItem(0)
        }
        // Read is told to the server only while the person can see the screen.
        val lifecycle=LocalLifecycleOwner.current
        LaunchedEffect(newestTheirs,state.openId) {
            if(newestTheirs!=null) lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {vm.markRead(); awaitCancellation()}
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                state.threadFailed && !state.threadLoaded -> Box(Modifier.padding(20.dp)) {FeedbackNotice(R.string.chat_thread_failed,error=true) {vm.refresh()}}
                !state.threadLoaded -> Box(Modifier.padding(20.dp)) {LoadingNotice(R.string.chat_loading)}
                items.isEmpty() -> Text(stringResource(if(conversation.asPatient) R.string.chat_start_self else R.string.chat_start,name),
                    textAlign=TextAlign.Center,color=MaterialTheme.colorScheme.onSurfaceVariant,modifier=Modifier.align(Alignment.Center).padding(32.dp))
                else -> LazyColumn(Modifier.fillMaxSize(),state=list,reverseLayout=true,contentPadding=PaddingValues(horizontal=16.dp,vertical=12.dp),
                    verticalArrangement=Arrangement.spacedBy(10.dp)) {
                    items(items,key={it.key}) {item ->
                        when(item) {
                            is ThreadItem.Day -> Box(Modifier.fillMaxWidth(),contentAlignment=Alignment.Center) {
                                Surface(shape=CircleShape,color=MaterialTheme.colorScheme.surfaceContainer) {
                                    Text(day(item.at,zone),style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant,
                                        modifier=Modifier.padding(horizontal=12.dp,vertical=4.dp).semantics {heading()})
                                }
                            }
                            is ThreadItem.Message -> Bubble(item,state.live,me,zone,announce=item.key==newest && !item.mine,
                                waiting=state.waiting.firstOrNull {it.id==item.key}?.media,copy={message,preview -> vm.mediaCopy(message,preview)},
                                onRetry={vm.retry(item.key)},onDiscard={vm.discard(item.key)},onDelete={vm.delete(item.key)})
                        }
                    }
                    if(state.more) item(key="older") {
                        Box(Modifier.fillMaxWidth(),contentAlignment=Alignment.Center) {
                            OutlinedButton({vm.loadOlder()},enabled=!state.olderLoading,modifier=Modifier.heightIn(min=48.dp)) {
                                Text(stringResource(if(state.olderLoading) R.string.chat_older_loading else R.string.chat_older))
                            }
                        }
                    }
                }
            }
        }
        HorizontalDivider(color=MaterialTheme.colorScheme.outlineVariant)
        when {
            state.threadOpen -> {
                state.preparing?.let {(kind,share) ->
                    Text(if(kind==MediaKind.VIDEO) stringResource(R.string.chat_media_preparing_video,(share*100).toInt()) else stringResource(R.string.chat_media_preparing_photo),
                        style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier=Modifier.padding(start=16.dp,top=8.dp).semantics {liveRegion=LiveRegionMode.Polite})
                }
                if(!state.media) Text(if(conversation.asPatient) stringResource(R.string.chat_media_allow_above) else stringResource(R.string.chat_media_not_allowed,name),
                    style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant,modifier=Modifier.padding(start=16.dp,top=8.dp))
                if(conversation.asPatient && !state.media) Box(Modifier.padding(horizontal=16.dp)) {TextButton({vm.setConsent(true)},Modifier.heightIn(min=48.dp)) {Text(stringResource(R.string.chat_agreement_allow_media))}}
                Composer(conversation.id,name,attach={AttachButton(state.media,state.preparing!=null) {uri,mime -> vm.attach(uri,mime)}}) {vm.send(it)}
            }
            state.consented -> Box(Modifier.padding(16.dp)) {FeedbackNotice(R.string.chat_closed)}
            // The agreement is long, so it scrolls above the keyboard rather than pushing the thread away.
            conversation.asPatient -> Column(Modifier.heightIn(max=360.dp).verticalScroll(rememberScrollState()).padding(16.dp)) {AgreementCard(state.consentBusy) {vm.setConsent(true)}}
            else -> Box(Modifier.padding(16.dp)) {Text(stringResource(R.string.chat_waiting_for_patient,name),style=MaterialTheme.typography.bodyMedium,
                color=MaterialTheme.colorScheme.onSurfaceVariant)}
        }
    }
}

/** What a patient agrees to by turning messages on, in the same words as the web. Version care-chat-v2; the fifth point is what v2 added. */
@Composable fun AgreementPoints(only:List<Int>?=null) {
    (only ?: listOf(R.string.chat_agreement_point1,R.string.chat_agreement_point2,R.string.chat_agreement_point3,R.string.chat_agreement_point4,R.string.chat_agreement_point5)).forEach {point ->
        Row(horizontalArrangement=Arrangement.spacedBy(10.dp)) {
            Icon(Icons.Default.CheckCircle,null,Modifier.size(18.dp).padding(top=2.dp),tint=MaterialTheme.colorScheme.primary)
            Text(stringResource(point),style=MaterialTheme.typography.bodyMedium,modifier=Modifier.weight(1f))
        }
    }
}

@Composable private fun AgreementCard(busy:Boolean,accept:()->Unit) {
    ClinicalCard {
        Text(stringResource(R.string.chat_agreement_title),style=MaterialTheme.typography.titleLarge,modifier=Modifier.semantics {heading()})
        Text(stringResource(R.string.chat_agreement_detail),style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
        AgreementPoints()
        ActionButton(R.string.chat_agreement_accept,accept,busy=busy)
    }
}

/** For a patient who agreed before photos and video existed: what they are agreeing to now, and the way to agree. */
@Composable private fun MediaAgreementCard(busy:Boolean,accept:()->Unit) {
    ClinicalCard {
        Text(stringResource(R.string.chat_agreement_media_title),style=MaterialTheme.typography.titleLarge,modifier=Modifier.semantics {heading()})
        Text(stringResource(R.string.chat_agreement_media_detail),style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
        AgreementPoints(listOf(R.string.chat_agreement_point5))
        ActionButton(R.string.chat_agreement_allow_media,accept,busy=busy)
    }
}

/** On Profile, beside the other privacy choices: whether messages are on, and the way to change it. */
@Composable fun ChatConsentCard(state:ChatState,change:(Boolean)->Unit) {
    val consent=state.consent ?: return
    var confirming by remember {mutableStateOf(false)}
    ClinicalCard {
        Text(stringResource(R.string.chat_agreement_profile_title),style=MaterialTheme.typography.titleLarge,modifier=Modifier.semantics {heading()})
        Text(stringResource(R.string.chat_agreement_profile_detail),style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
        StatusPill(stringResource(if(consent.granted) R.string.chat_agreement_on else R.string.chat_agreement_off),if(consent.granted) PillTone.POSITIVE else PillTone.NEUTRAL)
        if(consent.granted && !consent.media) {AgreementPoints(listOf(R.string.chat_agreement_point5)); ActionButton(R.string.chat_agreement_allow_media,{change(true)},busy=state.consentBusy)}
        if(consent.granted) ActionButton(R.string.chat_agreement_turn_off,{confirming=true},outlined=true,busy=state.consentBusy)
        else {AgreementPoints(); ActionButton(R.string.chat_agreement_accept,{change(true)},busy=state.consentBusy)}
    }
    if(confirming) AlertDialog(onDismissRequest={confirming=false},title={Text(stringResource(R.string.chat_agreement_turn_off_title))},
        text={Text(stringResource(R.string.chat_agreement_turn_off_detail))},
        confirmButton={TextButton({confirming=false; change(false)}) {Text(stringResource(R.string.chat_agreement_turn_off))}},
        dismissButton={TextButton({confirming=false}) {Text(stringResource(R.string.chat_agreement_keep_on))}})
}

@Composable private fun Bubble(item:ThreadItem.Message,live:Boolean,me:String,zone:ZoneId,announce:Boolean,waiting:MediaDraft?,copy:suspend (ChatMessage,Boolean)->String?,
    onRetry:()->Unit,onDiscard:()->Unit,onDelete:()->Unit) {
    val message=item.message
    if(message.kind==MessageKind.SYSTEM) {
        Text(message.body,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant,textAlign=TextAlign.Center,modifier=Modifier.fillMaxWidth())
        return
    }
    var asking by remember {mutableStateOf(false)}
    val text=words(message)
    val said=stringResource(if(item.mine) R.string.chat_from_you else R.string.chat_from_them,text)
    val (container,content,border)=when {
        message.deleted -> Triple(MaterialTheme.colorScheme.surface,MaterialTheme.colorScheme.onSurfaceVariant,BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant))
        // Outlined rather than dimmed, so the words keep their contrast.
        item.state==SendState.FAILED -> Triple(MaterialTheme.colorScheme.surface,MaterialTheme.colorScheme.onSurface,BorderStroke(1.5.dp,MaterialTheme.colorScheme.error))
        item.mine -> Triple(MaterialTheme.colorScheme.primary,MaterialTheme.colorScheme.onPrimary,null)
        else -> Triple(MaterialTheme.colorScheme.secondaryContainer,MaterialTheme.colorScheme.onSecondaryContainer,null)
    }
    Column(Modifier.fillMaxWidth(),horizontalAlignment=if(item.mine) Alignment.End else Alignment.Start,verticalArrangement=Arrangement.spacedBy(2.dp)) {
        val media=message.kind==MessageKind.ATTACHMENT && !message.deleted
        if(media) Box(Modifier.semantics {if(announce) liveRegion=LiveRegionMode.Polite}
            .then(if(item.state==SendState.FAILED) Modifier.border(1.5.dp,MaterialTheme.colorScheme.error,RoundedCornerShape(20.dp)).padding(3.dp) else Modifier)) {
            MediaBubble(message,item.mine,waiting,copy)
        }
        if(!media || message.body.isNotBlank()) Surface(color=container,contentColor=content,border=border,
            shape=RoundedCornerShape(topStart=18.dp,topEnd=18.dp,bottomStart=if(item.mine) 18.dp else 4.dp,bottomEnd=if(item.mine) 4.dp else 18.dp),
            modifier=Modifier.widthIn(max=300.dp).semantics {contentDescription=said; if(announce && !media) liveRegion=LiveRegionMode.Polite}) {
            Text(text,style=MaterialTheme.typography.bodyLarge,fontStyle=if(message.deleted) FontStyle.Italic else FontStyle.Normal,
                modifier=Modifier.padding(horizontal=14.dp,vertical=9.dp))
        }
        Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(4.dp)) {
            val quiet=MaterialTheme.colorScheme.onSurfaceVariant
            when(item.state) {
                SendState.SENDING -> Text(stringResource(if(live) R.string.chat_sending else R.string.chat_waiting),style=MaterialTheme.typography.labelSmall,color=quiet)
                SendState.FAILED -> {
                    Icon(Icons.Default.Warning,null,Modifier.size(14.dp),tint=MaterialTheme.colorScheme.error)
                    Text(stringResource(R.string.chat_not_sent),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.error,fontWeight=FontWeight.SemiBold)
                    TextButton(onRetry,Modifier.heightIn(min=48.dp)) {Text(stringResource(R.string.chat_retry))}
                    TextButton(onDiscard,Modifier.heightIn(min=48.dp)) {Text(stringResource(R.string.chat_discard))}
                }
                SendState.SENT -> {
                    Text(time(message.at,zone),style=MaterialTheme.typography.labelSmall,color=quiet)
                    if(item.seen) Text(" · "+stringResource(R.string.chat_seen),style=MaterialTheme.typography.labelSmall,color=quiet)
                    if(message.deletable(me)) TextButton({asking=true},Modifier.heightIn(min=48.dp)) {Text(stringResource(R.string.chat_delete))}
                }
            }
        }
    }
    if(asking) AlertDialog(onDismissRequest={asking=false},title={Text(stringResource(R.string.chat_delete_ask))},text={Text(stringResource(R.string.chat_delete_detail))},
        confirmButton={TextButton({asking=false; onDelete()}) {Text(stringResource(R.string.chat_delete))}},
        dismissButton={TextButton({asking=false}) {Text(stringResource(R.string.chat_delete_no))}})
}

@Composable private fun Composer(conversationId:String,name:String,attach:@Composable ()->Unit={},send:(String)->Unit) {
    var draft by rememberSaveable(conversationId) {mutableStateOf("")}
    val words=draft.trim()
    val left=CHAT_BODY_LIMIT-draft.length
    Row(Modifier.fillMaxWidth().padding(horizontal=12.dp,vertical=8.dp),verticalAlignment=Alignment.Bottom,horizontalArrangement=Arrangement.spacedBy(8.dp)) {
        val label=stringResource(R.string.chat_write_to,name)
        attach()
        OutlinedTextField(draft,{if(it.length<=CHAT_BODY_LIMIT) draft=it},Modifier.weight(1f).semantics {contentDescription=label},
            placeholder={Text(stringResource(R.string.chat_placeholder))},maxLines=5,shape=MaterialTheme.shapes.large,
            supportingText=if(left<=200) ({Text(pluralStringResource(R.plurals.chat_characters_left,left,left))}) else null)
        FilledIconButton({send(words); draft=""},enabled=words.isNotEmpty(),modifier=Modifier.padding(bottom=4.dp).size(52.dp)) {
            Icon(Icons.AutoMirrored.Filled.Send,stringResource(R.string.chat_send))
        }
    }
}
