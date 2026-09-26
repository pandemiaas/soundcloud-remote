# android — пульт SoundCloud Remote

**Стек:** Kotlin + Jetpack Compose (Material 3), OkHttp WebSocket,
kotlinx.serialization, DataStore, CameraX + ZXing (QR). Нативное приложение,
никаких WebView. minSdk 26 (Android 8.0).

**Сборка — только GitHub Actions:** на машине разработки неисправная RAM,
поэтому локально Android-сборки не запускаются вовсе. Обоснование стека —
в [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).

**Статус:** код Этапов 4–5 готов; APK собирается в CI (артефакт каждого
прогона + Release по тегу `android-v*`).

## Как получить APK

1. Запушьте `android/` в репозиторий (или запустите workflow
   **android-build** вручную из вкладки Actions).
2. Скачайте артефакт **sc-remote-apk** со страницы запуска workflow.
3. Либо поставьте тег `android-v0.4.0` — APK автоматически уйдёт в Releases.
4. Перекиньте APK на телефон и установите (разрешите «неизвестные источники»).

Подпись: v1 подписывается debug-ключом CI — APK полностью рабочий и ставится
вручную. Стабильная подпись (для обновлений без переустановки) добавляется
секретами `KEYSTORE_BASE64`/`KEYSTORE_PASSWORD` позже.

## Как подключиться

1. Запустите мост на ПК (`bridge/run.bat`) — в окне есть QR-код и токен.
2. В приложении: **QR** — навести камеру на QR-код, либо ввести IP, порт
   (`8765`) и токен вручную.
3. Телефон и ПК должны быть в одной Wi-Fi-сети. Повторный запуск приложения
   подключается к последнему серверу автоматически.

QR несёт `scremote://connect?host=…&port=…&token=…` — ссылку можно отсканировать
и сторонним сканером: приложение подхватит её как deep link.

## Экран плеера

- Портрет: обложка → название/исполнитель → время + seek-полоса →
  prev/play/next → like/repeat/shuffle → слайдеры громкости (системная и
  SoundCloud) → статус и отключение.
- Ландшафт: обложка слева, управление справа (авто-поворот не заблокирован).
- Позиция дорисовывается локально между тиками — плавно, без лагов.
- Контролы, которых нет в `caps` (например, repeat недоступен), дизейблятся.
- Если вкладка SoundCloud закрыта — баннер «Откройте SoundCloud в браузере».
- Обрывы лечатся автореконнектом (1→30 c) + `sync` после возврата.

## Как устроено

```
app/src/main/java/com/pandemias/scremote/
  MainActivity.kt       корневая навигация: подключение ↔ плеер, deep link
  net/ScrProtocol.kt    чистый протокол SCR-1: сборка команд, парсинг в UiState
  net/WsClient.kt       OkHttp WebSocket
  net/BridgeRepo.kt     синглтон: StateFlow<UiState>, реконнект, команды
  data/SettingsStore.kt DataStore: host/port/token/имя устройства
  ui/ConnectScreen.kt   ручной ввод
  ui/QrScanner.kt       CameraX + ZXing
  ui/PlayerScreen.kt    портрет/ландшафт, все контролы
  ui/theme/Theme.kt     тёмная M3-тема
app/src/test/…/ScrProtocolTest.kt   unit-тесты протокола (гоняются в CI)
```

## Локальная сборка (не рекомендуется при неисправной RAM)

Возможна после замены памяти: Android Studio / JDK 17,
`gradle :app:assembleRelease`.
