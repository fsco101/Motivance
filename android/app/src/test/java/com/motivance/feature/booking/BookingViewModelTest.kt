package com.motivance.feature.booking

import com.motivance.R
import com.motivance.designsystem.Toaster
import com.motivance.designsystem.ToastTone
import com.motivance.domain.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.*
import org.junit.Assert.*

@OptIn(ExperimentalCoroutinesApi::class)
class BookingViewModelTest {
    private val dispatcher=StandardTestDispatcher()
    @Before fun setup() {Dispatchers.setMain(dispatcher)}
    @After fun cleanup() {Dispatchers.resetMain()}

    private val slot=BookingSlot("2026-12-07T01:00:00+00:00","2026-12-07T02:00:00+00:00",2)
    private val booking=Booking("b1","BK-2026-000001",BookingStatus.PENDING,null,slot.startsAt,slot.endsAt,null,null,canCancel=true)

    private inner class Remote:BookingRepository {
        var refusal:RemoteFailure?=null
        var loadFailure:RemoteFailure?=null
        var wait:CompletableDeferred<List<Booking>>?=null
        val requests=mutableListOf<Pair<String,String>>()
        val cancelled=mutableListOf<String>()
        var availabilityLoads=0
        override suspend fun loadAvailability(from:String,to:String):BookingAvailability {
            loadFailure?.let {throw it}
            availabilityLoads++
            return BookingAvailability(listOf(BookingDay("2026-12-07",BookingDayStatus.OPEN,slots=listOf(slot))))
        }
        override suspend fun requestBooking(requestId:String,startsAt:String):Booking {
            requests+=requestId to startsAt
            refusal?.let {throw it}
            return booking
        }
        override suspend fun loadMyBookings():List<Booking> =wait?.let {withContext(NonCancellable) {it.await()}} ?: listOf(booking)
        override suspend fun cancelBooking(id:String) {refusal?.let {throw it};cancelled+=id}
    }

    private fun viewModel(remote:Remote,toasts:Toaster=Toaster())=BookingViewModel(remote,toasts).also {it.configure("owner")}

    @Test fun requestingSendsTheChosenTimeAndReturnsToTheList()=runTest {
        val remote=Remote();val vm=viewModel(remote)
        var finished=false
        vm.selectSlot(slot);vm.request {finished=true};advanceUntilIdle()
        assertEquals(slot.startsAt,remote.requests.single().second)
        assertTrue(finished)
        assertEquals(listOf(booking),vm.state.value.bookings)
        assertNull("The choice ends with the request",vm.state.value.slot)
    }

    /** A lost response must not become a second booking, so a retry of the same time reuses the same ID. */
    @Test fun retryingTheSameTimeReusesItsRequestId()=runTest {
        val remote=Remote();val vm=viewModel(remote)
        remote.refusal=RemoteFailure(503)
        vm.selectSlot(slot);vm.request {};advanceUntilIdle()
        remote.refusal=null
        vm.selectSlot(slot);vm.request {};advanceUntilIdle()
        assertEquals(2,remote.requests.size)
        assertEquals(remote.requests[0].first,remote.requests[1].first)
    }

    @Test fun aNewRequestAfterSuccessGetsANewId()=runTest {
        val remote=Remote();val vm=viewModel(remote)
        vm.selectSlot(slot);vm.request {};advanceUntilIdle()
        vm.selectSlot(slot);vm.request {};advanceUntilIdle()
        assertNotEquals(remote.requests[0].first,remote.requests[1].first)
    }

    @Test fun aRefusalExplainsWhyAndRefreshesTheTimes()=runTest {
        val remote=Remote();val toasts=Toaster();val vm=viewModel(remote,toasts)
        remote.refusal=RemoteFailure(400,"booking_full")
        vm.selectSlot(slot);vm.request {fail("A refused request must not finish")};advanceUntilIdle()
        assertEquals(R.string.booking_error_full,toasts.current.value?.message)
        assertEquals(ToastTone.ERROR,toasts.current.value?.tone)
        assertNull("The time may be gone, so the choice must not stand",vm.state.value.slot)
        assertEquals(1,remote.availabilityLoads)
    }

    @Test fun everyRefusalHasItsOwnWording() {
        mapOf("booking_past" to R.string.booking_error_past,"booking_too_soon" to R.string.booking_error_too_soon,"booking_too_far" to R.string.booking_error_too_far,
            "booking_off_grid" to R.string.booking_error_off_grid,"booking_closed_day" to R.string.booking_error_closed_day,"booking_outside_hours" to R.string.booking_error_outside_hours,
            "booking_holiday" to R.string.booking_error_holiday,"booking_closure" to R.string.booking_error_closure,"booking_full" to R.string.booking_error_full,
            "booking_limit" to R.string.booking_error_limit,"booking_overlap" to R.string.booking_error_overlap,"booking_state" to R.string.booking_error_state,
            "booking_unavailable" to R.string.booking_error_unavailable,"booking_too_late" to R.string.booking_error_too_late).forEach {(code,text) ->
            assertEquals(code,text,bookingFailure(RemoteFailure(400,code)))
        }
        assertEquals(R.string.booking_error_request,bookingFailure(RemoteFailure(500)))
        assertEquals(R.string.booking_error_request,bookingFailure(IllegalStateException("Anything else")))
    }

    /** Tapping Book while the list is still loading must not leave an empty calendar. */
    @Test fun openingTheCalendarWhileTheListLoadsStillLoadsIt()=runTest {
        val remote=Remote();val gate=CompletableDeferred<List<Booking>>();remote.wait=gate
        val vm=viewModel(remote)
        vm.refresh();runCurrent()
        vm.openBooking();runCurrent()
        assertEquals(1,remote.availabilityLoads)
        assertEquals(1,vm.state.value.availability.days.size)
        assertTrue("The list is still on its way",BookingAction.LOAD in vm.state.value.loading)
        gate.complete(listOf(booking));advanceUntilIdle()
        assertEquals(listOf(booking),vm.state.value.bookings)
        assertTrue(vm.state.value.loading.isEmpty())
    }

    @Test fun aFailedReadSaysSoAndCanBeRetried()=runTest {
        val remote=Remote();val toasts=Toaster();val vm=viewModel(remote,toasts)
        remote.loadFailure=RemoteFailure(503)
        vm.openBooking();advanceUntilIdle()
        assertTrue(vm.state.value.failed)
        assertEquals(R.string.booking_load_failed,toasts.current.value?.message)
        remote.loadFailure=null
        vm.openBooking();advanceUntilIdle()
        assertFalse(vm.state.value.failed)
        assertEquals(1,vm.state.value.availability.days.size)
    }

    @Test fun aFullOrHeldSlotCannotBeChosen()=runTest {
        val vm=viewModel(Remote())
        vm.selectSlot(slot.copy(remaining=0));assertNull(vm.state.value.slot)
        vm.selectSlot(slot.copy(mine=true));assertNull(vm.state.value.slot)
    }

    @Test fun choosingAnotherDateClearsTheChosenTime()=runTest {
        val vm=viewModel(Remote())
        vm.selectSlot(slot);vm.selectDate("2026-12-08")
        assertNull(vm.state.value.slot)
    }

    @Test fun cancellingReloadsTheList()=runTest {
        val remote=Remote();val toasts=Toaster();val vm=viewModel(remote,toasts)
        vm.cancel(booking);advanceUntilIdle()
        assertEquals(listOf("b1"),remote.cancelled)
        assertEquals(R.string.booking_cancelled,toasts.current.value?.message)
    }

    @Test fun aLateCancellationIsExplained()=runTest {
        val remote=Remote();val toasts=Toaster();val vm=viewModel(remote,toasts)
        remote.refusal=RemoteFailure(400,"booking_too_late")
        vm.cancel(booking);advanceUntilIdle()
        assertTrue(remote.cancelled.isEmpty())
        assertEquals(R.string.booking_error_too_late,toasts.current.value?.message)
    }

    /** One person's bookings must never appear after another signs in on the same phone. */
    @Test fun aLateResponseCannotLeakAcrossAccounts()=runTest {
        val remote=Remote();val gate=CompletableDeferred<List<Booking>>();remote.wait=gate
        val vm=viewModel(remote)
        vm.refresh();runCurrent()
        vm.configure("someone-else")
        gate.complete(listOf(booking));advanceUntilIdle()
        assertEquals("someone-else",vm.state.value.owner)
        assertTrue(vm.state.value.bookings.isEmpty())
    }

    @Test fun signingOutClearsEverything()=runTest {
        val vm=viewModel(Remote())
        vm.refresh();advanceUntilIdle()
        assertTrue(vm.state.value.bookings.isNotEmpty())
        vm.configure(null)
        assertTrue(vm.state.value.bookings.isEmpty())
        assertEquals("",vm.state.value.owner)
    }
}
