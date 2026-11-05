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

    @Test fun decodeSampleKeepsTheShorterSideAtLeastTheUploadEdge() {
        assertEquals(1,decodeSample(800,600))
        assertEquals(2,decodeSample(4000,1100))
        assertEquals(4,decodeSample(4032,3024))
        assertEquals(1,decodeSample(300,300))
        listOf(4032 to 3024,1024 to 1024,6000 to 2048).forEach {(w,h) -> assertTrue(minOf(w,h)/decodeSample(w,h)>=PHOTO_EDGE)}
    }
    @Test fun squareCropIsCentred() {
        assertEquals(Triple(100,0,600),squareCrop(800,600))
        assertEquals(Triple(0,150,500),squareCrop(500,800))
        assertEquals(Triple(0,0,512),squareCrop(512,512))
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
        assertEquals(R.string.profile_photo_unconfigured,photoFailure(RemoteFailure(503)))
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
        override suspend fun uploadProfilePhoto(jpeg:ByteArray):String {
            uploadFailure?.let {throw it}
            gate?.await()
            uploads+=jpeg.size;profile=profile.copy(photoUrl="https://res.cloudinary.com/demo/image/upload/v1/p");return profile.photoUrl!!
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
        val fake=Fake();fake.uploadFailure=RemoteFailure(503)
        val vm=PatientProfileViewModel(fake);vm.configure("u");advanceUntilIdle()
        vm.uploadPhoto(ByteArray(10));advanceUntilIdle()
        assertEquals(R.string.profile_photo_unconfigured,vm.state.value.photoError)
        assertFalse(vm.state.value.failed);assertEquals("fixture_user",vm.state.value.profile?.username)
        vm.photoUnreadable();assertEquals(R.string.profile_photo_unreadable,vm.state.value.photoError)
    }
}
