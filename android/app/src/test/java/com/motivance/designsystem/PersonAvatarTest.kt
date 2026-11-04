package com.motivance.designsystem

import org.junit.Assert.*
import org.junit.Test

class PersonAvatarTest {
    private val stored="https://res.cloudinary.com/demo-cloud/image/upload/v1730700000/motivance/avatars/0f8fad5b-d9cb-469f-a165-70867728950e/"+"a".repeat(32)

    @Test fun thumbnailAddsAFaceCroppedSquareJpegTransformation() {
        assertEquals("https://res.cloudinary.com/demo-cloud/image/upload/c_fill,g_face,w_192,h_192,q_auto,f_jpg/v1730700000/motivance/avatars/0f8fad5b-d9cb-469f-a165-70867728950e/"+"a".repeat(32),
            avatarThumbnail(stored,192))
    }
    @Test fun onlyMotivanceCloudinaryPhotosAreFetched() {
        listOf(null,"","http://res.cloudinary.com/demo/image/upload/v1/motivance/avatars/x/y","https://evil.example/avatar.jpg",
            stored.replace("motivance/avatars","other"),"$stored?x=1",stored.replace("/v1730700000/","/c_scale,w_5000/v1/")).forEach {
            assertNull(it,avatarThumbnail(it,96))
        }
    }
    @Test fun thumbnailSizesShareBuckets() {
        assertEquals(96,thumbnailBucket(40));assertEquals(192,thumbnailBucket(150));assertEquals(384,thumbnailBucket(300));assertEquals(384,thumbnailBucket(2000))
    }
    @Test fun initialsUseFirstAndLastWords() {
        assertEquals("MS",initials("Maria Santos"));assertEquals("JC",initials("Jose Dela Cruz"));assertEquals("AD",initials("ada"))
        assertEquals("P0",initials("p0@example.test"));assertEquals("?",initials("  "))
    }
}
