package com.motivance.domain

import java.time.LocalDate
import org.junit.Assert.*
import org.junit.Test

class PatientProfileTest {
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
