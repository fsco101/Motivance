package com.motivance.designsystem

import org.junit.Assert.*
import org.junit.Test

class ToasterTest {
    @Test fun everyToastLastsFiveSeconds() {assertEquals(5_000L,TOAST_DURATION_MS)}
    @Test fun theLatestToastWins() {
        val toaster=Toaster()
        toaster.show(1,ToastTone.PENDING);toaster.show(2)
        assertEquals(2,toaster.current.value?.message);assertEquals(ToastTone.SUCCESS,toaster.current.value?.tone)
    }
    @Test fun repeatingTheSameMessageIsANewToast() {
        val toaster=Toaster()
        toaster.show(1);val first=toaster.current.value!!.id
        toaster.show(1)
        assertNotEquals(first,toaster.current.value!!.id)
    }
    @Test fun anExpiredToastCannotDismissItsReplacement() {
        val toaster=Toaster()
        toaster.show(1);val old=toaster.current.value!!.id
        toaster.show(2)
        toaster.dismiss(old)
        assertEquals(2,toaster.current.value?.message)
        toaster.dismiss(toaster.current.value!!.id)
        assertNull(toaster.current.value)
    }
}
