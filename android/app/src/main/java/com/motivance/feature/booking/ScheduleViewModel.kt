package com.motivance.feature.booking

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.motivance.R
import com.motivance.designsystem.ToastTone
import com.motivance.designsystem.Toaster
import com.motivance.domain.*
import dagger.hilt.android.lifecycle.HiltViewModel
import java.time.YearMonth
import javax.inject.Inject
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

data class ScheduleState(
    val owner:String="",val therapist:Boolean=false,val month:YearMonth=YearMonth.from(centerToday()),val schedule:Schedule=Schedule(),val date:String?=null,
    val loading:Boolean=false,val failed:Boolean=false,val loaded:Boolean=false,val marking:String?=null,
)

/** What a Scheduler has confirmed for this person. Only whose sessions it reads differs between a patient and a therapist. */
@HiltViewModel class ScheduleViewModel @Inject constructor(private val repository:BookingRepository,private val toasts:Toaster=Toaster()):ViewModel() {
    private val mutable=MutableStateFlow(ScheduleState())
    val state=mutable.asStateFlow()
    private var job:Job?=null

    fun configure(owner:String?,therapist:Boolean) {
        val current=mutable.value
        if(current.owner==owner.orEmpty() && current.therapist==therapist) return
        job?.cancel()
        mutable.value=ScheduleState(owner=owner.orEmpty(),therapist=therapist)
    }

    /** Reads the month on screen again, keeping a date already chosen. */
    fun open()=load()

    fun showMonth(month:YearMonth) {
        mutable.value=mutable.value.copy(month=month,schedule=Schedule(),date=null,loaded=false)
        load()
    }

    fun selectDate(date:String) {mutable.value=mutable.value.copy(date=date)}

    /** Marking again corrects it. Either way the month is read again, so what is on screen is what the server holds. */
    fun mark(session:ScheduleSession,attendance:String) {
        val current=mutable.value
        if(current.owner.isBlank() || current.marking!=null) return
        mutable.value=current.copy(marking=session.id)
        viewModelScope.launch {
            try {
                repository.markAttendance(session.id,attendance)
                if(mutable.value.owner==current.owner) toasts.show(R.string.booking_attendance_saved)
            } catch(e:CancellationException) {throw e}
            catch(e:Exception) {if(mutable.value.owner==current.owner) toasts.show(bookingFailure(e),ToastTone.ERROR)}
            if(mutable.value.owner==current.owner) {
                mutable.value=mutable.value.copy(marking=null)
                load()
            }
        }
    }

    /** A newer read replaces an older one, and a result for another month or account is ignored, because a stale schedule shows the wrong day. */
    private fun load() {
        val current=mutable.value
        if(current.owner.isBlank()) return
        val month=current.month
        job?.cancel()
        mutable.value=current.copy(loading=true,failed=false)
        fun stillWanted()=mutable.value.owner==current.owner && mutable.value.therapist==current.therapist && mutable.value.month==month
        job=viewModelScope.launch {
            try {
                val schedule=repository.loadSchedule(month.atDay(1).toString(),month.atEndOfMonth().toString(),current.therapist)
                if(stillWanted()) mutable.value=mutable.value.let {it.copy(schedule=schedule,date=it.date ?: schedule.openingDate(centerToday()),loading=false,loaded=true)}
            } catch(e:CancellationException) {throw e}
            catch(_:Exception) {
                if(stillWanted()) {
                    mutable.value=mutable.value.copy(loading=false,failed=true)
                    toasts.show(R.string.booking_load_failed,ToastTone.ERROR)
                }
            }
        }
    }
}
