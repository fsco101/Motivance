package com.motivance.domain

/**
 * Therapist colleagues (#173): two therapists linked so each can follow the progress of the other's patients, read-only. A patient
 * is seen only if they turned on sharing with their therapist's colleagues. Mirrors web/src/data/colleagues.ts.
 */
enum class ColleagueState { REQUESTED, ACTIVE;
    companion object {fun of(value:String)=entries.firstOrNull {it.name.equals(value,ignoreCase=true)}}
}
data class Colleague(val id:String,val state:ColleagueState,val incoming:Boolean,val otherId:String,val name:String,val photo:String?=null,
    val createdAt:String="",val startedAt:String?=null)
data class ColleaguePatient(val id:String,val name:String,val photo:String?,val therapistId:String,val therapistName:String)
data class OpenedColleaguePatient(val id:String,val name:String,val photo:String?,val therapists:List<String>)
data class ColleagueViewer(val id:String,val name:String,val photo:String?,val lastViewedAt:String?)
data class ColleagueAccess(val sharing:Boolean,val colleagues:List<ColleagueViewer>)
data class ColleaguePlanItem(val assignmentId:String,val exercise:String,val side:String,val low:Double,val high:Double,val repetitions:Int)
data class ColleagueLink(val id:String,val state:ColleagueState,val firstId:String,val firstName:String,val secondId:String,val secondName:String)

interface ColleagueRepository {
    suspend fun loadColleagues():List<Colleague>
    suspend fun inviteColleague(email:String):Colleague
    suspend fun respondColleague(id:String,accept:Boolean):Colleague
    suspend fun endColleague(id:String)
    suspend fun loadColleaguePatients():List<ColleaguePatient>
    /** Must come before any read of the patient's progress: the server audits it and lets the reads through for 30 minutes. */
    suspend fun openColleaguePatient(patientId:String):OpenedColleaguePatient
    suspend fun loadColleaguePlan(patientId:String):List<ColleaguePlanItem>
    suspend fun loadColleagueAccess(patientId:String):ColleagueAccess
    suspend fun loadColleagueSharing():Boolean
    suspend fun setColleagueSharing(granted:Boolean):Boolean
}
