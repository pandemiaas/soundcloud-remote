package com.pandemias.scremote.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ScrProtocolTest {

    @Test
    fun `state применяется целиком`() {
        val text = """
            {"t":"state","playing":true,"position_ms":1000,"duration_ms":60000,
             "volume_player":70,"volume_system":40.5,"repeat":"all","shuffle":false,
             "ext_connected":true,
             "caps":["metadata","seek"],
             "track":{"title":"T","artist":"A","artwork":"http://x/y.jpg",
                      "liked":false,"url":"http://x"}}
        """.trimIndent()

        val res = ScrProtocol.apply(UiState(), text, now = 100L)
        val s = res.state

        assertTrue(s.playing)
        assertEquals(1000L, s.positionMs)
        assertEquals(100L, s.positionAt)
        assertEquals(60000L, s.durationMs)
        assertEquals(70, s.volumePlayer)
        assertEquals(40.5f, s.volumeSystem!!, 0.01f)
        assertEquals("all", s.repeat)
        assertEquals(false, s.shuffle)
        assertTrue(s.extConnected)
        assertTrue(s.caps.contains("seek"))
        assertEquals("T", s.track?.title)
        assertEquals("A", s.track?.artist)
        assertFalse(s.track?.liked == true)
    }

    @Test
    fun `tick обновляет позицию и метку времени`() {
        val start = ScrProtocol.apply(
            UiState(playing = true, positionMs = 0, positionAt = 0), 
            """{"t":"tick","position_ms":5000,"playing":true}""",
            now = 777L,
        )
        assertEquals(5000L, start.state.positionMs)
        assertEquals(777L, start.state.positionAt)
    }

    @Test
    fun `meta меняет liked внутри track`() {
        val withTrack = ScrProtocol.apply(
            UiState(),
            """{"t":"state","track":{"title":"X","artist":"Y","liked":false}}""",
            now = 0L,
        ).state
        val after = ScrProtocol.apply(withTrack, """{"t":"meta","liked":true}""", now = 1L)
        assertEquals(true, after.state.track?.liked)
    }

    @Test
    fun `welcome переключает состояние в Connected`() {
        val res = ScrProtocol.apply(
            UiState(),
            """{"t":"welcome","proto":1,"device":"DESK","bridge_version":"0.3.0","caps":["system_volume"]}""",
            now = 0L,
        )
        assertTrue(res.welcome)
        assertEquals(Conn.Connected, res.state.conn)
        assertEquals("DESK", res.state.device)
    }

    @Test
    fun `auth error выставляет флаг`() {
        val res = ScrProtocol.apply(UiState(), """{"t":"error","code":"auth"}""", now = 0L)
        assertTrue(res.state.authError)
    }

    @Test
    fun `битый json не роняет разбор`() {
        val res = ScrProtocol.apply(UiState(), "not a json", now = 0L)
        assertEquals(UiState(), res.state)
        assertFalse(res.welcome)
    }

    @Test
    fun `билдеры дают валидный json`() {
        assertTrue(ScrProtocol.helloRemote("123456", "Pixel").contains("\"role\":\"remote\""))
        assertTrue(ScrProtocol.seek(95_000).contains("\"ms\":95000"))
        assertTrue(ScrProtocol.volume("system", 40).contains("\"target\":\"system\""))
        assertTrue(ScrProtocol.like(null).contains("\"t\":\"like\""))
        assertTrue(ScrProtocol.repeatCmd("one").contains("\"mode\":\"one\""))
        assertTrue(ScrProtocol.shuffleCmd(true).contains("\"on\":true"))
        assertTrue(ScrProtocol.sync().contains("\"t\":\"sync\""))
    }

    @Test
    fun `track без title не парсится`() {
        assertNull(ScrProtocol.parseTrack(null))
        assertNull(ScrProtocol.parseTrack(JsonObjectOf("artist" to "A")))
    }

    private fun JsonObjectOf(vararg pairs: Pair<String, String>) =
        kotlinx.serialization.json.JsonObject(
            mapOf(*pairs.map { it.first to kotlinx.serialization.json.JsonPrimitive(it.second) }.toTypedArray())
        )
}
