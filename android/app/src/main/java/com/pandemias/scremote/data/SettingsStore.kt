package com.pandemias.scremote.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first

private val Context.dataStore by preferencesDataStore(name = "settings")

data class SavedSettings(
    val host: String,
    val port: Int,
    val token: String,
    val deviceName: String,
)

object SettingsStore {
    private val KEY_HOST = stringPreferencesKey("host")
    private val KEY_PORT = intPreferencesKey("port")
    private val KEY_TOKEN = stringPreferencesKey("token")
    private val KEY_NAME = stringPreferencesKey("name")

    suspend fun load(ctx: Context): SavedSettings? {
        val p = ctx.dataStore.data.first()
        val host = p[KEY_HOST] ?: return null
        return SavedSettings(
            host = host,
            port = p[KEY_PORT] ?: 8765,
            token = p[KEY_TOKEN] ?: "",
            deviceName = p[KEY_NAME] ?: "Phone",
        )
    }

    suspend fun save(ctx: Context, s: SavedSettings) {
        ctx.dataStore.edit { e ->
            e[KEY_HOST] = s.host
            e[KEY_PORT] = s.port
            e[KEY_TOKEN] = s.token
            e[KEY_NAME] = s.deviceName
        }
    }
}
