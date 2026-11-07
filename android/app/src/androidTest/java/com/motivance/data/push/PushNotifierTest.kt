package com.motivance.data.push

import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** Shows a real notification on a real Android system, the way the messaging service does when FCM delivers one. */
@RunWith(AndroidJUnit4::class)
class PushNotifierTest {
    private val context=ApplicationProvider.getApplicationContext<Context>()
    private val manager get()=context.getSystemService(NotificationManager::class.java)

    @Before fun allow() {
        InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("pm grant ${context.packageName} android.permission.POST_NOTIFICATIONS").close()
        manager.cancelAll()
        shown(0)
    }
    @After fun clear() {manager.cancelAll()}

    /** Posting is asynchronous, so the system is given a moment to show what was asked for. */
    private fun shown(count:Int=1):List<Notification> {
        repeat(50) {
            if(manager.activeNotifications.size==count) return manager.activeNotifications.map {it.notification}
            Thread.sleep(100)
        }
        return manager.activeNotifications.map {it.notification}
    }

    @Test fun aReceivedMessageBecomesANotification() {
        PushNotifier.show(context,mapOf("title" to "Your session is confirmed","body" to "Your session on Monday is confirmed with Dana.","kind" to "confirmed","booking_id" to "b1"))
        val note=shown().single()
        assertEquals("Your session is confirmed",note.extras.getString(Notification.EXTRA_TITLE))
        assertEquals("Your session on Monday is confirmed with Dana.",note.extras.getCharSequence(Notification.EXTRA_TEXT).toString())
    }

    @Test fun aLockScreenSeesOnlyThatThereIsNews() {
        PushNotifier.show(context,mapOf("title" to "New session: Ana Dela Cruz","body" to "Ana Dela Cruz is booked with you on Monday."))
        val note=shown().single()
        assertEquals(Notification.VISIBILITY_PRIVATE,note.visibility)
        val hidden=note.publicVersion.extras.getString(Notification.EXTRA_TITLE).orEmpty()
        assertTrue(hidden.isNotBlank())
        assertFalse(hidden.contains("Ana"))
    }

    @Test fun tappingOpensTheApp() {
        PushNotifier.show(context,mapOf("title" to "A place has opened","body" to "A place has opened on Monday."))
        assertNotNull(shown().single().contentIntent)
    }

    @Test fun aMessageWithNothingToSayShowsNothing() {
        PushNotifier.show(context,mapOf("title" to "","body" to ""))
        PushNotifier.show(context,emptyMap())
        Thread.sleep(1_000)
        assertTrue(shown(0).isEmpty())
    }

    @Test fun twoMessagesAreTwoNotifications() {
        PushNotifier.show(context,mapOf("title" to "One","body" to "First","kind" to "confirmed","booking_id" to "b1"))
        PushNotifier.show(context,mapOf("title" to "Two","body" to "Second","kind" to "reminder","booking_id" to "b1"))
        assertEquals(2,shown(2).size)
    }
}
