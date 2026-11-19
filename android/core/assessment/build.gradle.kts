plugins { alias(libs.plugins.kotlin.jvm) }
kotlin { jvmToolchain(17) }
dependencies { implementation(project(":core:domain")); testImplementation(libs.junit) }
// SharedCasesTest reads the cases both engines replay, and writes the answers when UPDATE_SHARED_CASES=1.
tasks.test {
    inputs.dir(rootProject.file("../shared/assessment")).withPropertyName("sharedAssessmentCases")
    inputs.property("updateSharedCases", providers.environmentVariable("UPDATE_SHARED_CASES").orElse("0"))
}
