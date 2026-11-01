package com.motivance.domain

import java.time.LocalDate
import java.time.Period

data class PatientProfile(val username:String="",val name:String="",val gender:String="",val birthdate:String="",val address:String="",val contact:String="",val avatar:String="person",val consent:Boolean=false,val email:String="") {
    val age:Int? get()=runCatching {Period.between(LocalDate.parse(birthdate),LocalDate.now()).years}.getOrNull()
    fun valid():Boolean = username.matches(Regex("[A-Za-z0-9_]{3,30}")) && name.trim().length in 2..120 &&
        gender in setOf("female","male","nonbinary","prefer_not_to_say") &&
        runCatching {val date=LocalDate.parse(birthdate);date<=LocalDate.now() && date>=LocalDate.now().minusYears(120)}.getOrDefault(false) &&
        address.trim().length in 5..500 && contact.matches(Regex("[+0-9 ()-]{7,25}")) && contact.count {it.isDigit()}>=7 &&
        avatar in setOf("person","star","heart") && consent
}
