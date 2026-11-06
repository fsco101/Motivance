package com.motivance.feature.booking

import com.motivance.designsystem.Toaster
import com.motivance.domain.*
import java.time.LocalDate
import java.time.YearMonth
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.*
import org.junit.Assert.*

@OptIn(ExperimentalCoroutinesApi::class)
class ScheduleViewModelTest {
    private val dispatcher=StandardTestDispatcher()
    @Before fun setup() {Dispatchers.setMain(dispatcher)}
    @After fun cleanup() {Dispatchers.resetMain()}

    private val soon=centerToday().plusDays(2)
    private val later=centerToday().plusDays(5)

    private fun session(date:LocalDate)=ScheduleSession("s$date","BK-2026-000001",BookingStatus.CONFIRMED,"${date}T01:00:00+00:00","${date}T02:00:00+00:00")
    private fun day(date:LocalDate)=ScheduleDay(date.toString(),BookingDayStatus.OPEN,rows=listOf(ScheduleRow("${date}T01:00:00+00:00","${date}T02:00:00+00:00",session(date))))

    private inner class Remote:BookingRepository {
        val reads=mutableListOf<Triple<String,String,Boolean>>()
        var failure:RemoteFailure?=null
        var result=Schedule(listOf(day(soon),day(later)))
        val waits=ArrayDeque<CompletableDeferred<Schedule>>()
        override suspend fun loadSchedule(from:String,to:String,therapist:Boolean):Schedule {
            reads+=Triple(from,to,therapist)
            failure?.let {throw it}
            return waits.removeFirstOrNull()?.let {withContext(NonCancellable) {it.await()}} ?: result
        }
        override suspend fun loadAvailability(from:String,to:String)=BookingAvailability()
        override suspend fun requestBooking(requestId:String,startsAt:String):Booking=throw AssertionError("A schedule requests nothing")
        override suspend fun loadMyBookings()=emptyList<Booking>()
        override suspend fun cancelBooking(id:String) {}
    }

    private fun viewModel(remote:Remote,therapist:Boolean=false)=ScheduleViewModel(remote,Toaster()).also {it.configure("owner",therapist)}

    @Test fun aMonthOpensOnTheNextSession()=runTest {
        val remote=Remote();val vm=viewModel(remote)
        vm.open();advanceUntilIdle()
        val month=YearMonth.from(centerToday())
        assertEquals(Triple(month.atDay(1).toString(),month.atEndOfMonth().toString(),false),remote.reads.single())
        assertEquals(soon.toString(),vm.state.value.date)
        assertTrue(vm.state.value.loaded)
    }

    @Test fun aTherapistReadsTheirOwnSchedule()=runTest {
        val remote=Remote();val vm=viewModel(remote,therapist=true)
        vm.open();advanceUntilIdle()
        assertTrue(remote.reads.single().third)
    }

    @Test fun refreshingKeepsTheDateAlreadyChosen()=runTest {
        val remote=Remote();val vm=viewModel(remote)
        vm.open();advanceUntilIdle()
        vm.selectDate(later.toString())
        vm.open();advanceUntilIdle()
        assertEquals(later.toString(),vm.state.value.date)
    }

    /** The old month's sessions must not sit under the new month's name while it loads. */
    @Test fun turningTheMonthClearsWhatBelongedToTheOldOne()=runTest {
        val remote=Remote();val vm=viewModel(remote)
        vm.open();advanceUntilIdle()
        val next=YearMonth.from(centerToday()).plusMonths(1)
        remote.waits.addLast(CompletableDeferred())
        vm.showMonth(next);runCurrent()
        assertEquals(next,vm.state.value.month)
        assertNull(vm.state.value.date)
        assertTrue(vm.state.value.schedule.days.isEmpty())
        assertFalse(vm.state.value.loaded)
        remote.waits.clear()
    }

    @Test fun aSlowReadForAnEarlierMonthCannotOverwriteALaterOne()=runTest {
        val remote=Remote();val vm=viewModel(remote)
        val slow=CompletableDeferred<Schedule>()
        remote.waits.addLast(slow)
        vm.open();runCurrent()
        val next=YearMonth.from(centerToday()).plusMonths(1)
        val wanted=Schedule(listOf(day(next.atDay(10))))
        remote.result=wanted
        vm.showMonth(next);advanceUntilIdle()
        slow.complete(Schedule(listOf(day(soon))));advanceUntilIdle()
        assertEquals(wanted,vm.state.value.schedule)
    }

    @Test fun aResultForAnotherAccountIsIgnored()=runTest {
        val remote=Remote();val vm=viewModel(remote)
        val slow=CompletableDeferred<Schedule>()
        remote.waits.addLast(slow)
        vm.open();runCurrent()
        vm.configure("someone-else",false)
        slow.complete(Schedule(listOf(day(soon))));advanceUntilIdle()
        assertTrue(vm.state.value.schedule.days.isEmpty())
        assertEquals("someone-else",vm.state.value.owner)
    }

    /** Someone with both roles must not see one workspace's sessions under the other. */
    @Test fun changingWorkspaceStartsAgain()=runTest {
        val remote=Remote();val vm=viewModel(remote)
        vm.open();advanceUntilIdle()
        vm.configure("owner",true)
        assertTrue(vm.state.value.schedule.days.isEmpty())
        assertTrue(vm.state.value.therapist)
    }

    @Test fun aFailedReadSaysSoAndCanBeRetried()=runTest {
        val remote=Remote();val vm=viewModel(remote)
        remote.failure=RemoteFailure(503)
        vm.open();advanceUntilIdle()
        assertTrue(vm.state.value.failed)
        assertFalse(vm.state.value.loading)
        remote.failure=null
        vm.open();advanceUntilIdle()
        assertFalse(vm.state.value.failed)
        assertEquals(soon.toString(),vm.state.value.date)
    }

    @Test fun nothingLoadsWithoutAnAccount()=runTest {
        val remote=Remote();val vm=ScheduleViewModel(remote,Toaster())
        vm.open();advanceUntilIdle()
        assertTrue(remote.reads.isEmpty())
    }
}
