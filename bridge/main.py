"""SoundCloud Remote — ПК-мост. Запуск: python main.py (или run.bat).

Закрытие окна прячет мост в трей; выход — через меню трея.
"""
from __future__ import annotations

import os
import socket
import sys
import threading

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)

import webview  # noqa: E402

import server as bridge  # noqa: E402
import tray  # noqa: E402
import volume  # noqa: E402

PORT = bridge.PORT


class Api:
    """Методы, доступные фронтенду через window.pywebview.api.*"""

    def get_status(self) -> dict:
        return bridge.ui_status()

    def get_qr_svg(self) -> str:
        return bridge.qr_svg()

    def regenerate_token(self) -> str:
        return bridge.regenerate_token()

    def get_system_volume(self) -> float:
        return volume.get_percent_rounded()

    def set_system_volume(self, v) -> float:
        try:
            value = float(v)
        except (TypeError, ValueError):
            value = 0.0
        volume.set_percent(value)
        now = volume.get_percent_rounded()
        bridge.push_system_volume(now)
        return now


def another_instance_running() -> bool:
    """Порт 8765 уже слушает другой мост?"""
    s = socket.socket()
    try:
        s.connect(("127.0.0.1", PORT))
        return True
    except OSError:
        return False
    finally:
        s.close()


def warn_already_running() -> None:
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(
            0, "SoundCloud Remote уже запущен — смотрите иконку в трее.",
            "Мост", 0x40)
    except Exception:
        print("Мост уже запущен.")


def setup_logging():
    """Чёрный ящик: stdout/stderr и фатальные сбои — в bridge.log.
    Под pythonw консоли нет, иначе краш погибает молча."""
    log_path = os.path.join(BASE, "bridge.log")
    log_f = open(log_path, "a", encoding="utf-8", buffering=1)

    sys.stdout = log_f
    sys.stderr = log_f

    import faulthandler
    faulthandler.enable(log_f)

    def exc_hook(t, v, tb):
        import traceback
        from datetime import datetime
        log_f.write(f"\n=== {datetime.now():%Y-%m-%d %H:%M:%S} uncaught "
                    f"{t.__name__}: {v}\n")
        traceback.print_exception(t, v, tb, file=log_f)

    sys.excepthook = exc_hook
    threading.excepthook = lambda a: exc_hook(a.exc_type, a.exc_value,
                                              a.exc_traceback)

    from datetime import datetime
    log_f.write(f"\n=== start {datetime.now():%Y-%m-%d %H:%M:%S} "
                f"v{bridge.VERSION} pid={os.getpid()}\n")
    log_f.flush()
    return log_f


def main() -> None:
    setup_logging()

    if another_instance_running():
        warn_already_running()
        return

    bridge.start()
    window = webview.create_window(
        "SoundCloud Remote — мост",
        os.path.join(BASE, "ui", "index.html"),
        js_api=Api(),
        width=420,
        height=680,
        min_size=(360, 560),
    )

    # крестик окна = спрятаться в трей
    window.events.closing += lambda: tray.on_window_close(window)
    tray.start(window)

    try:
        webview.start()
    except Exception:
        import traceback
        traceback.print_exc()
        raise
    print("webview.start() завершился")


if __name__ == "__main__":
    main()
