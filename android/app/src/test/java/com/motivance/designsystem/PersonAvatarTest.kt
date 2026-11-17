package com.motivance.designsystem

import org.junit.Assert.*
import org.junit.Test

class PersonAvatarTest {
    private val stored="0f8fad5b-d9cb-469f-a165-70867728950e/"+"a".repeat(32)+".webp"

    @Test fun aStoredPathBecomesAPublicStorageAddressOnTheAppsBackend() {
        assertEquals("https://example.supabase.co/storage/v1/object/public/avatars/$stored",avatarAddress(stored,"https://example.supabase.co/"))
        assertEquals("http://10.0.2.2:54321/storage/v1/object/public/avatars/"+stored.replace(".webp",".jpg"),
            avatarAddress(stored.replace(".webp",".jpg"),"http://10.0.2.2:54321"))
    }
    @Test fun onlyMotivancePhotoPathsAreFetched() {
        listOf(null,"","https://res.cloudinary.com/demo/image/upload/v1/motivance/avatars/x/y","https://evil.example/avatar.jpg",
            "../$stored","$stored?x=1",stored.replace(".webp",".png"),"/$stored").forEach {
            assertNull(it,avatarAddress(it,"https://example.supabase.co"))
        }
        assertNull(avatarAddress(stored,""))
    }
    @Test fun initialsUseFirstAndLastWords() {
        assertEquals("MS",initials("Maria Santos"));assertEquals("JC",initials("Jose Dela Cruz"));assertEquals("AD",initials("ada"))
        assertEquals("P0",initials("p0@example.test"));assertEquals("?",initials("  "))
    }
}
