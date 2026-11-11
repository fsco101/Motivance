package com.motivance.feature.exercise

import android.content.Context
import android.content.res.Configuration
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import com.motivance.R
import com.motivance.assessment.RepOutcome
import com.motivance.domain.BodySide
import com.motivance.domain.RepFeedback
import java.util.Locale
import kotlin.random.Random

/** The words for one repetition result (issue #96). Praise rotates, and the line just spoken is never picked again next. */
class RepCueScript(private val counted:List<String>,private val missed:Map<RepFeedback,String>,private val random:Random=Random.Default) {
    private var last:String?=null
    fun lineFor(outcome:RepOutcome):String {
        val line=when(outcome) {
            is RepOutcome.Counted -> counted.filter {it!=last}.ifEmpty {counted}.random(random)
            is RepOutcome.Missed -> missed[outcome.reason] ?: missed.getValue(RepFeedback.INCOMPLETE_RANGE)
        }
        last=line
        return line
    }
}

/** The voice to use. The app's language when the phone can speak it, else English, as the owner chose for #96. */
object CueVoice {
    /** [voice] is the speaking locale; [text] is the language of the phrases to load ("en" or "fil"). */
    data class Choice(val voice:Locale,val text:String)
    private val filipino=listOf(Locale.forLanguageTag("fil-PH"),Locale.forLanguageTag("tl-PH"))
    fun choose(appLanguage:String,speaks:(Locale)->Boolean):Choice? {
        if(appLanguage=="fil") filipino.firstOrNull(speaks)?.let {return Choice(it,"fil")}
        return Locale.US.takeIf(speaks)?.let {Choice(it,"en")}
    }
}

/**
 * Speaks each result with the phone's text-to-speech. A phone with no usable voice gets a short tone instead, so a
 * result is never silent while the voice is on. Speech runs in the speech service, off the camera and counting path,
 * and a new result interrupts the previous phrase rather than queueing behind it.
 */
internal class RepCuePlayer(context:Context,appLanguage:String) {
    private val app=context.applicationContext
    private var script:RepCueScript?=null
    private var setLines:SetCueLines?=null
    private val main=Handler(Looper.getMainLooper())
    /** Called once the next-side announcement has been spoken, so the countdown never talks over it. */
    private var announced:(()->Unit)?=null
    private var tone:ToneGenerator?=null
    private var speech:TextToSpeech?=null
    private var released=false
    private companion object {const val SIDE_DONE="side-done"}

    init {
        // With no speech engine installed, Android reports the failure before the constructor returns.
        speech=TextToSpeech(app) {status -> ready(status,appLanguage)}
    }

    private fun ready(status:Int,appLanguage:String) {
        if(released) return
        val engine=speech
        val choice=if(status==TextToSpeech.SUCCESS && engine!=null) CueVoice.choose(appLanguage) {engine.isLanguageAvailable(it)>=TextToSpeech.LANG_AVAILABLE} else null
        if(engine==null || choice==null || engine.setLanguage(choice.voice)<TextToSpeech.LANG_AVAILABLE) {
            runCatching {tone=ToneGenerator(AudioManager.STREAM_MUSIC,70)}
            return
        }
        engine.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
        engine.setOnUtteranceProgressListener(object:UtteranceProgressListener() {
            override fun onStart(id:String?) {}
            override fun onDone(id:String?) {if(id==SIDE_DONE) main.post {announced?.invoke(); announced=null}}
            override fun onStop(id:String?,interrupted:Boolean) {onDone(id)}
            @Deprecated("Replaced by onError(String, Int)") override fun onError(id:String?) {onDone(id)}
            override fun onError(id:String?,errorCode:Int) {onDone(id)}
        })
        script=scriptIn(choice.text)
        setLines=setLinesIn(choice.text)
    }

    private fun scriptIn(language:String):RepCueScript {
        val config=Configuration(app.resources.configuration).apply {setLocale(Locale.forLanguageTag(language))}
        val words=app.createConfigurationContext(config).resources
        return RepCueScript(words.getStringArray(R.array.cue_counted).toList(),mapOf(
            RepFeedback.INCOMPLETE_RANGE to words.getString(R.string.cue_missed_range),
            RepFeedback.TOO_FAST to words.getString(R.string.cue_missed_fast),
            RepFeedback.TIMED_OUT to words.getString(R.string.cue_missed_slow)))
    }

    private fun setLinesIn(language:String):SetCueLines {
        val config=Configuration(app.resources.configuration).apply {setLocale(Locale.forLanguageTag(language))}
        val words=app.createConfigurationContext(config).resources
        return SetCueLines(words.getString(R.string.cue_target_keep_going),words.getString(R.string.cue_side_done),words.getString(R.string.cue_go),
            words.getString(R.string.cue_set_complete),mapOf(BodySide.LEFT to words.getString(R.string.left_side),BodySide.RIGHT to words.getString(R.string.right_side)))
    }

    /**
     * Speaks a set announcement after whatever is already playing, so it never cuts off the last repetition's result.
     * [finished] runs once a next-side announcement is over; without a voice there is nothing to wait for.
     */
    fun announce(cue:SetCue,exerciseName:String,finished:()->Unit) {
        val lines=setLines
        val engine=speech
        if(lines!=null && engine!=null) {
            if(cue is SetCue.SideDone) announced=finished
            engine.speak(lines.lineFor(cue,exerciseName),TextToSpeech.QUEUE_ADD,null,if(cue is SetCue.SideDone) SIDE_DONE else "set")
        } else {
            tone?.startTone(when(cue) {is SetCue.Count -> ToneGenerator.TONE_PROP_BEEP; SetCue.Go -> ToneGenerator.TONE_PROP_ACK; else -> ToneGenerator.TONE_PROP_BEEP2},180)
            if(cue is SetCue.SideDone) finished()
        }
    }

    fun play(outcome:RepOutcome) {
        val words=script
        val engine=speech
        if(words!=null && engine!=null) engine.speak(words.lineFor(outcome),TextToSpeech.QUEUE_FLUSH,null,"repetition")
        else tone?.startTone(if(outcome is RepOutcome.Counted) ToneGenerator.TONE_PROP_ACK else ToneGenerator.TONE_PROP_NACK,180)
    }

    fun release() {
        released=true
        announced=null
        speech?.stop(); speech?.shutdown(); speech=null
        tone?.release(); tone=null
        script=null
    }
}
