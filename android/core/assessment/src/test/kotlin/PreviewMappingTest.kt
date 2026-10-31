import com.motivance.assessment.PreviewMapping
import com.motivance.domain.Landmark
import org.junit.Assert.*
import org.junit.Test
class PreviewMappingTest {
    @Test fun letterboxAndMirrorShareGeometry() {
        val normal = PreviewMapping(640,480,1000f,1000f,false)
        val mirrored = PreviewMapping(640,480,1000f,1000f,true)
        assertEquals(125f, normal.top, 0.01f)
        assertEquals(250f, normal.map(Landmark(.25f,.5f,1f)).first, .01f)
        assertEquals(750f, mirrored.map(Landmark(.25f,.5f,1f)).first, .01f)
        assertEquals(500f, mirrored.map(Landmark(.25f,.5f,1f)).second, .01f)
    }
    @Test fun portraitFrame() { assertEquals(125f, PreviewMapping(480,640,1000f,1000f,false).left, .01f) }
    @Test(expected=IllegalArgumentException::class) fun rejectsZeroDimensions() { PreviewMapping(0,640,1000f,1000f,false) }
}
