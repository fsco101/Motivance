package com.motivance.domain

import java.time.LocalDate
import org.junit.Assert.*
import org.junit.Test

class PatientProfileTest {
    @Test fun usernamesRejectMultilingualTermsAndObfuscation() {
        listOf("f_u_c_k", "SH1Thead", "putangina", "pendejo", "merde", "scheisse", "caralho", "cazzo", "kontol", "madarchod", "siktir").forEach {
            assertFalse(it,UsernamePolicy.allowed(it))
        }
        listOf("patient_2026","classical_music","scunthorpe","grace_lee").forEach {assertTrue(it,UsernamePolicy.allowed(it))}
        assertFalse(UsernamePolicy.allowed("name space"))
        assertFalse(UsernamePolicy.allowed("a"))
    }
    @Test fun splitNamesAndInternationalPhoneValidation() {
        assertTrue(validName("Jos\u00e9"));assertTrue(validName("O\u2019Connor"));assertTrue(validName("Dela Cruz"))
        assertFalse(validName("Name123"));assertFalse(validName(""))
        assertTrue(validContact("+63 912 345 6789"));assertFalse(validContact("++639123456789"))
        assertFalse(validContact("1234567890123456"))
        assertFalse(valid.copy(lastName="").valid())
        assertEquals("Ana Dela Cruz",valid.copy(firstName="Ana",lastName="Dela Cruz").displayName)
    }
    private val valid=PatientProfile("patient_one","Test Patient","female","2000-02-29","Test address","+639001234567","star",true)
    @Test fun consentAndValidDemographicsRequired() {
        assertTrue(valid.valid())
        assertFalse(valid.copy(consent=false).valid())
        assertFalse(valid.copy(username="x!").valid())
        assertFalse(valid.copy(contact="-------").valid())
        assertFalse(valid.copy(gender="unknown").valid())
        assertFalse(valid.copy(address="").valid())
    }
    @Test fun impossibleFutureAndOutOfRangeDatesRejected() {
        assertFalse(valid.copy(birthdate="2001-02-29").valid())
        assertFalse(valid.copy(birthdate=LocalDate.now().plusDays(1).toString()).valid())
        assertFalse(valid.copy(birthdate=LocalDate.now().minusYears(121).toString()).valid())
    }
    @Test fun ageIsDerivedFromBirthday() {
        assertEquals(25,valid.copy(birthdate=LocalDate.now().minusYears(25).toString()).age)
        assertEquals(24,valid.copy(birthdate=LocalDate.now().minusYears(25).plusDays(1).toString()).age)
    }
}
