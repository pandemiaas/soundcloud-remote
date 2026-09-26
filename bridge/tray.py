"""Трей-иконка моста: закрытие окна прячется в трей, выход — через меню трея."""
from __future__ import annotations

import os
import threading

import pystray
from PIL import Image, ImageDraw

_icon: pystray.Icon | None = None


def _build_image() -> Image.Image:
    """Оранжевый скруглённый квадрат с белыми «столбиками» (64×64)."""
    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=max(4, int(size * 0.22)),
                        fill=(255, 85, 0, 255))
    bars = [(0.28, 0.22), (0.50, 0.40), (0.72, 0.28)]
    bw = max(3, int(size * 0.09))
    for cx_frac, h_frac in bars:
        bh = int(size * h_frac)
        cx = int(size * cx_frac)
        d.rectangle([cx - bw // 2, size // 2 - bh // 2,
                     cx - bw // 2 + bw, size // 2 + bh // 2],
                    fill=(255, 255, 255, 255))
    return img


def on_window_close(window) -> bool:
    """Обработчик события closing (pywebview 6): вернуть False = отменить
    закрытие. Окно прячется — мост продолжает работать в трее."""
    try:
        window.hide()
    except Exception:
        pass
    return False


def _show(window) -> None:
    try:
        window.show()
    except Exception:
        pass


def _quit(window) -> None:
    try:
        if _icon is not None:
            _icon.stop()
    except Exception:
        pass
    # window.destroy() из чужого потока лишний раз дёргает нативный код —
    # процесс и так завершится вместе с демоном WS: выходим гарантированно.
    os._exit(0)


def start(window) -> None:
    """Запустить иконку трея в фоновом потоке."""
    global _icon
    menu = pystray.Menu(
        pystray.MenuItem("Показать", lambda: _show(window), default=True),
        pystray.MenuItem("Выход", lambda: _quit(window)),
    )
    _icon = pystray.Icon("sc-remote-bridge", _build_image(),
                         "SoundCloud Remote — мост", menu)
    threading.Thread(target=_icon.run, daemon=True, name="scr-tray").start()
