package com.motivance.feature.exercise

import org.json.JSONObject

/**
 * When to ask a patient to record their sessions (#175), the same rules as web/src/features/exercise/video/prompt.ts. Recording
 * stays the patient's choice: once they agree, prescribed sessions start recorded; after Not now they are asked again at most
 * twice, after three prescribed sessions without recording and once more 30 days after that, then never. "Don't ask again" stops
 * it sooner.
 */
data class RecordPrompt(
    /** Agreed to the current recording agreement on this phone. */
    val agreed:Boolean=false,
    /** Chose "Don't ask again". */
    val never:Boolean=false,
    /** How many times they chose Not now when the app asked. */
    val declines:Int=0,
    /** When they last chose Not now. */
    val declinedAt:Long?=null,
    /** Prescribed sessions saved without recording since they last chose Not now. */
    val sessionsSince:Int=0,
)

object RecordPrompts {
    const val ASK_AGAIN_SESSIONS=3
    const val ASK_AGAIN_DAYS=30L
    private const val DAY=86_400_000L

    fun shouldAsk(prompt:RecordPrompt,now:Long):Boolean = when {
        prompt.agreed || prompt.never -> false
        prompt.declines==0 -> true
        prompt.declines==1 -> prompt.sessionsSince>=ASK_AGAIN_SESSIONS
        prompt.declines==2 -> prompt.declinedAt!=null && now-prompt.declinedAt>=ASK_AGAIN_DAYS*DAY
        else -> false
    }

    /** Only a question the app asked counts as one of the times; Not now on the patient's own switch does not. */
    fun declined(prompt:RecordPrompt,now:Long)=prompt.copy(declines=prompt.declines+1,declinedAt=now,sessionsSince=0)
    fun accepted(prompt:RecordPrompt)=prompt.copy(agreed=true)
    fun neverAsk(prompt:RecordPrompt)=prompt.copy(never=true)
    /** A prescribed session saved without recording. The camera check and demonstrations never count. */
    fun unrecorded(prompt:RecordPrompt)=if(prompt.agreed) prompt else prompt.copy(sessionsSince=prompt.sessionsSince+1)

    /** The stored form carries the agreement's version: an agreement to an older text is asked for again. */
    fun write(prompt:RecordPrompt,version:String):String=JSONObject().put("version",version).put("agreed",prompt.agreed).put("never",prompt.never)
        .put("declines",prompt.declines).put("declinedAt",prompt.declinedAt ?: JSONObject.NULL).put("sessionsSince",prompt.sessionsSince).toString()

    fun read(raw:String?,version:String):RecordPrompt=runCatching {
        val j=JSONObject(raw ?: return RecordPrompt())
        RecordPrompt(j.optBoolean("agreed") && j.optString("version")==version,j.optBoolean("never"),j.optInt("declines").coerceAtLeast(0),
            if(j.isNull("declinedAt")) null else j.getLong("declinedAt"),j.optInt("sessionsSince").coerceAtLeast(0))
    }.getOrDefault(RecordPrompt())
}
