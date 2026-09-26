package com.pandemias.scremote.net

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull

/** Чистая (тестируемая) логика протокола SCR-1: сборка сообщений и переходы состояния. */
object ScrProtocol {
    const val PROTO = 1

    // ------------------------------------------------------------ сборка

    fun helloRemote(token: String, name: String): String = JsonObject(
        mapOf(
            "t" to JsonPrimitive("hello"),
            "role" to JsonPrimitive("remote"),
            "proto" to JsonPrimitive(PROTO),
            "token" to JsonPrimitive(token),
            "name" to JsonPrimitive(name),
        )
    ).toString()

    fun sync(): String = JsonObject(mapOf("t" to JsonPrimitive("sync"))).toString()

    fun simple(t: String): String = JsonObject(mapOf("t" to JsonPrimitive(t))).toString()

    fun seek(ms: Long): String = JsonObject(
        mapOf("t" to JsonPrimitive("seek"), "ms" to JsonPrimitive(ms))
    ).toString()

    fun volume(target: String, value: Int): String = JsonObject(
        mapOf(
            "t" to JsonPrimitive("volume"),
            "target" to JsonPrimitive(target),
            "value" to JsonPrimitive(value),
        )
    ).toString()

    fun like(on: Boolean?): String {
        val fields = LinkedHashMap<String, JsonPrimitive>()
        fields["t"] = JsonPrimitive("like")
        if (on != null) fields["on"] = JsonPrimitive(on)
        return JsonObject(fields).toString()
    }

    fun repeatCmd(mode: String): String = JsonObject(
        mapOf("t" to JsonPrimitive("repeat"), "mode" to JsonPrimitive(mode))
    ).toString()

    fun shuffleCmd(on: Boolean): String = JsonObject(
        mapOf("t" to JsonPrimitive("shuffle"), "on" to JsonPrimitive(on))
    ).toString()

    // ------------------------------------------------------------ разбор

    private fun JsonElement?.asObj(): JsonObject? = this as? JsonObject
    private fun JsonObject.str(k: String): String? = (this[k] as? JsonPrimitive)?.content
    private fun JsonObject.bool(k: String): Boolean? = (this[k] as? JsonPrimitive)?.booleanOrNull
    private fun JsonObject.int(k: String): Int? = (this[k] as? JsonPrimitive)?.intOrNull
    private fun JsonObject.long(k: String): Long? = (this[k] as? JsonPrimitive)?.longOrNull
    private fun JsonObject.dbl(k: String): Double? = (this[k] as? JsonPrimitive)?.doubleOrNull
    private fun JsonObject.strList(k: String): Set<String> =
        (this[k] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content }?.toSet() ?: emptySet()

    fun parseTrack(o: JsonObject?): TrackInfo? {
        val title = o?.str("title") ?: return null
        return TrackInfo(
            title = title,
            artist = o.str("artist") ?: "",
            artwork = o.str("artwork"),
            liked = o.bool("liked"),
            url = o.str("url"),
        )
    }

    /** Чистый переход состояния по входящему сообщению. `now` — elapsedRealtime(). */
    fun apply(prev: UiState, text: String, now: Long): ApplyResult {
        val v = runCatching { Json.parseToJsonElement(text).asObj() }.getOrNull()
            ?: return ApplyResult(prev, welcome = false)

        val out = when (v.str("t")) {
            "welcome" -> prev.copy(
                conn = Conn.Connected,
                device = v.str("device") ?: prev.device,
                bridgeVersion = v.str("bridge_version") ?: prev.bridgeVersion,
                caps = v.strList("caps").ifEmpty { prev.caps },
            )

            "state" -> prev.copy(
                extConnected = v.bool("ext_connected") ?: prev.extConnected,
                playing = v.bool("playing") ?: prev.playing,
                positionMs = v.long("position_ms") ?: prev.positionMs,
                positionAt = now,
                durationMs = v.long("duration_ms") ?: prev.durationMs,
                volumePlayer = v.int("volume_player") ?: prev.volumePlayer,
                volumeSystem = v.dbl("volume_system")?.toFloat() ?: prev.volumeSystem,
                repeat = v.str("repeat") ?: prev.repeat,
                shuffle = v.bool("shuffle") ?: prev.shuffle,
                caps = v.strList("caps").ifEmpty { prev.caps },
                track = parseTrack(v["track"].asObj()) ?: prev.track,
            )

            "tick" -> prev.copy(
                playing = v.bool("playing") ?: prev.playing,
                positionMs = v.long("position_ms") ?: prev.positionMs,
                positionAt = now,
                volumePlayer = v.int("volume_player") ?: prev.volumePlayer,
            )

            "meta" -> {
                val newLiked = v.bool("liked")
                prev.copy(
                    repeat = v.str("repeat") ?: prev.repeat,
                    shuffle = v.bool("shuffle") ?: prev.shuffle,
                    volumePlayer = v.int("volume_player") ?: prev.volumePlayer,
                    volumeSystem = v.dbl("volume_system")?.toFloat() ?: prev.volumeSystem,
                    track = if (newLiked != null) {
                        prev.track?.copy(liked = newLiked)
                            ?: TrackInfo(title = "", artist = "", liked = newLiked)
                    } else prev.track,
                )
            }

            "track" -> prev.copy(
                track = parseTrack(v["track"].asObj()) ?: prev.track,
                positionMs = 0,
                positionAt = now,
            )

            "ext" -> prev.copy(extConnected = v.bool("connected") ?: prev.extConnected)

            "ack" -> {
                val vs = v.dbl("volume_system")?.toFloat()
                if (vs != null) prev.copy(volumeSystem = vs) else prev
            }

            "error" -> if (v.str("code") == "auth") prev.copy(authError = true) else prev

            else -> prev
        }
        return ApplyResult(out, welcome = v.str("t") == "welcome")
    }
}

data class TrackInfo(
    val title: String,
    val artist: String,
    val artwork: String? = null,
    val liked: Boolean? = null,
    val url: String? = null,
)

enum class Conn { Disconnected, Connecting, Connected }

data class UiState(
    val conn: Conn = Conn.Disconnected,
    val device: String? = null,
    val bridgeVersion: String? = null,
    val extConnected: Boolean = false,
    val caps: Set<String> = emptySet(),
    val track: TrackInfo? = null,
    val playing: Boolean = false,
    val positionMs: Long = 0L,
    val positionAt: Long = 0L,
    val durationMs: Long = 0L,
    val volumePlayer: Int? = null,
    val volumeSystem: Float? = null,
    val repeat: String? = null,
    val shuffle: Boolean? = null,
    val authError: Boolean = false,
)

data class ApplyResult(val state: UiState, val welcome: Boolean)
