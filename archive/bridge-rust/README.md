# bridge — ПК-мост SoundCloud Remote

**Стек:** Tauri 2 + Rust (axum WebSocket-сервер, системная громкость Windows) +
TypeScript-фронтенд в системном WebView2. ~40–70 МБ RAM против ~150–300 у Electron.

**Статус:** Этап 2 готов (ядро): WS-сервер с ролями `extension`/`remote`,
токен-авторизация, ретрансляция по SCR-1, системная громкость Windows,
окно статуса с QR-кодом подключения. Дальше — Этап 3: мастер первого запуска
(GitHub, «Скоро…», галочка автозапуска), tray, автозапуск.

## Что уже умеет

- Сервер `ws://0.0.0.0:8765/ws` (протокол — [`../PROTOCOL.md`](../PROTOCOL.md)):
  - `extension` — только loopback, без токена (Chrome-расширение уже умеет к нему подключаться);
  - `remote` — телефон, обязателен токен; неверный → `error{code:"auth"}` и разрыв;
  - по роли одно активное соединение, новое вытесняет старое;
  - ретрансляция `state`/`tick`/команд/`ack`/`error`, кэш последнего состояния — новый клиент получает снапшот сразу после `hello`.
- Системная громкость: `volume {target:"system"}` исполняет мост сам
  (IAudioEndpointVolume), `target:"player"` уходит расширению.
- QR-код `scremote://connect?host=…&port=8765&token=…` + кнопка
  «Перевыпустить токен», статус расширения/телефона/трека, слайдер
  системной громкости.

## Сборка и запуск

Требуется: **Rust** ([rustup](https://rustup.rs), stable) + **Node.js 18+** +
WebView2 (есть в Windows 10/11 по умолчанию).

```bash
cd bridge
npm install
npm run tauri dev     # разработка (горячая перезагрузка фронтенда)
npm run tauri build   # релиз: .exe/.msi/.nsis в src-tauri/target/release/bundle/
```

Проверка без телефона: запустите мост, откройте SoundCloud в Chrome
(расширение подключится — индикатор станет зелёным), а в powershell:

```powershell
$ws = New-Object System.Net.WebSockets.ClientWebSocket
# … или любой WS-клиент: подключитесь к ws://127.0.0.1:8765/ws и пришлите
# {"t":"hello","role":"remote","proto":1,"token":"<токен из окна>","name":"test"}
```

## Как устроено

```
src-tauri/
  src/
    main.rs        вход (windows_subsystem для релиза)
    lib.rs         AppState: роли, поколения соединений, токен, кэш состояния
    server.rs      axum WS-сервер: hello/роли, ретрансляция, вытеснение
    commands.rs    Tauri-команды для окна (статус, QR, громкость, токен)
    volume.rs      системная громкость Windows (COM, IAudioEndpointVolume)
  tauri.conf.json  окно 420×680, bundle nsis+msi
  icons/           icon.ico (встроен PNG), icon.png
src/ + index.html  фронтенд окна статуса (vanilla TS + Vite)
```

Замечания к дизайну:

- COM инициализируется на каждый вызов громкости (потоки tokio разные);
  баланс S_OK/S_FALSE учитывается, `RPC_E_CHANGED_MODE` не фатален.
- Токен пока живёт в памяти процесса (перевыпуск — кнопкой). Персистентность
  и мастер первого запуска — Этап 3.
- На не-Windows громкость — заглушки (0%), остальное работает.
