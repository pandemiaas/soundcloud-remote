package com.pandemias.scremote.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.ConcurrentHashMap

/**
 * Обложка трека.
 *
 * Расширение отдаёт artwork из DOM, но SoundCloud часто рендерит его как
 * background-image на вложенном span — селектор может не сработать, и на
 * телефон приходит пусто. Поэтому: если artwork пуст, но есть URL трека —
 * спрашиваем публичный oEmbed SoundCloud (без ключей, без авторизации).
 * Результат кэшируется по URL трека, чтобы не дёргать сеть на каждый тик.
 */
object ArtworkResolver {

    private val http = OkHttpClient()

    /** url трека → ссылка на обложку (или null, если не удалось) */
    private val cache = ConcurrentHashMap<String, String>()

    @Volatile
    private var inFlight: String? = null

    /**
     * Возвращает обложку: сначала то, что дал мост; если пусто — тянет из oEmbed.
     * Вызывать из корутины: при промахе кэша идёт сетевой запрос.
     */
    suspend fun resolve(artworkFromBridge: String?, trackUrl: String?): String? {
        if (!artworkFromBridge.isNullOrBlank()) return artworkFromBridge
        val url = trackUrl?.takeIf { it.isNotBlank() } ?: return null

        cache[url]?.let { return it }
        if (inFlight == url) return null
        inFlight = url
        return try {
            val found = fetchOembed(url)
            if (found != null) cache[url] = found
            found
        } finally {
            inFlight = null
        }
    }

    private suspend fun fetchOembed(trackUrl: String): String? = withContext(Dispatchers.IO) {
        try {
            val endpoint = "https://soundcloud.com/oembed?format=json&url=" +
                java.net.URLEncoder.encode(trackUrl, "UTF-8")
            val req = Request.Builder().url(endpoint).build()
            http.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@withContext null
                val body = resp.body?.string() ?: return@withContext null
                val obj = Json.parseToJsonElement(body).jsonObject
                obj["thumbnail_url"]?.jsonPrimitive?.content
            }
        } catch (e: Exception) {
            null
        }
    }
}
