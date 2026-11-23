package com.motivance.feature.auth

import android.content.Context
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.ClearCredentialException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.GetCredentialInterruptedException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import com.motivance.BuildConfig
import com.motivance.domain.GoogleAccounts
import com.motivance.domain.GoogleFailure
import com.motivance.domain.GoogleSignInFailure
import com.motivance.domain.GoogleToken
import dagger.hilt.android.qualifiers.ApplicationContext
import java.security.MessageDigest
import java.security.SecureRandom
import javax.inject.Inject
import javax.inject.Singleton

/** A fresh random nonce for each attempt. Google signs its SHA-256 into the token; Auth hashes the raw one and compares. */
internal fun newNonce(random:SecureRandom=SecureRandom()):String {
    val bytes=ByteArray(32).also {random.nextBytes(it)}
    return bytes.joinToString("") {"%02x".format(it)}
}
internal fun sha256Hex(value:String)=MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") {"%02x".format(it)}

/**
 * Sign in with Google through Credential Manager (#168). Google's picker needs the activity on screen, so the screen calls this and
 * hands the token to [AuthViewModel.continueWithGoogle]. The token is issued for the Web client ID, which Supabase Auth accepts.
 */
class GoogleSignIn(private val serverClientId:String=BuildConfig.GOOGLE_WEB_CLIENT_ID) {
    suspend fun token(activity:Context):GoogleToken {
        if(serverClientId.isBlank()) throw GoogleSignInFailure(GoogleFailure.NOT_CONFIGURED)
        val nonce=newNonce()
        val option=GetSignInWithGoogleOption.Builder(serverClientId).setNonce(sha256Hex(nonce)).build()
        val result=try {CredentialManager.create(activity).getCredential(activity,GetCredentialRequest.Builder().addCredentialOption(option).build())}
            catch(e:GetCredentialCancellationException) {throw GoogleSignInFailure(GoogleFailure.CANCELLED)}
            catch(e:GetCredentialInterruptedException) {throw GoogleSignInFailure(GoogleFailure.CANCELLED)}
            catch(e:NoCredentialException) {throw GoogleSignInFailure(GoogleFailure.NO_ACCOUNT)}
            // Google Play services missing, out of date or unreachable: the picker could not open.
            catch(e:GetCredentialException) {throw GoogleSignInFailure(GoogleFailure.UNAVAILABLE)}
        val credential=result.credential
        if(credential !is CustomCredential || credential.type!=GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) throw GoogleSignInFailure(GoogleFailure.UNAVAILABLE)
        val idToken=try {GoogleIdTokenCredential.createFrom(credential.data).idToken} catch(e:GoogleIdTokenParsingException) {throw GoogleSignInFailure(GoogleFailure.UNAVAILABLE)}
        return GoogleToken(idToken,nonce)
    }
}

/** Clears Credential Manager's remembered choice at sign-out, so on a shared phone the next person picks their own Google account. */
@Singleton class CredentialManagerAccounts @Inject constructor(@ApplicationContext private val context:Context):GoogleAccounts {
    override suspend fun forget() {
        // Signing out never fails because of this: at worst Google suggests the last account, and the picker still lets anyone choose.
        try {CredentialManager.create(context).clearCredentialState(ClearCredentialStateRequest())} catch(_:ClearCredentialException) {} catch(_:IllegalStateException) {}
    }
}
