plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.matumbo.vivo"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.matumbo.vivo"
        minSdk = 28
        targetSdk = 35
        versionCode = 30
        versionName = "0.30.0-android-preview"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    sourceSets.getByName("main").assets.srcDir(layout.buildDirectory.dir("generated/vivo/assets"))
    testOptions { unitTests.isReturnDefaultValues = true }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.browser:browser:1.8.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:core-ktx:1.6.1")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}

val bundleVivoWeb by tasks.registering(Exec::class) {
    val repository = rootProject.projectDir.resolve("../../..").canonicalFile
    val output = layout.buildDirectory.dir("generated/vivo/assets")
    inputs.dir(repository.resolve("services/vivo/web"))
    inputs.file(repository.resolve("scripts/vivo/android_bundle.py"))
    outputs.dir(output)
    commandLine(System.getenv("VIVO_PYTHON") ?: "python3", repository.resolve("scripts/vivo/android_bundle.py"),
        "--repo", repository, "--destination", output.get().asFile)
}
tasks.named("preBuild").configure { dependsOn(bundleVivoWeb) }
