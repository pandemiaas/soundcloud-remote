# R8: сериализация kotlinx работает через reflection-подобный доступ — оставляем метаданные
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class com.pandemias.scremote.** {
    *** Companion;
}
