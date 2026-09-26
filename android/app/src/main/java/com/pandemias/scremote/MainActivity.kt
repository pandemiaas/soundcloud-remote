package com.pandemias.scremote

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.pandemias.scremote.data.SavedSettings
import com.pandemias.scremote.data.SettingsStore
import com.pandemias.scremote.net.BridgeRepo
import com.pandemias.scremote.net.Conn
import com.pandemias.scremote.ui.ConnectScreen
import com.pandemias.scremote.ui.PlayerScreen
import com.pandemias.scremote.ui.QrScanner
import com.pandemias.scremote.ui.theme.SCRemoteTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // тёмные системные бары со светлыми иконками (наш фон всегда тёмный)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )

        // запуск по QR-ссылке из внешнего сканера: scremote://connect?...
        val deepLinkData: String? = intent?.data?.toString()

        setContent {
            SCRemoteTheme {
                Root(deepLink = deepLinkData)
            }
        }
    }
}

@androidx.compose.runtime.Composable
fun Root(deepLink: String?) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val state by BridgeRepo.state.collectAsState()

    var saved by remember { mutableStateOf<SavedSettings?>(null) }
    var scanning by remember { mutableStateOf(false) }
    var autoConnectTried by remember { mutableStateOf(false) }

    // автоподключение к последнему мосту при старте
    LaunchedEffect(Unit) {
        val s = SettingsStore.load(ctx)
        if (s != null) {
            saved = s
            if (BridgeRepo.state.value.conn == Conn.Disconnected && !autoConnectTried) {
                autoConnectTried = true
                BridgeRepo.connect(s.host, s.port, s.token, s.deviceName)
            }
        }
    }

    // deep link из внешнего QR-сканера
    LaunchedEffect(deepLink) {
        val link = deepLink ?: return@LaunchedEffect
        val uri = android.net.Uri.parse(link)
        val host = uri.getQueryParameter("host") ?: return@LaunchedEffect
        val port = uri.getQueryParameter("port")?.toIntOrNull() ?: 8765
        val token = uri.getQueryParameter("token") ?: return@LaunchedEffect
        val name = android.os.Build.MODEL ?: "Phone"
        autoConnectTried = true
        scope.launch {
            SettingsStore.save(ctx, SavedSettings(host, port, token, name))
            saved = SavedSettings(host, port, token, name)
            BridgeRepo.connect(host, port, token, name)
        }
    }

    if (scanning) {
        QrScanner(
            onResult = { data ->
                scanning = false
                val uri = android.net.Uri.parse(data)
                val host = uri.getQueryParameter("host")
                val port = uri.getQueryParameter("port")?.toIntOrNull() ?: 8765
                val token = uri.getQueryParameter("token")
                if (!host.isNullOrBlank() && !token.isNullOrBlank()) {
                    val name = android.os.Build.MODEL ?: "Phone"
                    autoConnectTried = true
                    scope.launch {
                        SettingsStore.save(ctx, SavedSettings(host, port, token, name))
                        saved = SavedSettings(host, port, token, name)
                        BridgeRepo.connect(host, port, token, name)
                    }
                }
            },
            onDismiss = { scanning = false },
        )
        return
    }

    if (state.conn == Conn.Connected) {
        PlayerScreen()
        return
    }

    ConnectScreen(
        saved = saved,
        connecting = state.conn == Conn.Connecting,
        authError = state.authError,
        onConnect = { host, port, token ->
            val name = android.os.Build.MODEL ?: "Phone"
            autoConnectTried = true
            scope.launch {
                SettingsStore.save(ctx, SavedSettings(host, port, token, name))
                saved = SavedSettings(host, port, token, name)
                BridgeRepo.connect(host, port, token, name)
            }
        },
        onScan = { scanning = true },
        onForget = {
            autoConnectTried = true
            BridgeRepo.disconnect()
            scope.launch { SettingsStore.save(ctx, SavedSettings("", 8765, "", "Phone")) }
            saved = null
        },
    )
}
