package com.pandemias.scremote.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

// Палитра: глубокий тёмный фон, оранжевый акцент SoundCloud
private val Orange = Color(0xFFFF5500)
private val OrangeDim = Color(0xFFCC4400)
private val Bg = Color(0xFF0F0D18)
private val Surface = Color(0xFF191627)
private val SurfaceVar = Color(0xFF262238)
private val Outline = Color(0xFF3A3554)
private val TextMain = Color(0xFFEAE8F2)
private val TextMuted = Color(0xFFA29EB5)
private val Ok = Color(0xFF35D07F)
private val Bad = Color(0xFFE5484D)

private val SCColors = darkColorScheme(
    primary = Orange,
    onPrimary = Color.White,
    primaryContainer = OrangeDim,
    onPrimaryContainer = Color.White,
    background = Bg,
    onBackground = TextMain,
    surface = Surface,
    onSurface = TextMain,
    surfaceVariant = SurfaceVar,
    onSurfaceVariant = TextMuted,
    secondary = TextMuted,
    onSecondary = TextMain,
    secondaryContainer = SurfaceVar,
    onSecondaryContainer = TextMain,
    outline = Outline,
    error = Bad,
    tertiary = Ok,
)

/** Типографика: системный санс, плотные заголовки, «дышащий» текст. */
private val SCTypography = Typography(
    headlineMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Bold,
        fontSize = 26.sp,
        letterSpacing = 0.2.sp,
    ),
    titleLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 20.sp,
        letterSpacing = 0.1.sp,
    ),
    titleMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 16.sp,
        letterSpacing = 0.1.sp,
    ),
    bodyLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 15.sp,
        letterSpacing = 0.15.sp,
    ),
    bodyMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 14.sp,
        letterSpacing = 0.15.sp,
    ),
    bodySmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 12.sp,
        letterSpacing = 0.2.sp,
    ),
)

@Composable
fun SCRemoteTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = SCColors, typography = SCTypography, content = content)
}
