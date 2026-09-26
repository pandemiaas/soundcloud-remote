package com.pandemias.scremote.ui

import android.content.res.Configuration
import android.os.SystemClock
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.LinkOff
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.RepeatOn
import androidx.compose.material.icons.filled.RepeatOne
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.pandemias.scremote.net.BridgeRepo
import com.pandemias.scremote.net.UiState
import kotlinx.coroutines.delay

private fun fmt(ms: Long): String {
    val total = ms.coerceAtLeast(0) / 1000
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) "$h:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}"
    else "$m:${s.toString().padStart(2, '0')}"
}

@Composable
private fun accentSliderColors() = SliderDefaults.colors(
    thumbColor = MaterialTheme.colorScheme.primary,
    activeTrackColor = MaterialTheme.colorScheme.primary,
    inactiveTrackColor = MaterialTheme.colorScheme.surfaceVariant,
)

@Composable
fun PlayerScreen() {
    val state by BridgeRepo.state.collectAsState()

    val landscape =
        LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE

    // локальный тикер: плавная позиция между tick-сообщениями моста
    var nowTick by remember { mutableLongStateOf(0L) }
    LaunchedEffect(Unit) {
        while (true) {
            nowTick = SystemClock.elapsedRealtime()
            delay(200)
        }
    }
    val duration = state.durationMs.coerceAtLeast(0L)
    val shownPos: Long = run {
        val raw = if (state.playing) {
            state.positionMs + (nowTick - state.positionAt).coerceAtLeast(0L)
        } else state.positionMs
        if (duration > 0) raw.coerceIn(0L, duration) else raw.coerceAtLeast(0L)
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .safeDrawingPadding()
            .padding(top = 10.dp, start = 18.dp, end = 18.dp, bottom = 8.dp),
    ) {
        if (landscape) {
            Row(
                modifier = Modifier.fillMaxSize(),
                horizontalArrangement = Arrangement.spacedBy(24.dp),
            ) {
                ArtworkView(state.track?.artwork, Modifier.weight(0.42f).fillMaxHeight())
                Column(
                    modifier = Modifier
                        .weight(0.58f)
                        .fillMaxHeight(),
                    verticalArrangement = Arrangement.Center,
                ) {
                    Controls(state, shownPos, duration, compact = true)
                }
            }
        } else {
            Column(
                modifier = Modifier.fillMaxSize(),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                ArtworkView(
                    state.track?.artwork,
                    Modifier
                        .fillMaxWidth()
                        .weight(1f, fill = false)
                        .aspectRatio(1f),
                )
                Spacer(Modifier.height(16.dp))
                Controls(state, shownPos, duration, compact = false)
            }
        }
    }
}

@Composable
private fun ArtworkView(artwork: String?, modifier: Modifier) {
    Box(
        modifier = modifier
            .aspectRatio(1f)
            .clip(RoundedCornerShape(22.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant),
        contentAlignment = Alignment.Center,
    ) {
        if (artwork != null) {
            AsyncImage(
                model = artwork,
                contentDescription = "Обложка",
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Icon(
                Icons.Filled.MusicNote,
                contentDescription = null,
                modifier = Modifier.size(72.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun Controls(state: UiState, shownPos: Long, duration: Long, compact: Boolean) {
    val track = state.track
    val caps = state.caps
    // пока расширение не прислало caps — считаем всё доступным
    val has: (String) -> Boolean = { c -> caps.isEmpty() || caps.contains(c) }

    // --- заголовок ---
    Text(
        track?.title ?: "Нет трека",
        style = MaterialTheme.typography.titleLarge,
        color = MaterialTheme.colorScheme.onBackground,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.fillMaxWidth(),
    )
    Text(
        track?.artist?.ifBlank { "—" } ?: "—",
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.fillMaxWidth(),
    )

    if (!state.extConnected) {
        Spacer(Modifier.height(6.dp))
        Text(
            "Откройте SoundCloud в браузере на ПК",
            color = MaterialTheme.colorScheme.tertiary,
            style = MaterialTheme.typography.bodySmall,
        )
    }

    Spacer(Modifier.height(if (compact) 6.dp else 10.dp))

    // --- прогресс / seek ---
    var dragging by remember { mutableStateOf(false) }
    var dragPos by remember { mutableLongStateOf(0L) }
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            fmt(shownPos),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            fmt(duration),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
    Slider(
        value = (if (dragging) dragPos else shownPos).toFloat(),
        onValueChange = {
            dragging = true
            dragPos = it.toLong()
        },
        onValueChangeFinished = {
            dragging = false
            BridgeRepo.seek(dragPos)
        },
        valueRange = 0f..(if (duration > 0) duration.toFloat() else 1f),
        enabled = has("seek") && duration > 0,
        colors = accentSliderColors(),
    )

    // --- транспорт ---
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(22.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FilledIconButton(
            onClick = { BridgeRepo.prev() },
            enabled = has("next"),
            modifier = Modifier.size(56.dp),
            shape = CircleShape,
            colors = IconButtonDefaults.filledTonalIconButtonColors(
                containerColor = MaterialTheme.colorScheme.surfaceVariant,
                contentColor = MaterialTheme.colorScheme.onBackground,
            ),
        ) {
            Icon(Icons.Filled.SkipPrevious, "Предыдущий", modifier = Modifier.size(30.dp))
        }
        FilledIconButton(
            onClick = { if (state.playing) BridgeRepo.pause() else BridgeRepo.play() },
            enabled = has("play"),
            modifier = Modifier.size(80.dp),
            shape = CircleShape,
            colors = IconButtonDefaults.filledIconButtonColors(
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            ),
        ) {
            Icon(
                if (state.playing) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                "Играть/Пауза",
                modifier = Modifier.size(46.dp),
            )
        }
        FilledIconButton(
            onClick = { BridgeRepo.next() },
            enabled = has("next"),
            modifier = Modifier.size(56.dp),
            shape = CircleShape,
            colors = IconButtonDefaults.filledTonalIconButtonColors(
                containerColor = MaterialTheme.colorScheme.surfaceVariant,
                contentColor = MaterialTheme.colorScheme.onBackground,
            ),
        ) {
            Icon(Icons.Filled.SkipNext, "Следующий", modifier = Modifier.size(30.dp))
        }
    }

    Spacer(Modifier.height(if (compact) 6.dp else 10.dp))

    // --- like / repeat / shuffle: круглые кнопки с подсветкой активного ---
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(18.dp, Alignment.CenterHorizontally),
    ) {
        val liked = track?.liked == true
        FilledIconButton(
            onClick = { BridgeRepo.like(null) },
            enabled = has("like"),
            modifier = Modifier.size(48.dp),
            shape = CircleShape,
            colors = IconButtonDefaults.filledIconButtonColors(
                containerColor = if (liked) MaterialTheme.colorScheme.primary
                else MaterialTheme.colorScheme.surfaceVariant,
                contentColor = if (liked) MaterialTheme.colorScheme.onPrimary
                else MaterialTheme.colorScheme.onBackground,
            ),
        ) {
            Icon(
                if (liked) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
                "Лайк",
                modifier = Modifier.size(22.dp),
            )
        }

        val mode = state.repeat ?: "off"
        FilledIconButton(
            onClick = {
                val nextMode = when (mode) {
                    "off" -> "all"
                    "all" -> "one"
                    else -> "off"
                }
                BridgeRepo.setRepeat(nextMode)
            },
            enabled = has("repeat"),
            modifier = Modifier.size(48.dp),
            shape = CircleShape,
            colors = IconButtonDefaults.filledIconButtonColors(
                containerColor = if (mode != "off") MaterialTheme.colorScheme.primary
                else MaterialTheme.colorScheme.surfaceVariant,
                contentColor = if (mode != "off") MaterialTheme.colorScheme.onPrimary
                else MaterialTheme.colorScheme.onBackground,
            ),
        ) {
            Icon(
                when (mode) {
                    "one" -> Icons.Filled.RepeatOne
                    "all" -> Icons.Filled.RepeatOn
                    else -> Icons.Filled.Repeat
                },
                "Повтор",
                modifier = Modifier.size(22.dp),
            )
        }

        val shOn = state.shuffle == true
        FilledIconButton(
            onClick = { BridgeRepo.setShuffle(!shOn) },
            enabled = has("shuffle"),
            modifier = Modifier.size(48.dp),
            shape = CircleShape,
            colors = IconButtonDefaults.filledIconButtonColors(
                containerColor = if (shOn) MaterialTheme.colorScheme.primary
                else MaterialTheme.colorScheme.surfaceVariant,
                contentColor = if (shOn) MaterialTheme.colorScheme.onPrimary
                else MaterialTheme.colorScheme.onBackground,
            ),
        ) {
            Icon(
                Icons.Filled.Shuffle,
                "Перемешать",
                modifier = Modifier.size(22.dp),
            )
        }
    }

    Spacer(Modifier.height(if (compact) 6.dp else 10.dp))

    // --- громкости ---
    var volDragging by remember { mutableStateOf(false) }
    var volLocal by remember { mutableStateOf(0f) }
    val systemVol = (state.volumeSystem ?: 50f)
    Text(
        "Системная громкость: " + (if (volDragging) volLocal.toInt() else systemVol.toInt()) + "%",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.fillMaxWidth(),
    )
    Slider(
        value = if (volDragging) volLocal else systemVol,
        onValueChange = {
            volDragging = true
            volLocal = it
        },
        onValueChangeFinished = {
            volDragging = false
            BridgeRepo.volumeSystem(volLocal.toInt())
        },
        valueRange = 0f..100f,
        colors = accentSliderColors(),
    )

    if (has("player_volume")) {
        var pvDragging by remember { mutableStateOf(false) }
        var pvLocal by remember { mutableStateOf(0f) }
        val playerVol = (state.volumePlayer ?: 80).toFloat()
        Text(
            "Громкость SoundCloud: " + (if (pvDragging) pvLocal.toInt() else playerVol.toInt()) + "%",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.fillMaxWidth(),
        )
        Slider(
            value = if (pvDragging) pvLocal else playerVol,
            onValueChange = {
                pvDragging = true
                pvLocal = it
            },
            onValueChangeFinished = {
                pvDragging = false
                BridgeRepo.volumePlayer(pvLocal.toInt())
            },
            valueRange = 0f..100f,
            colors = accentSliderColors(),
        )
    }

    Spacer(Modifier.height(8.dp))

    // --- статус и отключение ---
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        val connected = state.extConnected
        Text(
            if (connected) "●" else "○",
            color = if (connected) MaterialTheme.colorScheme.tertiary
            else MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall,
        )
        Spacer(Modifier.width(6.dp))
        Text(
            buildString {
                append("мост: ")
                append(state.device ?: "ПК")
                state.bridgeVersion?.let { append(" · v$it") }
            },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.width(10.dp))
        IconButton(onClick = { BridgeRepo.disconnect() }, modifier = Modifier.size(28.dp)) {
            Icon(
                Icons.Filled.LinkOff,
                "Отключиться",
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(18.dp),
            )
        }
    }
}
