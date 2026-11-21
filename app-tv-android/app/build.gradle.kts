plugins {
    id("com.android.application")
}

val numeroVersao: Int = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()

android {
    namespace = "com.estimafood.tv"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.estimafood.tv"
        minSdk = 21
        targetSdk = 34
        versionCode = numeroVersao
        versionName = "1.0.$numeroVersao"
    }

    signingConfigs {
        create("estimafood") {
            // Mesma chave sempre: assim a TV aceita atualizar o app por cima
            storeFile = file("estimafood-tv.jks")
            storePassword = System.getenv("TV_KEY_PASS") ?: "estimafoodtv"
            keyAlias = "estimafoodtv"
            keyPassword = System.getenv("TV_KEY_PASS") ?: "estimafoodtv"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("estimafood")
        }
        debug {
            signingConfig = signingConfigs.getByName("estimafood")
        }
    }


    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }
}

// Sem bibliotecas de fora: o app usa só o que já vem no Android
dependencies { }
