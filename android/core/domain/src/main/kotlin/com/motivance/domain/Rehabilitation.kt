package com.motivance.domain

data class LinkedPatient(val id:String,val name:String)
data class CatalogueExercise(val id:String,val name:String,val algorithm:String,val instructions:String)
data class PrescriptionSummary(val assignmentId:String,val versionId:String,val patientId:String,val exerciseId:String,val version:Int,val side:String,val low:Double,val high:Double,val repetitions:Int,val parameters:String="{}")
data class PrivacyRequest(val id:String,val kind:String,val status:String)
data class RehabWorkspace(val patients:List<LinkedPatient> = emptyList(),val catalogue:List<CatalogueExercise> = emptyList(),val prescriptions:List<PrescriptionSummary> = emptyList(),val requests:List<PrivacyRequest> = emptyList())
data class PrescriptionDraft(val assignmentId:String,val requestId:String,val patientId:String,val exerciseId:String,val side:BodySide,val low:Double,val high:Double,val repetitions:Int,val minimumCycleMs:Long=600,val maximumCycleMs:Long=30000,val peakHoldMs:Long=100,val maxTrunkLean:Double=20.0,val confidence:Double=.7)
interface RehabilitationRepository {
    suspend fun loadWorkspace():RehabWorkspace
    suspend fun loadHistory(query:HistoryQuery,cursor:HistoryCursor?=null):HistoryPage
    suspend fun invitePatient(email:String):String
    suspend fun acceptInvitation(code:String)
    suspend fun revokeLink(patientId:String)
    suspend fun publishPrescription(draft:PrescriptionDraft)
    suspend fun requestPatientData(id:String,kind:String)
    suspend fun uploadConsent(owner:String,id:String,event:String,version:String,occurredAt:Long)
    suspend fun uploadSession(owner:String,payload:String)
}

/** HTTP status only; raw server payloads and credentials never reach screens/logs. */
class RemoteFailure(val status:Int):Exception("Request failed ($status)") {
    val authenticationRequired get()=status==401
    val retryable get()=status==408 || status==429 || status>=500
}
