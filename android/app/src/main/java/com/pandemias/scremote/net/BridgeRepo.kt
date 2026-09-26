package com.pandemias.scremote.net

import android.os.SystemClock
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

/**
 * Единое состояние моста: подключение, автореконнект с backoff, команды SCR-1.
 * Синглтон — переживает пересоздание Activity при повороте.
 */
object BridgeRepo {

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var client: WsClient? = null
    private var loopJob: Job? = null

    @Volatile private var manualStop = false
    private var host = ""
    private var port = 8765
    private var token = ""
    private var deviceName = "Phone"

    /** Шлём наверх для логирования/отладки при желании. */
    var onError: ((String) -> Unit)? = null

    fun connect(host: String, port: Int, token: String, deviceName: String) {
        this.host = host.trim()
        this.port = port
        this.token = token.trim()
        this.deviceName = deviceName.ifBlank { "Phone" }
        manualStop = false
        // прибираем за предыдущей попыткой, чтобы не копить сокеты
        client?.close()
        client = null
        _state.value = UiState(conn = Conn.Connecting)
        loopJob?.cancel()
        loopJob = scope.launch { reconnectLoop() }
    }

    fun disconnect() {
        manualStop = true
        loopJob?.cancel()
        loopJob = null
        client?.close()
        client = null
        _state.value = UiState(conn = Conn.Disconnected)
    }

    private suspend fun reconnectLoop() {
        var backoff = 1000L
        while (coroutineContext.isActive && !manualStop) {
            val opened = CompletableDeferred<Boolean>()
            val down = Channel<Unit>(Channel.CONFLATED)

            val ws = WsClient(
                url = "ws://$host:$port/ws",
                onOpen = {
                    _state.value = _state.value.copy(conn = Conn.Connected, authError = false)
                    wsSend(ScrProtocol.helloRemote(token, deviceName))
                    wsSend(ScrProtocol.sync())
                    opened.complete(true)
                },
                onMessage = ::onMessage,
                onDown = {
                    _state.value = _state.value.copy(conn = Conn.Connecting)
                    opened.complete(false)
                    down.trySend(Unit)
                },
            )
            client = ws
            ws.connect()

            val ok = try {
                withTimeout(10_000) { opened.await() }
            } catch (_: Exception) {
                false
            }

            if (ok) {
                backoff = 1000L
                down.receive()          // ждём обрыв
            } else {
                ws.close()
            }

            if (manualStop) {
                _state.value = _state.value.copy(conn = Conn.Disconnected)
                return
            }
            if (_state.value.authError) {
                // неверный токен — reconnect бессмыслен, отдаём управление юзеру
                disconnect()
                return
            }

            delay(backoff)
            backoff = (backoff * 2).coerceAtMost(30_000L)
        }
    }

    private fun wsSend(text: String): Boolean = client?.send(text) ?: false

    private fun onMessage(text: String) {
        val res = ScrProtocol.apply(_state.value, text, SystemClock.elapsedRealtime())
        _state.value = res.state
        if (res.welcome) wsSend(ScrProtocol.sync())
        if (_state.value.authError) {
            onError?.invoke("Неверный токен")
            disconnect()
        }
    }

    // ------------------------------------------------------------- команды

    fun seek(ms: Long) = wsSend(ScrProtocol.seek(ms))
    fun play() = wsSend(ScrProtocol.simple("play"))
    fun pause() = wsSend(ScrProtocol.simple("pause"))
    fun toggle() = wsSend(ScrProtocol.simple("toggle"))
    fun next() = wsSend(ScrProtocol.simple("next"))
    fun prev() = wsSend(ScrProtocol.simple("prev"))
    fun volumePlayer(v: Int) = wsSend(ScrProtocol.volume("player", v))
    fun volumeSystem(v: Int) = wsSend(ScrProtocol.volume("system", v))
    fun like(on: Boolean?) = wsSend(ScrProtocol.like(on))
    fun setRepeat(mode: String) = wsSend(ScrProtocol.repeatCmd(mode))
    fun setShuffle(on: Boolean) = wsSend(ScrProtocol.shuffleCmd(on))
    fun sync() = wsSend(ScrProtocol.sync())

    fun shutdown() {
        disconnect()
        scope.cancel()
    }
}
