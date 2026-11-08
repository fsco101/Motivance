package com.motivance.domain

import java.math.BigDecimal

/** Exercise timing is stored in milliseconds; people read and type it in seconds (issue #97). */
object Seconds {
    private val plainNumber=Regex("""\d*\.?\d*""")

    /** 600 → "0.6", 1000 → "1", 1250 → "1.25". Always a dot, the decimal mark on a phone's number keyboard. */
    fun text(ms:Long):String=BigDecimal.valueOf(ms,3).stripTrailingZeros().toPlainString()

    /** "0.6" → 600, also accepting a comma as the decimal mark. Null unless it is a plain, non-negative number of whole milliseconds. */
    fun parseMs(text:String):Long? {
        val plain=text.trim().replace(',','.')
        if(!plainNumber.matches(plain) || plain.none(Char::isDigit)) return null
        return runCatching {BigDecimal(plain).movePointRight(3).longValueExact()}.getOrNull()
    }
}
