package com.pandemias.scremote.net

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit

/** Тонкая обёртка OkHttp WebSocket: колбэки + флаг «закрыто нами». */
class WsClient(
    private val url: String,
    private val onOpen: () -> Unit,
    private val onMessage: (String) -> Unit,
    private val onDown: () -> Unit,
) {
    /** Общий клиент: пулы соединений/потоков не плодятся на каждом реконнекте. */
    private companion object {
        val client: OkHttpClient = OkHttpClient.Builder()
            .pingInterval(20, TimeUnit.SECONDS)
            .connectTimeout(5, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }

    private var ws: WebSocket? = null

    @Volatile
    private var closedByUs = false

    private val listener = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            onOpen()
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            onMessage(text)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            if (!closedByUs) onDown()
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            if (!closedByUs) onDown()
        }
    }

    fun connect() {
        closedByUs = false
        val request = Request.Builder().url(url).build()
        ws = client.newWebSocket(request, listener)
    }

    fun send(text: String): Boolean = try {
        ws?.send(text) ?: false
    } catch (_: Exception) {
        false
    }

    fun close() {
        closedByUs = true
        try {
            ws?.close(1000, "bye")
        } catch (_: Exception) {
        }
        ws = null
    }
}
