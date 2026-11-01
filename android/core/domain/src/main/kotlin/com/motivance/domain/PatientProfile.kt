package com.motivance.domain

import java.time.LocalDate
import java.time.Period

data class PatientProfile(val username:String="",val name:String="",val gender:String="",val birthdate:String="",val address:String="",val contact:String="",val avatar:String="person",val consent:Boolean=false,val email:String="",val firstName:String=name.substringBefore(" "),val lastName:String=name.substringAfter(" ","")) {
    val age:Int? get()=runCatching {Period.between(LocalDate.parse(birthdate),LocalDate.now()).years}.getOrNull()
    val displayName:String get()=listOf(firstName.trim(),lastName.trim()).filter {it.isNotEmpty()}.joinToString(" ")
    fun valid():Boolean = UsernamePolicy.allowed(username) && validName(firstName) && validName(lastName) &&
        gender in setOf("female","male","nonbinary","prefer_not_to_say") &&
        runCatching {val date=LocalDate.parse(birthdate);date<=LocalDate.now() && date>=LocalDate.now().minusYears(120)}.getOrDefault(false) &&
        address.trim().length in 5..500 && validContact(contact) &&
        avatar in setOf("person","star","heart") && consent
}

fun validName(value:String)=value.trim().length in 1..60 && value.trim().matches(Regex("[\\p{L}\\p{M}]+(?:[ .\u2019'-][\\p{L}\\p{M}]+)*\\.?"))
fun validContact(value:String)=value.matches(Regex("\\+?[0-9 ()-]{7,25}")) && value.count {it.isDigit()} in 7..15

/** Curated multilingual Latin/transliterated terms, not exhaustive language moderation. */
object UsernamePolicy {
    const val blockedPattern="fuck|shit|bitch|(^cunt|cunt$)|motherfucker|putangina|tangina|gago|tanga|ulol|putang|pakyu|(^puta|puta$)|puto|mierda|pendejo|cabron|cojones|joder|merde|putain|salope|connard|scheisse|arschloch|ficken|fotze|caralho|porra|buceta|cazzo|vaffanculo|stronzo|anjing|bangsat|kontol|memek|goblok|bhenchod|madarchod|chutiya|harami|orospu|siktir"
    fun normalized(value:String)=value.lowercase(java.util.Locale.ROOT).map {when(it) {'0'->'o';'1'->'i';'3'->'e';'4'->'a';'5'->'s';'7'->'t';'8'->'b';'9'->'g';else->it}}.joinToString("").replace("_","")
    fun blocked(value:String)=Regex(blockedPattern).containsMatchIn(normalized(value))
    fun allowed(value:String)=value.matches(Regex("[A-Za-z0-9_]{3,30}")) && !blocked(value)
}
