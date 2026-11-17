package com.motivance.feature.exercise

import android.content.Context
import android.content.res.Configuration
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.provider.Settings
import android.speech.tts.TextToSpeech
import androidx.core.content.edit
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.motivance.R
import com.motivance.designsystem.Motion
import java.util.Locale
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.sin

/**
 * The finish tune (#130): a short rising arpeggio, C5 E5 G5 then a held C6, made here from sine waves. It is original to this app, so
 * there is no sound file and no licence to keep track of. Each note starts and ends at silence, so nothing clicks.
 */
object FinishChime {
    const val SAMPLE_RATE=44_100
    /** Frequency in hertz and length in milliseconds. */
    val NOTES=listOf(523.25 to 110,659.25 to 110,783.99 to 110,1046.50 to 340)
    private const val LOUDNESS=.32

    fun samples():ShortArray {
        val out=ArrayList<Short>()
        for((frequency,ms) in NOTES) {
            val count=SAMPLE_RATE*ms/1000
            for(i in 0 until count) {
                val t=i.toDouble()/SAMPLE_RATE
                // A quick rise, then a bell-like fall that reaches silence at the end of the note.
                val attack=minOf(1.0,i/(SAMPLE_RATE*.008))
                val decay=exp(-4.0*i/count)*(1.0-i.toDouble()/count)
                val wave=sin(2*PI*frequency*t)+.3*sin(4*PI*frequency*t)
                out+=(wave/1.3*attack*decay*LOUDNESS*Short.MAX_VALUE).toInt().toShort()
            }
        }
        return out.toShortArray()
    }
}

/** What the voice says at the finish, in one language. [short] takes the repetitions done and the target. */
class FinishLines(private val reached:String,private val short:String,private val dayDone:String) {
    fun lineFor(completed:Int,target:Int,lastOfDay:Boolean):String {
        val line=if(completed>=target) reached else short.format(completed,target)
        return if(lastOfDay) "$line $dayDone" else line
    }
}

/** Whether the finish plays its tune and says its line. On until the patient turns it off; kept with the voice setting. */
class FinishSoundSetting(context:Context) {
    private val preferences=context.getSharedPreferences(FILE,Context.MODE_PRIVATE)
    var enabled:Boolean
        get()=preferences.getBoolean(KEY,true)
        set(value) {preferences.edit {putBoolean(KEY,value)}}
    companion object {
        private const val FILE="session_feedback"
        private const val KEY="finish_sound"
    }
}

/**
 * Plays the tune and speaks the line, at media volume like the spoken cues. Made when the camera opens, so the speech engine is ready
 * by the time the patient finishes. A phone with no usable voice still gets the tune.
 */
internal class FinishPlayer(context:Context,appLanguage:String) {
    private val app=context.applicationContext
    private var speech:TextToSpeech?=null
    private var lines:FinishLines?=null
    private var track:AudioTrack?=null
    private var released=false

    init {
        speech=TextToSpeech(app) {status ->
            val engine=speech
            if(released || status!=TextToSpeech.SUCCESS || engine==null) return@TextToSpeech
            val choice=CueVoice.choose(appLanguage) {engine.isLanguageAvailable(it)>=TextToSpeech.LANG_AVAILABLE} ?: return@TextToSpeech
            if(engine.setLanguage(choice.voice)<TextToSpeech.LANG_AVAILABLE) return@TextToSpeech
            val config=Configuration(app.resources.configuration).apply {setLocale(Locale.forLanguageTag(choice.text))}
            val words=app.createConfigurationContext(config).resources
            lines=FinishLines(words.getString(R.string.cue_finish_target),words.getString(R.string.cue_finish_short),words.getString(R.string.cue_finish_day_done))
        }
    }

    fun chime() {
        if(released) return
        runCatching {
            val pcm=FinishChime.samples()
            track?.release()
            track=AudioTrack.Builder()
                .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(FinishChime.SAMPLE_RATE).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                .setTransferMode(AudioTrack.MODE_STATIC).setBufferSizeInBytes(pcm.size*2).build()
                .apply {write(pcm,0,pcm.size); play()}
        }
    }

    fun say(completed:Int,target:Int,lastOfDay:Boolean) {
        val words=lines ?: return
        speech?.speak(words.lineFor(completed,target,lastOfDay),TextToSpeech.QUEUE_FLUSH,null,"finish")
    }

    fun release() {
        released=true
        speech?.stop(); speech?.shutdown(); speech=null
        track?.release(); track=null
    }
}

/** True when the phone's animations are turned off, so the celebration stays still. */
internal fun reducedMotion(context:Context)=Settings.Global.getFloat(context.contentResolver,Settings.Global.ANIMATOR_DURATION_SCALE,1f)==0f

/**
 * The finish, on the camera screen, before the results: what was done, for a few seconds. The session is already saved, so leaving
 * early loses nothing; a tap goes straight on. Fewer repetitions than the target is still a finish, said kindly.
 */
@Composable internal fun FinishCelebration(completed:Int,target:Int,romDegrees:Double?,lastOfDay:Boolean,still:Boolean,onDone:()->Unit) {
    val reached=completed>=target
    val pop=remember {Animatable(if(still) 1f else .6f)}
    LaunchedEffect(Unit) {if(!still) pop.animateTo(1f,spring(dampingRatio=Spring.DampingRatioMediumBouncy,stiffness=Spring.StiffnessLow))}
    val tap=stringResource(R.string.finish_tap)
    Box(Modifier.fillMaxSize().background(Motion.Night).clickable(onClickLabel=tap,onClick=onDone),contentAlignment=Alignment.Center) {
        Column(Modifier.padding(24.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(14.dp)) {
            Icon(if(reached) Icons.Default.Star else Icons.Default.CheckCircle,null,tint=Motion.SproutBright,modifier=Modifier.size(112.dp).scale(pop.value))
            Text(stringResource(if(reached) R.string.finish_title_target else R.string.finish_title_short),color=Color.White,style=MaterialTheme.typography.displaySmall,
                fontWeight=FontWeight.Bold,textAlign=TextAlign.Center,modifier=Modifier.semantics {heading(); liveRegion=LiveRegionMode.Polite})
            Text(stringResource(R.string.finish_reps,completed,target),color=Color.White,style=MaterialTheme.typography.titleLarge,textAlign=TextAlign.Center)
            romDegrees?.let {Text(stringResource(R.string.finish_range,"%.0f".format(it)),color=Motion.NightInk,style=MaterialTheme.typography.titleMedium,textAlign=TextAlign.Center)}
            if(lastOfDay) Text(stringResource(R.string.finish_day_done),color=Motion.SproutBright,style=MaterialTheme.typography.titleMedium,textAlign=TextAlign.Center)
            Text(tap,color=Motion.NightInk,style=MaterialTheme.typography.bodyMedium,textAlign=TextAlign.Center)
        }
    }
}

/** The finish sound's own switch, beside the voice switch. */
@Composable internal fun FinishSoundToggle(on:Boolean,modifier:Modifier=Modifier,onChange:(Boolean)->Unit) {
    Row(modifier.fillMaxWidth().heightIn(min=52.dp).toggleable(on,role=Role.Switch,onValueChange=onChange),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
        Column(Modifier.weight(1f)) {
            Text(stringResource(if(on) R.string.finish_sound_on else R.string.finish_sound_off),color=Color.White,style=MaterialTheme.typography.titleSmall)
            Text(stringResource(R.string.finish_sound_description),color=Motion.NightInk,style=MaterialTheme.typography.bodySmall)
        }
        Switch(on,null)
    }
}

@Composable internal fun rememberReducedMotion():Boolean {val context=LocalContext.current; return remember {reducedMotion(context)}}
