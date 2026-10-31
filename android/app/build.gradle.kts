import java.util.Properties
plugins { alias(libs.plugins.android.application); alias(libs.plugins.kotlin.android); alias(libs.plugins.compose); alias(libs.plugins.hilt); alias(libs.plugins.ksp) }
val local = Properties().apply { rootProject.file("local.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) } }
val dotenv = Properties().apply { rootProject.file(".env").takeIf { it.exists() }?.inputStream()?.use { load(it) } }
fun config(name: String): String {
    val envName = if (name == "SUPABASE_URL") "ANDROID_SUPABASE_URL" else name
    val value = System.getenv(envName) ?: System.getenv(name) ?: local.getProperty(name)
        ?: dotenv.getProperty(envName) ?: dotenv.getProperty(name, "")
    return "\"" + value.trim().removeSurrounding("\"").replace("\\", "\\\\").replace("\"", "\\\"") + "\""
}
android {
    namespace = "com.motivance"; compileSdk = 35
    defaultConfig { applicationId = "com.motivance"; minSdk = 26; targetSdk = 35; versionCode = 1; versionName = "0.1.0"; buildConfigField("String", "SUPABASE_URL", config("SUPABASE_URL")); buildConfigField("String", "SUPABASE_PUBLISHABLE_KEY", config("SUPABASE_PUBLISHABLE_KEY")) }
    defaultConfig.testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    // MediaPipe 0.10.21 has ARM32/ARM64 JNI, but no x86_64 JNI. Avoid a
    // mixed APK selecting x86_64 because a different dependency provides it.
    defaultConfig.ndk { abiFilters += setOf("arm64-v8a", "armeabi-v7a") }
    buildTypes { debug { applicationIdSuffix = ".debug" }; release { isMinifyEnabled = false } }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}
dependencies {
    implementation(project(":core:domain")); implementation(project(":core:assessment"))
    implementation(platform(libs.compose.bom)); implementation(libs.compose.ui); implementation(libs.compose.foundation); implementation(libs.compose.material3)
    implementation("androidx.compose.material:material-icons-core")
    implementation(libs.activity.compose); implementation(libs.lifecycle.compose); implementation(libs.lifecycle.viewmodel); implementation(libs.coroutines)
    implementation(libs.camera.core); implementation(libs.camera.camera2); implementation(libs.camera.lifecycle); implementation(libs.mediapipe)
    implementation(libs.hilt.android); ksp(libs.hilt.compiler); implementation(libs.okhttp)
    testImplementation(libs.junit)
    testImplementation("org.json:json:20240303")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
    implementation(libs.room.runtime); implementation(libs.room.ktx); ksp(libs.room.compiler)
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:core:1.6.1")
}
ksp { arg("room.schemaLocation", "$projectDir/schemas") }
