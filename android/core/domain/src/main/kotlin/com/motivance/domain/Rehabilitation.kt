package com.motivance.domain

data class LinkedPatient(val id:String,val name:String,val profile:PatientProfile?=null,val photoUrl:String?=null)
/** [id] is the published version. [selectable] is false for exercises that stay named on existing plans but cannot be newly assigned. */
data class CatalogueExercise(val id:String,val name:String,val algorithm:String,val instructions:String,val exerciseId:String="",val custom:Boolean=false,val selectable:Boolean=true,val joint:BodyJoint?=null)
/** [id] is chosen once per draft, so retrying after a lost response cannot create a duplicate. */
data class CustomExerciseDraft(val id:String,val name:String,val joint:BodyJoint,val english:String,val filipino:String="") {
    val valid get()=name.trim().length in 1..NAME_LIMIT && english.trim().length in 1..INSTRUCTIONS_LIMIT && filipino.trim().length<=INSTRUCTIONS_LIMIT
    companion object {const val NAME_LIMIT=120; const val INSTRUCTIONS_LIMIT=4000}
}
data class PrescriptionSummary(val assignmentId:String,val versionId:String,val patientId:String,val exerciseId:String,val version:Int,val side:String,val low:Double,val high:Double,val repetitions:Int,val parameters:String="{}")
data class PrivacyRequest(val id:String,val kind:String,val status:String)
/** The newest consent event on the server. Patients can also withdraw on the web, which this phone would otherwise never hear about. */
data class ServerConsent(val id:String,val event:String,val occurredAt:Long) {
    /** True when this phone still trusts a grant the patient has since withdrawn elsewhere. A grant made here afterwards stands. */
    fun withdrawsLocalGrant(localEvent:String?,localOccurredAt:Long?)=event=="withdrawn" && localEvent=="granted" && occurredAt>=(localOccurredAt ?: Long.MAX_VALUE)
}
data class RehabWorkspace(val patients:List<LinkedPatient> = emptyList(),val catalogue:List<CatalogueExercise> = emptyList(),val prescriptions:List<PrescriptionSummary> = emptyList(),val requests:List<PrivacyRequest> = emptyList())
data class PrescriptionDraft(val assignmentId:String,val requestId:String,val patientId:String,val exerciseId:String,val side:BodySide,val low:Double,val high:Double,val repetitions:Int,val minimumCycleMs:Long=600,val maximumCycleMs:Long=30000,val peakHoldMs:Long=100,val maxTrunkLean:Double=20.0,val confidence:Double=.7,val focusJoint:BodyJoint?=null,
    /** Both sides, left first; [side] is then LEFT. */
    val bilateral:Boolean=false,val sideSeconds:Int?=null)
interface RehabilitationRepository {
    suspend fun loadWorkspace():RehabWorkspace
    suspend fun loadHistory(query:HistoryQuery,cursor:HistoryCursor?=null):HistoryPage
    suspend fun invitePatient(email:String):String
    suspend fun acceptInvitation(code:String)
    suspend fun revokeLink(patientId:String)
    suspend fun publishPrescription(draft:PrescriptionDraft)
    /** Returns the published version to prescribe. */
    suspend fun createCustomExercise(draft:CustomExerciseDraft):String
    suspend fun archiveCustomExercise(exerciseId:String)
    suspend fun requestPatientData(id:String,kind:String)
    suspend fun uploadConsent(owner:String,id:String,event:String,version:String,occurredAt:Long)
    suspend fun uploadSession(owner:String,payload:String)
}

/** HTTP status only; raw server payloads and credentials never reach screens/logs. */
class RemoteFailure(val status:Int,val code:String?=null):Exception("Request failed ($status)") {
    val authenticationRequired get()=status==401
    val retryable get()=status==408 || status==429 || status>=500
}
