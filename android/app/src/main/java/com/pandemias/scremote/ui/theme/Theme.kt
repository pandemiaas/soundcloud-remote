package com.pandemias.scremote.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Orange = Color(0xFFFF5500)
private val Bg = Color(0xFF14121F)
private val Surface = Color(0xFF1E1B2E)
private val SurfaceVar = Color(0xFF2A2740)
private val TextMain = Color(0xFFE8E6F0)
private val TextMuted = Color(0xFF9A96AD)
private val Ok = Color(0xFF35D07F)
private val Bad = Color(0xFFE5484D)

private val SCColors = darkColorScheme(
    primary = Orange,
    onPrimary = Color.White,
    background = Bg,
    onBackground = TextMain,
    surface = Surface,
    onSurface = TextMain,
    surfaceVariant = SurfaceVar,
    onSurfaceVariant = TextMuted,
    secondary = TextMuted,
    onSecondary = TextMain,
    error = Bad,
    tertiary = Ok,
)

@Composable
fun SCRemoteTheme(content: @Composable () -> Unit) {
    // дизайн фиксированно тёмный — фон приложения тёмный и в темах
    isSystemInDarkTheme()
    MaterialTheme(colorScheme = SCColors, content = content)
}
