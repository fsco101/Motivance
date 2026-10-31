package com.motivance.data.local

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.inject.Inject
import javax.inject.Singleton

/** Android Keystore AES/GCM; backup is disabled for the application. No passwords. */
@Singleton class SessionVault @Inject constructor(@ApplicationContext context:Context) {
    private val file=AtomicFile(File(context.noBackupFilesDir,"auth-session.bin"))
    private val alias="motivance.session.v1"
    private fun key():SecretKey {
        val store=KeyStore.getInstance("AndroidKeyStore").apply {load(null)}
        (store.getKey(alias,null) as? SecretKey)?.let {return it}
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    @Synchronized fun read():String? {
        if(!file.baseFile.exists()) return null
        return try {
            val bytes=file.readFully(); val length=bytes[0].toInt()
            require(length==12 && bytes.size>length+1)
            val cipher=Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE,key(),GCMParameterSpec(128,bytes.copyOfRange(1,length+1)))
            String(cipher.doFinal(bytes.copyOfRange(length+1,bytes.size)),Charsets.UTF_8)
        } catch(_:Exception) {clear(); null}
    }
    @Synchronized fun write(value:String) {
        val cipher=Cipher.getInstance("AES/GCM/NoPadding").apply {init(Cipher.ENCRYPT_MODE,key())}
        val bytes=byteArrayOf(cipher.iv.size.toByte())+cipher.iv+cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val stream=file.startWrite()
        try {stream.write(bytes); file.finishWrite(stream)} catch(e:Exception) {file.failWrite(stream); throw e}
    }
    @Synchronized fun clear()=file.delete()
}
