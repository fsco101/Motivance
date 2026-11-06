package com.motivance.feature.booking

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.motivance.R
import com.motivance.designsystem.ToastTone
import com.motivance.designsystem.Toaster
import com.motivance.domain.*
import dagger.hilt.android.lifecycle.HiltViewModel
import java.time.YearMonth
import java.util.UUID
import javax.inject.Inject
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class BookingAction { LOAD, MONTH, REQUEST, CANCEL, WAITLIST }

data class BookingState(
    val owner:String="",val month:YearMonth=YearMonth.from(centerToday()),val availability:BookingAvailability=BookingAvailability(),val bookings:List<Booking> = emptyList(),val waitlist:List<WaitlistEntry> = emptyList(),
    val date:String?=null,val slot:BookingSlot?=null,val busy:Boolean=false,val activeAction:BookingAction?=null,val loading:Set<BookingAction> = emptySet(),
    val failed:Boolean=false,val loaded:Boolean=false,
)

/** The wording for a refusal. The server sends a stable booking_* code, so nothing it says reaches the screen unchecked. */
internal fun bookingFailure(error:Exception)=when((error as? RemoteFailure)?.code) {
    "booking_past" -> R.string.booking_error_past
    "booking_too_soon" -> R.string.booking_error_too_soon
    "booking_too_far" -> R.string.booking_error_too_far
    "booking_off_grid" -> R.string.booking_error_off_grid
    "booking_closed_day" -> R.string.booking_error_closed_day
    "booking_outside_hours" -> R.string.booking_error_outside_hours
    "booking_holiday" -> R.string.booking_error_holiday
    "booking_closure" -> R.string.booking_error_closure
    "booking_full" -> R.string.booking_error_full
    "booking_limit" -> R.string.booking_error_limit
    "booking_overlap" -> R.string.booking_error_overlap
    "booking_state" -> R.string.booking_error_state
    "booking_unavailable" -> R.string.booking_error_unavailable
    "booking_too_late" -> R.string.booking_error_too_late
    "booking_not_full" -> R.string.booking_error_not_full
    else -> R.string.booking_error_request
}

@HiltViewModel class BookingViewModel @Inject constructor(private val repository:BookingRepository,private val toasts:Toaster=Toaster()):ViewModel() {
    private val mutable=MutableStateFlow(BookingState())
    val state=mutable.asStateFlow()
    private var job:Job?=null
    private val reads=mutableMapOf<BookingAction,Job>()
    // One ID per chosen time, so trying again after a lost response returns the same booking instead of a second one.
    private var attempt:Pair<String,String>?=null

    fun configure(owner:String?) {
        if(mutable.value.owner==owner.orEmpty()) return
        job?.cancel();reads.values.forEach {it.cancel()};reads.clear();attempt=null
        mutable.value=BookingState(owner=owner.orEmpty())
    }

    /**
     * Reads run alongside each other, so opening the calendar is never dropped because the list is still loading. A newer
     * read of the same kind replaces an older one, and a result that arrives after the account has changed is ignored.
     */
    private fun read(kind:BookingAction,work:suspend ()->(BookingState)->BookingState) {
        val owner=mutable.value.owner
        if(owner.isBlank()) return
        reads.remove(kind)?.cancel()
        mutable.value=mutable.value.copy(loading=mutable.value.loading+kind,failed=false)
        reads[kind]=viewModelScope.launch {
            try {
                val apply=work()
                if(mutable.value.owner==owner) mutable.value=apply(mutable.value).let {it.copy(loading=it.loading-kind,loaded=true)}
            } catch(e:CancellationException) {throw e}
            catch(_:Exception) {
                if(mutable.value.owner==owner) {
                    mutable.value=mutable.value.copy(loading=mutable.value.loading-kind,failed=true)
                    toasts.show(R.string.booking_load_failed,ToastTone.ERROR)
                }
            }
        }
    }

    /** Changes run one at a time, and ignore a result that arrives after the account has changed. */
    private fun perform(kind:BookingAction,failure:(Exception)->Int,work:suspend (BookingState)->BookingState) {
        val current=mutable.value
        if(current.owner.isBlank() || current.busy) return
        mutable.value=current.copy(busy=true,activeAction=kind,failed=false)
        job=viewModelScope.launch {
            try {
                val next=work(current)
                if(mutable.value.owner==current.owner) mutable.value=mutable.value.copy(availability=next.availability,bookings=next.bookings,waitlist=next.waitlist,date=next.date,slot=next.slot,busy=false,activeAction=null,failed=false,loaded=true)
            } catch(e:CancellationException) {throw e}
            catch(e:Exception) {
                if(mutable.value.owner==current.owner) {
                    mutable.value=mutable.value.copy(busy=false,activeAction=null)
                    toasts.show(failure(e),ToastTone.ERROR)
                }
            }
        }
    }

    private suspend fun availabilityOf(month:YearMonth)=repository.loadAvailability(month.atDay(1).toString(),month.atEndOfMonth().toString())

    fun refresh()=read(BookingAction.LOAD) {
        val bookings=repository.loadMyBookings()
        val waitlist=repository.loadWaitlist()
        ;{it.copy(bookings=bookings,waitlist=waitlist)}
    }
    fun openBooking()=showMonth(mutable.value.month)
    fun showMonth(month:YearMonth) {
        mutable.value=mutable.value.copy(month=month,date=null,slot=null)
        read(BookingAction.MONTH) {
            val availability=availabilityOf(month)
            ;{it.copy(availability=availability)}
        }
    }
    fun selectDate(date:String) {mutable.value=mutable.value.copy(date=date,slot=null)}
    fun selectSlot(slot:BookingSlot) {if(slot.bookable || slot.joinable) mutable.value=mutable.value.copy(slot=slot)}

    /** The time may be gone, so what is on screen must not stand. */
    private fun refused(error:Exception):Int {
        val owner=mutable.value.owner
        mutable.value=mutable.value.copy(slot=null)
        viewModelScope.launch {runCatching {availabilityOf(mutable.value.month)}.onSuccess {if(mutable.value.owner==owner) mutable.value=mutable.value.copy(availability=it)}}
        viewModelScope.launch {runCatching {repository.loadWaitlist()}.onSuccess {if(mutable.value.owner==owner) mutable.value=mutable.value.copy(waitlist=it)}}
        return bookingFailure(error)
    }

    fun request(done:()->Unit) {
        val slot=mutable.value.slot ?: return
        if(attempt?.first!=slot.startsAt) attempt=slot.startsAt to UUID.randomUUID().toString()
        val id=attempt!!.second
        perform(BookingAction.REQUEST,failure={refused(it)}) {
            repository.requestBooking(id,slot.startsAt)
            val bookings=repository.loadMyBookings()
            attempt=null
            toasts.show(R.string.booking_requested)
            done()
            it.copy(bookings=bookings,slot=null,date=null)
        }
    }

    /** Joining or leaving changes what the calendar shows, so it is read again along with the list. */
    private fun changeWaitlist(done:Int,work:suspend ()->Unit)=perform(BookingAction.WAITLIST,failure={refused(it)}) {
        work()
        val availability=availabilityOf(it.month)
        val waitlist=repository.loadWaitlist()
        toasts.show(done)
        it.copy(availability=availability,waitlist=waitlist,slot=null)
    }
    fun joinWaitlist() {
        val slot=mutable.value.slot ?: return
        changeWaitlist(R.string.booking_joined_waitlist) {repository.joinWaitlist(slot.startsAt)}
    }
    fun leaveWaitlist(startsAt:String)=changeWaitlist(R.string.booking_left_waitlist) {repository.leaveWaitlist(startsAt)}

    /** The first to book gets a place, so it is booked from the list in one step. */
    fun book(entry:WaitlistEntry)=perform(BookingAction.REQUEST,failure={refused(it)}) {
        repository.requestBooking(UUID.randomUUID().toString(),entry.startsAt)
        val bookings=repository.loadMyBookings()
        val waitlist=repository.loadWaitlist()
        toasts.show(R.string.booking_requested)
        it.copy(bookings=bookings,waitlist=waitlist)
    }

    fun cancel(booking:Booking)=perform(BookingAction.CANCEL,failure={bookingFailure(it)}) {
        repository.cancelBooking(booking.id)
        val bookings=repository.loadMyBookings()
        toasts.show(R.string.booking_cancelled)
        it.copy(bookings=bookings)
    }
}
