package com.motivance.domain

data class AdminAccount(val id:String,val name:String,val active:Boolean,val roles:Set<String>)
data class AdminLink(val therapist:String,val patient:String,val active:Boolean)
data class AdminExercise(val id:String,val code:String,val active:Boolean,val version:Int,val name:String,val english:String,val filipino:String)
data class AdminWorkspace(val accounts:List<AdminAccount> = emptyList(),val links:List<AdminLink> = emptyList(),val exercises:List<AdminExercise> = emptyList(),val next:String?=null)
interface AdministrationRepository {
    suspend fun loadAdministration(after:String?=null):AdminWorkspace
    suspend fun setAccount(user:String,active:Boolean)
    suspend fun setRole(user:String,role:String,granted:Boolean)
    suspend fun setLink(therapist:String,patient:String,active:Boolean)
    suspend fun setExercise(exercise:String,active:Boolean)
    suspend fun publishExercise(exercise:String,name:String,english:String,filipino:String)
}
