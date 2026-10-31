package com.motivance.di
import com.motivance.domain.AuthRepository
import com.motivance.domain.RehabilitationRepository
import com.motivance.data.remote.SupabaseAuthRepository
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton
@Module @InstallIn(SingletonComponent::class)
abstract class AppModule {
    @Binds @Singleton abstract fun auth(impl: SupabaseAuthRepository): AuthRepository
    @Binds @Singleton abstract fun rehabilitation(impl: SupabaseAuthRepository): RehabilitationRepository
}
