package com.motivance.feature.notifications

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.motivance.R
import com.motivance.designsystem.ToastTone
import com.motivance.designsystem.Toaster
import com.motivance.domain.*
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

data class NotificationsState(val owner:String="",val inbox:NotificationInbox=NotificationInbox(),val loading:Boolean=false,val failed:Boolean=false,val loaded:Boolean=false)

@HiltViewModel class NotificationsViewModel @Inject constructor(private val repository:NotificationRepository,private val toasts:Toaster=Toaster()):ViewModel() {
    private val mutable=MutableStateFlow(NotificationsState())
    val state=mutable.asStateFlow()
    private var job:Job?=null

    fun configure(owner:String?) {
        if(mutable.value.owner==owner.orEmpty()) return
        job?.cancel()
        mutable.value=NotificationsState(owner=owner.orEmpty())
    }

    /** What is on screen stays while it reads, and a result for an account that has since signed out is ignored. */
    fun refresh() {
        val owner=mutable.value.owner
        if(owner.isBlank()) return
        job?.cancel()
        mutable.value=mutable.value.copy(loading=true,failed=false)
        job=viewModelScope.launch {
            try {
                val inbox=repository.loadNotifications()
                if(mutable.value.owner==owner) mutable.value=mutable.value.copy(inbox=inbox,loading=false,loaded=true)
            } catch(e:CancellationException) {throw e}
            catch(_:Exception) {
                // The bell checks quietly in the background, so a dropped connection only needs saying if there is nothing to show.
                if(mutable.value.owner==owner) mutable.value=mutable.value.copy(loading=false,failed=true)
            }
        }
    }

    private fun mark(ids:List<String>?) {
        val owner=mutable.value.owner
        if(owner.isBlank()) return
        val now=java.time.Instant.now().toString()
        val inbox=mutable.value.inbox
        val items=inbox.items.map {if(it.unread && (ids==null || it.id in ids)) it.copy(readAt=now) else it}
        mutable.value=mutable.value.copy(inbox=inbox.copy(unread=items.count {it.unread},items=items))
        viewModelScope.launch {
            try {
                val unread=repository.markNotificationsRead(ids)
                if(mutable.value.owner==owner) mutable.value=mutable.value.let {it.copy(inbox=it.inbox.copy(unread=unread))}
            } catch(e:CancellationException) {throw e}
            catch(_:Exception) {
                if(mutable.value.owner==owner) {
                    toasts.show(R.string.notifications_failed,ToastTone.ERROR)
                    refresh()
                }
            }
        }
    }

    fun open(note:AppNotification) {if(note.unread) mark(listOf(note.id))}
    fun markAllRead() {if(mutable.value.inbox.unread>0) mark(null)}
}
