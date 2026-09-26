"""Системная громкость Windows через pycaw (IAudioEndpointVolume).

ВАЖНО: comtypes/pycaw не потокобезопасны для параллельных вызовов, а громкость
дёргают минимум два потока (UI-поллинг раз в секунду + тики расширения).
Поэтому все COM-вызовы выполняются в ОДНОМ выделенном потоке (COM инициализируется
там один раз), наружу — потокобезопасные get/set. Чтение кэшируется на 2 секунды.
"""
from __future__ import annotations

import queue
import threading
import time

_q: "queue.Queue" = queue.Queue()
_lock = threading.Lock()
_worker_started = False

_cache_lock = threading.Lock()
_cache_value: float | None = None
_cache_ts = 0.0
CACHE_TTL = 2.0


def _worker(q: "queue.Queue") -> None:
    import comtypes
    from comtypes import CLSCTX_ALL, POINTER, cast
    from pycaw.constants import CLSID_MMDeviceEnumerator
    from pycaw.pycaw import IMMDeviceEnumerator, IAudioEndpointVolume

    try:
        comtypes.CoInitialize()
    except OSError:
        pass  # уже инициализирован

    try:
        enumerator = comtypes.CoCreateInstance(
            CLSID_MMDeviceEnumerator, interface=IMMDeviceEnumerator, clsctx=CLSCTX_ALL
        )
        device = enumerator.GetDefaultAudioEndpoint(0, 1)  # eRender, eMultimedia
        ep = cast(device.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None),
                  POINTER(IAudioEndpointVolume))
    except Exception as e:
        # Всё, что ждёт в очереди, получит это исключение как результат
        while True:
            op, value, rq = q.get()
            try:
                rq.put(e)
            except Exception:
                pass
        return

    while True:
        op, value, rq = q.get()
        try:
            if op == "get":
                rq.put(float(ep.GetMasterVolumeLevelScalar()) * 100.0)
            elif op == "set":
                v = max(0.0, min(100.0, float(value)))
                ep.SetMasterVolumeLevelScalar(v / 100.0, None)
                rq.put(float(ep.GetMasterVolumeLevelScalar()) * 100.0)
            else:
                rq.put(RuntimeError(f"unknown op: {op}"))
        except Exception as e:
            try:
                rq.put(e)
            except Exception:
                pass


def _ensure_worker() -> None:
    global _worker_started
    with _lock:
        if _worker_started:
            return
        _worker_started = True
    threading.Thread(target=_worker, args=(_q,), daemon=True, name="scr-volume").start()


def _call(op: str, value=None, timeout: float = 3.0):
    _ensure_worker()
    rq: "queue.Queue" = queue.Queue()
    _q.put((op, value, rq))
    try:
        res = rq.get(timeout=timeout)
    except queue.Empty:
        raise RuntimeError("volume worker timeout")
    if isinstance(res, Exception):
        raise res
    return res


def get_percent() -> float:
    global _cache_value, _cache_ts
    with _cache_lock:
        if _cache_value is not None and time.monotonic() - _cache_ts < CACHE_TTL:
            return _cache_value
    try:
        v = float(_call("get"))
    except Exception:
        # COM недоступен — отдаём последнее известное значение
        with _cache_lock:
            return _cache_value if _cache_value is not None else 0.0
    with _cache_lock:
        _cache_value = v
        _cache_ts = time.monotonic()
    return v


def get_percent_rounded() -> float:
    return round(get_percent(), 1)


def set_percent(value: float) -> bool:
    try:
        v = float(_call("set", value))
    except Exception:
        return False
    global _cache_value, _cache_ts
    with _cache_lock:
        _cache_value = v
        _cache_ts = time.monotonic()
    return True
