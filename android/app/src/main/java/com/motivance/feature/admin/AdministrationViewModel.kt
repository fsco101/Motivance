package com.motivance.feature.admin

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.motivance.domain.*
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class AdminAction { REFRESH, SEARCH, MORE, ACTIVITY, ACCOUNT, ROLE, LINK, EXERCISE, PUBLISH, PHOTO }
/** Reads only change what is displayed; every other action changes server state and is reported as saved. */
val AdminAction.mutates get()=this !in setOf(AdminAction.REFRESH,AdminAction.SEARCH,AdminAction.MORE,AdminAction.ACTIVITY)

const val ADMIN_SEARCH_LIMIT=100

data class AdministrationState(
    val owner:String="",val data:AdminWorkspace=AdminWorkspace(),val query:String="",val busy:Boolean=false,
    val activeAction:AdminAction?=null,val completedAction:AdminAction?=null,val updated:Boolean=false,val failed:Boolean=false,
)
@HiltViewModel class AdministrationViewModel @Inject constructor(private val repository:AdministrationRepository):ViewModel() {
    private val mutable=MutableStateFlow(AdministrationState())
    val state=mutable.asStateFlow()
    private var job:Job?=null
    private var generation=0L
    fun configure(owner:String?) {
        if(mutable.value.owner==owner.orEmpty()) return
        generation++;job?.cancel();mutable.value=AdministrationState(owner=owner.orEmpty())
    }
    /**
     * Runs one action at a time. The optional [change] is applied first, then [load] produces the new workspace.
     * A response for an earlier account or generation is discarded, and any failure clears loaded records.
     */
    private fun perform(kind:AdminAction,change:suspend ()->Unit={},load:suspend (AdministrationState)->AdminWorkspace={repository.loadAdministration(null,it.query)}) {
        val current=mutable.value
        if(current.owner.isBlank() || current.busy) return
        val ticket=++generation
        mutable.value=current.copy(busy=true,activeAction=kind,completedAction=null,updated=false,failed=false)
        job=viewModelScope.launch {
            try {
                change()
                val data=load(current)
                if(ticket==generation) mutable.value=current.copy(busy=false,activeAction=null,completedAction=kind,updated=kind.mutates,failed=false,data=data)
            } catch(e:CancellationException) {throw e}
            catch(_:Exception) {if(ticket==generation) mutable.value=AdministrationState(owner=current.owner,query=current.query,failed=true)}
        }
    }
    fun refresh()=perform(AdminAction.REFRESH)
    /** Server-side directory search across name, email, username and ID; a blank query restores the full directory. */
    fun search(query:String) {
        val current=mutable.value
        if(current.owner.isBlank() || current.busy) return
        mutable.value=current.copy(query=query.trim().take(ADMIN_SEARCH_LIMIT))
        perform(AdminAction.SEARCH)
    }
    fun older() {
        if(mutable.value.data.next==null) return
        perform(AdminAction.MORE) {s ->
            val page=repository.loadAdministration(s.data.next,s.query)
            page.copy(accounts=(s.data.accounts+page.accounts).distinctBy {it.id},activity=s.data.activity,activityNext=s.data.activityNext)
        }
    }
    fun olderActivity() {
        val before=mutable.value.data.activityNext ?: return
        perform(AdminAction.ACTIVITY) {s ->
            val page=repository.loadActivity(before)
            s.data.copy(activity=(s.data.activity+page.events).distinctBy {it.id},activityNext=page.next)
        }
    }
    fun account(user:String,active:Boolean)=perform(AdminAction.ACCOUNT,{repository.setAccount(user,active)})
    fun role(user:String,role:String,granted:Boolean)=perform(AdminAction.ROLE,{repository.setRole(user,role,granted)})
    fun link(therapist:String,patient:String,active:Boolean)=perform(AdminAction.LINK,{repository.setLink(therapist.trim(),patient.trim(),active)})
    fun exercise(id:String,active:Boolean)=perform(AdminAction.EXERCISE,{repository.setExercise(id,active)})
    fun clearPhoto(user:String)=perform(AdminAction.PHOTO,{repository.clearPhoto(user)})
    fun publish(id:String,name:String,en:String,fil:String)=perform(AdminAction.PUBLISH,{repository.publishExercise(id,name.trim(),en.trim(),fil.trim())})
}
