package com.motivance.navigation

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import com.motivance.MainActivity
import com.motivance.R
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test

/**
 * The real app, one sign-in page, real accounts on the local backend. Needs a signed-out app, and is skipped unless
 * scripts/test_role_routing.py passes disposable accounts.
 */
class LiveRoleRoutingTest {
    @get:Rule val compose=createAndroidComposeRule<MainActivity>()
    private val args=InstrumentationRegistry.getArguments()
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private fun text(id:Int)=context.getString(id)
    private fun present(id:Int)=compose.onAllNodesWithText(text(id)).fetchSemanticsNodes().isNotEmpty()
    private fun waitFor(timeout:Long=20_000,condition:()->Boolean)=compose.waitUntil(timeout,condition)
    // A semantic click cannot land on a toast or on a stale position after the keyboard moves the layout.
    private fun SemanticsNodeInteraction.tap()=performScrollTo().performSemanticsAction(SemanticsActions.OnClick)

    @Before fun accounts() {assumeTrue(args.getString("patientEmail")!=null)}

    private fun signIn(email:String) {
        if(!present(R.string.email)) compose.onNode(hasText(text(R.string.sign_in)) and hasClickAction()).tap()
        // The form stays disabled while a sign-out finishes, so being on screen is not enough.
        waitFor {compose.onAllNodes(hasText(text(R.string.email)) and isEnabled()).fetchSemanticsNodes().isNotEmpty()}
        compose.onNodeWithText(text(R.string.email)).performTextInput(email)
        compose.onNodeWithText(text(R.string.auth_password)).performTextInput(args.getString("password")!!)
        compose.onNode(hasText(text(R.string.sign_in)) and hasClickAction()).tap()
        waitFor {present(R.string.nav_profile)}
    }
    private fun signOut() {
        compose.onAllNodesWithText(text(R.string.nav_profile)).onFirst().performSemanticsAction(SemanticsActions.OnClick)
        waitFor {present(R.string.sign_out)}
        compose.onNodeWithText(text(R.string.sign_out)).tap()
        waitFor {present(R.string.email)}
    }
    /** The bottom bar is the plainest sign of whose workspace this is. */
    private fun assertWorkspace(expected:Int) {
        val tabs=listOf(R.string.nav_exercises,R.string.nav_patients,R.string.role_admin)
        waitFor {present(expected)}
        (tabs-expected).forEach {check(!present(it)) {"Found ${text(it)} in the ${text(expected)} workspace"}}
    }

    @Test fun oneSignInPageTakesEachAccountToItsOwnWorkspace() {
        signIn(args.getString("patientEmail")!!)
        assertWorkspace(R.string.nav_exercises)
        signOut()

        signIn(args.getString("therapistEmail")!!)
        assertWorkspace(R.string.nav_patients)
        signOut()

        // Holds both roles, as every promoted account does: lands as staff, and can still open the patient workspace.
        val both=args.getString("therapistPatientEmail")!!
        signIn(both)
        assertWorkspace(R.string.nav_patients)
        compose.onAllNodesWithText(text(R.string.nav_profile)).onFirst().performSemanticsAction(SemanticsActions.OnClick)
        waitFor {present(R.string.patient_title)}
        compose.onNodeWithText(text(R.string.patient_title)).tap()
        assertWorkspace(R.string.nav_exercises)
        signOut()

        // That choice ended with the sign-in, for this account and for whoever signs in next.
        signIn(both)
        assertWorkspace(R.string.nav_patients)
        signOut()

        signIn(args.getString("adminEmail")!!)
        assertWorkspace(R.string.role_admin)
        signOut()

        // Scheduling lives on the web, so a Scheduler sees that note and no clinical tabs.
        signIn(args.getString("schedulerEmail")!!)
        waitFor {present(R.string.scheduler_use_web)}
        listOf(R.string.nav_exercises,R.string.nav_patients,R.string.role_admin).forEach {check(!present(it)) {"Found ${text(it)} in the Scheduler workspace"}}
        signOut()
    }
}
