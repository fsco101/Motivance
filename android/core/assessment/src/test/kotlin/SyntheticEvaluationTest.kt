import com.motivance.assessment.MovementAssessment
import com.motivance.domain.*
import java.io.File
import java.util.Locale
import kotlin.math.*
import org.junit.Assert.*
import org.junit.Test

/** Mathematical fixtures only: this deliberately does not estimate clinical accuracy. */
class SyntheticEvaluationTest {
    private fun pose(angle:Double,kind:ExerciseKind,side:BodySide,width:Int,height:Int):List<Landmark> {
        val p=MutableList(33) {Landmark(.5f,.5f,1f)}
        val s=if(side==BodySide.LEFT) 11 else 12
        p[s]=Landmark(.5f,.3f,1f); p[s+12]=Landmark(.5f,.8f,1f)
        val radians=Math.toRadians(angle); val length=min(width,height)*.15
        val dx=sin(radians)*length/width*(if(side==BodySide.LEFT) 1 else -1)
        val dy=cos(radians)*length/height
        if(kind==ExerciseKind.ELBOW_FLEXION) {
            p[s+2]=Landmark(.5f,.5f,1f)
            p[s+4]=Landmark((.5+dx).toFloat(),(.5+dy).toFloat(),1f)
        } else p[s+2]=Landmark((.5+dx).toFloat(),(.3+dy).toFloat(),1f)
        return p
    }
    @Test fun evaluateKnownAnglesAndRepetitionsAcrossAspectRatios() {
        val rows=mutableListOf<String>()
        for(kind in ExerciseKind.entries) for(side in BodySide.entries) for((w,h) in listOf(1000 to 1000,1280 to 720,720 to 1280)) {
            val rules=ExerciseRules(kind=kind,side=side)
            val errors=(0..170 step 10).map { expected ->
                val engine=MovementAssessment(rules)
                repeat(6) {engine.process(listOf(pose(expected.toDouble(),kind,side,w,h)),w,h,(it+1)*100L)}
                abs(expected-engine.snapshot.angleDegrees!!)
            }
            assertTrue("Mathematical angle error",errors.max()<.001)
            val engine=MovementAssessment(rules); var time=0L
            fun frame(angle:Double) {time+=100; engine.process(listOf(pose(angle,kind,side,w,h)),w,h,time)}
            repeat(6) {frame(10.0)}; assertTrue(engine.start(time))
            repeat(10) {listOf(10.0,10.0,40.0,60.0,100.0,100.0,100.0,70.0,40.0,10.0,10.0).forEach(::frame)}
            assertEquals(10,engine.snapshot.completed); assertEquals(0,engine.snapshot.incomplete)
            rows += """{"exercise":"${kind.name}","side":"${side.name}","image":"${w}x$h","known_angles":18,"mae_degrees":${String.format(Locale.ROOT,"%.8f",errors.average())},"max_error_degrees":${String.format(Locale.ROOT,"%.8f",errors.max())},"expected_reps":10,"completed_reps":${engine.snapshot.completed}}"""
        }
        File("build/reports/synthetic-assessment.json").apply { parentFile.mkdirs(); writeText("""{"scope":"Synthetic pixel geometry and deterministic traces; no camera model or human reference","clinical_accuracy":null,"angle_tolerance_degrees":0.001,"results":[${rows.joinToString(",\n")}]}""") }
    }
}
