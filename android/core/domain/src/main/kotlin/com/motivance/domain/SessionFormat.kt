package com.motivance.domain

import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** Writes session times in the center's zone, whatever zone the phone is set to. */
class SessionFormat(locale:Locale) {
    private val zone=ZoneId.of(CENTER_ZONE)
    private val day=DateTimeFormatter.ofPattern("EEE, MMM d, yyyy",locale).withZone(zone)
    private val time=DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale).withZone(zone)
    private val calendarDay=DateTimeFormatter.ofPattern("EEEE, MMMM d",locale)
    private val month=DateTimeFormatter.ofPattern("MMMM yyyy",locale)
    private val weekday=DateTimeFormatter.ofPattern("EEE",locale)

    fun day(iso:String):String=day.format(bookingInstant(iso))
    fun time(iso:String):String=time.format(bookingInstant(iso))
    fun range(start:String,end:String)="${time(start)} – ${time(end)}"
    fun whenAt(start:String,end:String)="${day(start)}, ${range(start,end)}"
    fun calendarDay(date:LocalDate):String=calendarDay.format(date)
    fun month(value:YearMonth):String=month.format(value)
    /** Monday to Sunday: 5 January 2026 was a Monday. */
    val weekdays:List<String> get()=(0L..6L).map {weekday.format(LocalDate.of(2026,1,5).plusDays(it))}
}
