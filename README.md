# SoundCloud Remote

Мобильный пульт SoundCloud: нативное Android-приложение управляет плеером
SoundCloud в браузере на ПК через локальную сеть (Wi-Fi). Без облака, без
сайтов — только нативные приложения.

- Протокол связи: [`PROTOCOL.md`](PROTOCOL.md) (SCR-1)
- Архитектура и выбор стека: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Состав монорепозитория

```
soundcloud-remote/
├── PROTOCOL.md          # протокол SCR-1 — единый источник правды
├── docs/ARCHITECTURE.md # схема, стек, этапы, риски
├── extension/           # Chrome Extension MV3 (глаза и руки в SoundCloud)
├── bridge/              # ПК-мост на Python (pywebview + websockets + pycaw)
├── archive/bridge-rust/ # архивная Rust/Tauri-версия моста
└── android/             # нативный пульт на Kotlin + Compose (Этап 4–6)
```

> Мост переведён с Rust на Python: на машине разработки неисправная RAM
> (MemTest86: 5318 ошибок), поэтому локальные компиляции запрещены — мост
> запускается из исходников без сборки, APK и тяжёлые сборки делаются только
> в GitHub Actions. Rust-версия сохранена в архиве на будущее.

## Возможности

Перелистывание треков, play/pause, перемотка (seek), лайк, повтор (off/all/one),
shuffle, громкость в двух режимах (плеер SoundCloud и системная громкость
Windows), обложка/название/исполнитель/прогресс на телефоне.

## Статус

| Компонент | Статус |
|---|---|
| Протокол SCR-1 | ✅ |
| Chrome-расширение | ✅ (Этап 1) |
| ПК-мост (Python) | ✅ Этап 2–3: сервер, роли, токен, громкость, окно + QR, трей; smoke 15/15 |
| Android-приложение | ✅ собрано и опубликовано: [Release android-v0.4.0](https://github.com/pandemiaas/soundcloud-remote/releases/tag/android-v0.4.0) (unit-тесты ✅) |

## Быстрый старт

**Расширение:**
1. `chrome://extensions` → режим «Для разработчиков» → «Загрузить распакованное
   расширение» → папка `extension/`.
2. Откройте [soundcloud.com](https://soundcloud.com) и включите любой трек.
3. Кликните по иконке расширения: увидите состояние плеера; когда мост запущен —
   индикатор станет зелёным.
4. Статус и найденные элементы плеера — в попапе расширения; диагностика
   селекторов — командой `__debug_snapshot` (см. `extension/README.md`).

**Мост:**
1. Python 3.10+ → `pip install -r requirements.txt` (в папке `bridge/`).
2. `run.bat` — окно статуса + сервер `ws://0.0.0.0:8765/ws`.
3. Проверка протокола без телефона: `python tests\smoke.py`.
