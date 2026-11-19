import com.motivance.assessment.*
import com.motivance.domain.*
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

/**
 * Replays shared/assessment/cases.txt through this engine and compares every answer with shared/assessment/expected.txt.
 * The web engine replays the same file against the same answers, so the two apps cannot measure differently.
 * After an intended engine change, regenerate the answers with UPDATE_SHARED_CASES=1 and make the web engine match.
 */
class SharedCasesTest {
    @Test fun engineAnswersMatchTheSharedExpectedResults() {
        val folder=sharedFolder()
        val actual=SharedCaseRunner.run(File(folder,"cases.txt").readLines())
        val expectedFile=File(folder,"expected.txt")
        if(System.getenv("UPDATE_SHARED_CASES")=="1") { expectedFile.writeText(actual.joinToString("\n",postfix="\n")); return }
        if(!expectedFile.exists()) fail("Missing ${expectedFile.path}. Run the tests once with UPDATE_SHARED_CASES=1.")
        val expected=expectedFile.readLines()
        val first=(0 until maxOf(actual.size,expected.size)).firstOrNull {actual.getOrNull(it)!=expected.getOrNull(it)} ?: return
        fail("Shared case answer ${first+1} differs.\nexpected: ${expected.getOrNull(first)}\nactual:   ${actual.getOrNull(first)}")
    }

    private fun sharedFolder():File {
        var dir:File?=File(System.getProperty("user.dir")).absoluteFile
        while(dir!=null) { val candidate=File(dir,"shared/assessment"); if(File(candidate,"cases.txt").exists()) return candidate; dir=dir.parentFile }
        error("shared/assessment/cases.txt not found above ${System.getProperty("user.dir")}")
    }
}

/** Reads the shared command format. Kept in the test source set: it is a test fixture, not engine behaviour. */
object SharedCaseRunner {
    fun run(lines:List<String>):List<String> {
        val out=mutableListOf<String>()
        var name=""; var step=0
        var rules=ExerciseRules(); var width=1000; var height=1000
        var engine=MovementAssessment(rules)
        for(raw in lines) {
            val line=raw.trim()
            if(line.isEmpty() || line.startsWith("#")) continue
            val tokens=line.split(Regex("\\s+"))
            val head="$name ${step++} ${tokens[0]}"
            when(tokens[0]) {
                "case" -> { name=tokens[1]; step=0; rules=ExerciseRules(); width=1000; height=1000; engine=MovementAssessment(rules) }
                "rules" -> { rules=rules(tokens.drop(1)); engine=MovementAssessment(rules) }
                "size" -> { width=tokens[1].toInt(); height=tokens[2].toInt() }
                "frame" -> {
                    val before=engine.snapshot
                    val people=people(tokens.drop(2))
                    val after=engine.process(people,width,height,tokens[1].toLong())
                    val protractor=people.singleOrNull()?.let {MeasurementOverlay.protractor(it,rules,width,height)}
                    out+="$head ${snapshot(after)} ${guide(rules,after)} out=${outcome(before,after)} ${protractor(protractor)}"
                }
                "start" -> { val ok=engine.start(tokens[1].toLong()); out+="$head ok=$ok ${snapshot(engine.snapshot)}" }
                "pause" -> out+="$head ${snapshot(engine.pause(tokens[1].toLong()))}"
                "restore" -> { engine=MovementAssessment(rules,engine.snapshot); out+="$head ${snapshot(engine.snapshot)}" }
                "angle" -> {
                    val (a,b,c)=tokens.subList(1,4).map {it.split(",").let {xy -> Landmark(xy[0].toFloat(),xy[1].toFloat(),1f)}}
                    out+="$head included=${num(JointAngles.included(a,b,c,tokens[4].toInt(),tokens[5].toInt()))}"
                }
                "map" -> {
                    val m=PreviewMapping(tokens[1].toInt(),tokens[2].toInt(),tokens[3].toFloat(),tokens[4].toFloat(),tokens[5].toBoolean())
                    val (x,y)=m.map(Landmark(tokens[6].toFloat(),tokens[7].toFloat(),1f))
                    out+="$head w=${m.width} h=${m.height} left=${m.left} top=${m.top} x=$x y=$y"
                }
                "diag" -> {
                    val d=CameraDiagnostics(tokens[1].toInt())
                    out+="$head "+tokens.drop(2).joinToString(";") {
                        val (t,l)=it.split(":").map(String::toLong); val s=d.record(t,l); "${s.samples},${s.fps},${s.p95LatencyMs}"
                    }
                }
                "policy" -> out+="$head action=${PerformancePolicy.frameAction(tokens[1].toInt(),tokens[2].toLong())}"
                "slow" -> out+="$head slow=${PerformancePolicy.slow(CameraDiagnostics.Snapshot(tokens[1].toInt(),0.0,tokens[2].toLong()))}"
                else -> error("Unknown shared case command: $line")
            }
        }
        return out
    }

    private fun rules(tokens:List<String>):ExerciseRules {
        val v=tokens.associate {it.substringBefore("=") to it.substringAfter("=")}
        val kind=ExerciseKind.valueOf(v["kind"] ?: "ELBOW_FLEXION")
        val joint=v["joint"]?.let(BodyJoint::valueOf) ?: kind.measurementJoint
        val d=ExerciseRules()
        return ExerciseRules(
            kind=kind, side=BodySide.valueOf(v["side"] ?: "LEFT"),
            lowDegrees=v["low"]?.toDouble() ?: d.lowDegrees, highDegrees=v["high"]?.toDouble() ?: d.highDegrees,
            confidence=v["conf"]?.toFloat() ?: d.confidence, stableFrames=v["stable"]?.toInt() ?: d.stableFrames,
            minimumCycleMs=v["min"]?.toLong() ?: d.minimumCycleMs, maximumCycleMs=v["max"]?.toLong() ?: d.maximumCycleMs,
            peakHoldMs=v["hold"]?.toLong() ?: d.peakHoldMs, maxTrunkLeanDegrees=v["lean"]?.toDouble() ?: d.maxTrunkLeanDegrees,
            maxSpeedDegreesPerSecond=v["speed"]?.toDouble() ?: d.maxSpeedDegreesPerSecond,
            demo=v["demo"]?.toBoolean() ?: true, prescriptionVersionId=v["prescription"],
            measuredJoint=joint, exerciseName=v["name"],
        )
    }

    private fun people(tokens:List<String>):List<List<Landmark>> {
        val people=mutableListOf<List<Landmark>>()
        var i=0
        while(i<tokens.size) {
            require(tokens[i]=="p") {"Expected p at ${tokens[i]}"}
            i++
            var length=33
            val points=mutableMapOf<Int,Landmark>()
            while(i<tokens.size && tokens[i]!="p") {
                val token=tokens[i++]
                if(token.startsWith("n=")) length=token.substring(2).toInt()
                else {
                    val (index,value)=token.split(":")
                    val (x,y,visibility)=value.split(",").map(String::toFloat)
                    points[index.toInt()]=Landmark(x,y,visibility)
                }
            }
            people+=List(length) {points[it] ?: Landmark(.5f,.5f,1f)}
        }
        return people
    }

    private fun num(value:Double?)=value?.toString() ?: "-"
    private fun point(p:FramePoint)="${p.x},${p.y}"
    private fun arc(points:List<FramePoint>)="${points.size}:${point(points.first())}:${point(points.last())}"

    private fun snapshot(s:AssessmentSnapshot):String {
        val failures=RepFeedback.entries.mapNotNull {r -> s.failureReasons[r]?.let {"$r:$it"}}.joinToString(",").ifEmpty {"-"}
        return "t=${s.timestampMs} q=${s.quality} a=${num(s.angleDegrees)} min=${num(s.minimumDegrees)} max=${num(s.maximumDegrees)} " +
            "rom=${num(s.romDegrees)} done=${s.completed} inc=${s.incomplete} dur=${s.durationMs} valid=${s.validFrames} " +
            "bad=${s.invalidFrames} ph=${s.phase} fb=${s.feedback} run=${s.running} hold=${s.holdElapsedMs} fail=$failures"
    }

    private fun guide(rules:ExerciseRules,s:AssessmentSnapshot):String {
        val g=RepetitionGuide.of(rules,s)
        return "step=${g.step ?: "-"} prog=${num(g.targetProgress)} hp=${g.holdProgress}"
    }

    private fun outcome(before:AssessmentSnapshot,after:AssessmentSnapshot)=when(val o=RepOutcome.between(before,after)) {
        is RepOutcome.Counted -> "counted:${o.count}"
        is RepOutcome.Missed -> "missed:${o.reason}"
        null -> "-"
    }

    private fun protractor(p:Protractor?):String {
        p ?: return "pr=-"
        return "pr=${p.rawAngleDegrees} v=${point(p.vertex)} ref=${point(p.referenceEnd)} mov=${point(p.movingEnd)} " +
            "arc=${arc(p.measuredArc)} sz=${arc(p.startZone)} tz=${arc(p.targetZone)} " +
            "lt=${point(p.lowTick.first)};${point(p.lowTick.second)} ht=${point(p.highTick.first)};${point(p.highTick.second)} " +
            "ll=${point(p.lowLabel)} hl=${point(p.highLabel)} al=${point(p.angleLabel)}"
    }
}
