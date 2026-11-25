package com.motivance.feature.exercise

import com.motivance.domain.Conversation
import org.junit.Assert.*
import org.junit.Test

/** #175: "Ask to record", the same cases as the web's sessionVideos.test.ts. */
class AskToRecordTest {
    private fun conversation(consented:Boolean,open:Boolean=true)=Conversation("c1",false,"p1","Ana",null,open,null,null,0,consented)

    @Test fun offeredToAPatientWhoAgreedToMessagesAndNeverSharedAVideo() {assertTrue(canAskToRecord(conversation(true),false))}

    @Test fun notOfferedWithoutTheMessagesAgreementOrAConversation() {
        assertFalse(canAskToRecord(conversation(false),false))
        assertFalse(canAskToRecord(conversation(true,open=false),false))
        assertFalse(canAskToRecord(null,false))
    }

    @Test fun notOfferedOnceAVideoWasSharedOrWhileThatIsUnknown() {
        assertFalse(canAskToRecord(conversation(true),true))
        assertFalse(canAskToRecord(conversation(true),null))
    }
}
