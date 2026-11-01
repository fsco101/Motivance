package com.motivance.feature.admin

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.motivance.domain.*
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

data class AdministrationState(val owner:String="",val data:AdminWorkspace=AdminWorkspace(),val busy:Boolean=false,val failed:Boolean=false)
@HiltViewModel class AdministrationViewModel @Inject constructor(private val repository:AdministrationRepository):ViewModel() {
    private val mutable=MutableStateFlow(AdministrationState())
    val state=mutable.asStateFlow()
    private var job:Job?=null
    private var generation=0L
    fun configure(owner:String?) {
        if(mutable.value.owner==owner.orEmpty()) return
        generation++;job?.cancel();mutable.value=AdministrationState(owner=owner.orEmpty())
    }
    private fun perform(append:Boolean=false,change:suspend ()->Unit={}) {
        val current=mutable.value
        if(current.owner.isBlank() || current.busy) return
        val ticket=++generation
        mutable.value=current.copy(busy=true,failed=false)
        job=viewModelScope.launch {
            try {
                change()
                val page=repository.loadAdministration(if(append) current.data.next else null)
                if(ticket==generation) mutable.value=current.copy(busy=false,failed=false,data=page.copy(accounts=((if(append) current.data.accounts else emptyList())+page.accounts).distinctBy {it.id}))
            } catch(e:CancellationException) {throw e}
            catch(_:Exception) {if(ticket==generation) mutable.value=AdministrationState(owner=current.owner,failed=true)}
        }
    }
    fun refresh()=perform()
    fun older() {if(mutable.value.data.next!=null) perform(append=true)}
    fun account(user:String,active:Boolean)=perform {repository.setAccount(user,active)}
    fun role(user:String,role:String,granted:Boolean)=perform {repository.setRole(user,role,granted)}
    fun link(therapist:String,patient:String,active:Boolean)=perform {repository.setLink(therapist,patient,active)}
    fun exercise(id:String,active:Boolean)=perform {repository.setExercise(id,active)}
    fun publish(id:String,name:String,en:String,fil:String)=perform {repository.publishExercise(id,name,en,fil)}
}
