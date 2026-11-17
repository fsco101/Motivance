package com.motivance.feature.auth

import android.media.ExifInterface
import com.motivance.R
import com.motivance.domain.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.*
import org.junit.Assert.*

@OptIn(ExperimentalCoroutinesApi::class)
class ProfilePhotoTest {
    private val dispatcher=StandardTestDispatcher()
    @Before fun setup() {Dispatchers.setMain(dispatcher)}
    @After fun cleanup() {Dispatchers.resetMain()}

    @Test fun decodeSampleKeepsEnoughDetailForFullZoom() {
        assertEquals(1,decodeSample(800,600))
        assertEquals(2,decodeSample(4000,1600))
        assertEquals(2,decodeSample(4032,3024))
        assertEquals(4,decodeSample(6000,4000))
        assertEquals(1,decodeSample(300,300))
        listOf(4032 to 3024,1024 to 1024,6000 to 2048).forEach {(w,h) -> assertTrue(minOf(w,h)/decodeSample(w,h)>=PHOTO_EDGE*2)}
    }
    @Test fun theCropStartsCentredOnTheWholeShorterSide() {
        assertEquals(CropSquare(100f,0f,600f),cropSquare(800,600,initialCrop(800,600)))
        assertEquals(CropSquare(0f,150f,500f),cropSquare(500,800,initialCrop(500,800)))
        assertEquals(CropSquare(0f,0f,512f),cropSquare(512,512,initialCrop(512,512)))
    }
    @Test fun zoomingKeepsTheCentreWithinLimits() {
        assertEquals(CropSquare(350f,150f,300f),cropSquare(1000,600,zoomCrop(1000,600,initialCrop(1000,600),2f)))
        assertEquals(1f,zoomCrop(1000,600,initialCrop(1000,600),0.2f).zoom)
        assertEquals(MAX_ZOOM,zoomCrop(1000,600,initialCrop(1000,600),40f).zoom)
    }
    @Test fun draggingMovesThePictureUnderTheFrameAndStopsAtItsEdges() {
        // A 300 px viewport shows 600 picture pixels, so dragging 50 px right shows 100 picture pixels further left.
        assertEquals(CropSquare(100f,0f,600f),cropSquare(1000,600,panCrop(1000,600,initialCrop(1000,600),50f,0f,300f)))
        assertEquals(CropSquare(0f,0f,600f),cropSquare(1000,600,panCrop(1000,600,initialCrop(1000,600),5000f,5000f,300f)))
        val corner=panCrop(1000,600,zoomCrop(1000,600,initialCrop(1000,600),3f),-5000f,-5000f,300f)
        assertEquals(CropSquare(800f,400f,200f),cropSquare(1000,600,corner))
        assertEquals(CropSquare(400f,0f,600f),cropSquare(1000,600,zoomCrop(1000,600,corner,1f)))
    }
    @Test fun theCropMatchesTheWebApp() {
        // Same cases as web/src/features/profile/photo.test.ts, so both apps keep the same square for the same gestures.
        assertEquals(CropSquare(0f,0f,600f),cropSquare(1000,600,PhotoCrop(1f,-40f,9999f)))
    }
    @Test fun wholePixelCropsStayInsideThePicture() {
        assertEquals(PixelSquare(200,0,600),cropPixels(1000,600,initialCrop(1000,600)))
        // A third of 1001 does not divide evenly; the square is rounded down and kept inside.
        val edge=cropPixels(1001,1001,panCrop(1001,1001,zoomCrop(1001,1001,initialCrop(1001,1001),3f),-9999f,-9999f,300f))
        assertEquals(333,edge.side);assertTrue(edge.left+edge.side<=1001 && edge.top+edge.side<=1001)
        assertEquals(PixelSquare(0,0,1),cropPixels(1,1,initialCrop(1,1)))
    }
    @Test fun exifOrientationMapsToUprightTransform() {
        assertEquals(0f to false,exifTransform(ExifInterface.ORIENTATION_NORMAL))
        assertEquals(90f to false,exifTransform(ExifInterface.ORIENTATION_ROTATE_90))
        assertEquals(270f to false,exifTransform(ExifInterface.ORIENTATION_ROTATE_270))
        assertEquals(0f to true,exifTransform(ExifInterface.ORIENTATION_FLIP_HORIZONTAL))
        assertEquals(0f to false,exifTransform(ExifInterface.ORIENTATION_UNDEFINED))
    }
    @Test fun profileChangesAreReportedButTheOpeningLoadIsNot()=runTest(dispatcher) {
        val toasts=com.motivance.designsystem.Toaster();val fake=Fake();val vm=PatientProfileViewModel(fake,toasts)
        vm.configure("owner");advanceUntilIdle()
        assertNull(toasts.current.value)
        vm.uploadPhoto(byteArrayOf(1))
        assertEquals(com.motivance.designsystem.ToastTone.PENDING,toasts.current.value?.tone)
        advanceUntilIdle()
        assertEquals(R.string.profile_photo_saved,toasts.current.value?.message)
        fake.uploadFailure=java.io.IOException("fixture")
        vm.uploadPhoto(byteArrayOf(1));advanceUntilIdle()
        assertEquals(com.motivance.designsystem.ToastTone.ERROR,toasts.current.value?.tone)
        assertEquals(vm.state.value.photoError,toasts.current.value?.message)
    }
    @Test fun photoFailuresNameTheirCause() {
        assertEquals(R.string.profile_photo_limit,photoFailure(RemoteFailure(429)))
        assertEquals(R.string.profile_photo_unreadable,photoFailure(UnreadablePhoto()))
        assertEquals(R.string.profile_photo_failed,photoFailure(RemoteFailure(500,"photo_upload")))
        assertEquals(R.string.profile_photo_failed,photoFailure(java.io.IOException()))
    }

    private class Fake:AuthRepository {
        var profile=PatientProfile("fixture_user","Fixture Person","female","1990-01-01","Fixture address","+639001234567",consent=true)
        var uploadFailure:Exception?=null
        var gate:CompletableDeferred<Unit>?=null
        val uploads=mutableListOf<Int>()
        override suspend fun loadProfile()=profile
        override suspend fun uploadProfilePhoto(webp:ByteArray):String {
            uploadFailure?.let {throw it}
            gate?.await()
            uploads+=webp.size;profile=profile.copy(photoUrl="0f8fad5b-d9cb-469f-a165-70867728950e/"+"c".repeat(32)+".webp");return profile.photoUrl!!
        }
        override suspend fun removeProfilePhoto() {profile=profile.copy(photoUrl=null)}
        override suspend fun signIn(email:String,password:String)=UserSession("u",setOf(UserRole.PATIENT))
        override suspend fun register(email:String,password:String) {}
        override suspend fun confirmRegistration(email:String,token:String)=UserSession("u",setOf(UserRole.PATIENT))
        override suspend fun requestRecovery(email:String) {}
        override suspend fun recover(email:String,token:String,newPassword:String)=UserSession("u",setOf(UserRole.PATIENT))
        override suspend fun refresh()=UserSession("u",setOf(UserRole.PATIENT))
        override suspend fun signOut() {}
        override suspend fun loadOverview()=throw UnsupportedOperationException()
    }

    @Test fun uploadAndRemoveRefreshTheProfileAndReportSuccess()=runTest {
        val fake=Fake();val vm=PatientProfileViewModel(fake);vm.configure("u");advanceUntilIdle()
        val gate=CompletableDeferred<Unit>();fake.gate=gate
        vm.uploadPhoto(ByteArray(10));runCurrent()
        assertTrue(vm.state.value.photoBusy);assertTrue(vm.state.value.busy)
        gate.complete(Unit);advanceUntilIdle()
        assertEquals(listOf(10),fake.uploads)
        assertNotNull(vm.state.value.profile?.photoUrl);assertEquals(R.string.profile_photo_saved,vm.state.value.message);assertFalse(vm.state.value.photoBusy)
        vm.removePhoto();advanceUntilIdle()
        assertNull(vm.state.value.profile?.photoUrl);assertEquals(R.string.profile_photo_removed,vm.state.value.message)
    }
    @Test fun photoFailureKeepsTheLoadedProfileAndDoesNotReportAProfileFailure()=runTest {
        val fake=Fake();fake.uploadFailure=RemoteFailure(429)
        val vm=PatientProfileViewModel(fake);vm.configure("u");advanceUntilIdle()
        vm.uploadPhoto(ByteArray(10));advanceUntilIdle()
        assertEquals(R.string.profile_photo_limit,vm.state.value.photoError)
        assertFalse(vm.state.value.failed);assertEquals("fixture_user",vm.state.value.profile?.username)
        vm.photoUnreadable();assertEquals(R.string.profile_photo_unreadable,vm.state.value.photoError)
    }
}
