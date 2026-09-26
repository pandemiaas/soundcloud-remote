"""
SoundCloud Remote — WS-сервер моста (протокол SCR-1, ../../PROTOCOL.md).

Роли:
  extension — Chrome-расширение, только loopback, без токена;
  remote    — телефон, обязателен токен (QR-код).

По каждой роли — одно активное соединение; новое вытесняет старое.
Работает в собственном потоке (asyncio); доступ из UI-потока — через
потокобезопасные helpers (ui_status / push_threadsafe / regenerate_token).
"""
from __future__ import annotations

import asyncio
import copy
import io
import ipaddress
import json
import platform
import secrets
import socket
import threading

import qrcode
import qrcode.image.svg
import websockets

import volume

VERSION = "0.3.0"
PORT = 8765

COMMAND_TYPES = {
    "play", "pause", "toggle", "next", "prev",
    "seek", "volume", "like", "repeat", "shuffle",
}

_lock = threading.RLock()
_token = "".join(secrets.choice("0123456789") for _ in range(6))
clients: dict[str, object | None] = {"extension": None, "remote": None}
loop: asyncio.AbstractEventLoop | None = None
listening = False
last_state: dict | None = None
ext_caps: list[str] = []


# ------------------------------------------------------------------ служебное

def token() -> str:
    with _lock:
        return _token


def regenerate_token() -> str:
    global _token
    with _lock:
        _token = "".join(secrets.choice("0123456789") for _ in range(6))
        return _token


def device_name() -> str:
    return platform.node() or "PC"


def lan_ip() -> str:
    """Локальный IP в LAN (для QR): UDP-сокет без отправки пакетов."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
        finally:
            s.close()
    except OSError:
        return "127.0.0.1"


def is_loopback(peer) -> bool:
    try:
        return ipaddress.ip_address(peer[0]).is_loopback
    except (ValueError, TypeError, IndexError):
        return False


# ------------------------------------------------------------- состояние

def set_ext_caps(caps) -> None:
    global ext_caps
    if isinstance(caps, list):
        with _lock:
            ext_caps = [str(c) for c in caps]


def store_state(msg: dict) -> None:
    global last_state
    st = dict(msg)
    st["volume_system"] = volume.get_percent_rounded()
    st["ext_connected"] = True
    with _lock:
        last_state = st


def state_snapshot() -> dict | None:
    with _lock:
        st = copy.deepcopy(last_state) if last_state else None
    if st is not None:
        st["volume_system"] = volume.get_percent_rounded()
        st["ext_connected"] = True
    return st


def ui_status() -> dict:
    with _lock:
        snap = copy.deepcopy(last_state) if last_state else None
        caps = list(ext_caps)
        ext_on = clients.get("extension") is not None
        rem_on = clients.get("remote") is not None
        tok = _token
    return {
        "listening": listening,
        "port": PORT,
        "token": tok,
        "device": device_name(),
        "host": lan_ip(),
        "ext_connected": ext_on,
        "remote_connected": rem_on,
        "ext_caps": caps,
        "volume_system": volume.get_percent_rounded(),
        "bridge_version": VERSION,
        "track": snap,
    }


def qr_svg() -> str:
    payload = f"scremote://connect?host={lan_ip()}&port={PORT}&token={token()}"
    img = qrcode.make(payload, image_factory=qrcode.image.svg.SvgPathImage)
    buf = io.BytesIO()
    img.save(buf)
    return buf.getvalue().decode("utf-8")


# ------------------------------------------------------------- соединения

def register(role: str, ws) -> None:
    with _lock:
        old = clients.get(role)
        clients[role] = ws
    if old is not None and old is not ws:
        close_soon(old)


def close_soon(ws) -> None:
    """Закрыть websocket из чужого потока (вытесненное соединение)."""
    if loop is None:
        return

    async def _close():
        try:
            await ws.close(code=1000, reason="replaced")
        except Exception:
            pass

    asyncio.run_coroutine_threadsafe(_close(), loop)


async def send(ws, obj: dict) -> None:
    try:
        await ws.send(json.dumps(obj, ensure_ascii=False))
    except websockets.ConnectionClosed:
        pass


async def forward(role: str, obj: dict) -> None:
    with _lock:
        ws = clients.get(role)
    if ws is not None:
        await send(ws, obj)


def push_threadsafe(role: str, obj: dict) -> None:
    """Отправить сообщение роли из UI-потока."""
    if loop is None:
        return
    asyncio.run_coroutine_threadsafe(forward(role, obj), loop)


def push_system_volume(percent: float) -> None:
    push_threadsafe("remote", {"t": "meta", "volume_system": round(percent, 1)})


# ----------------------------------------------------------------- обработка

async def handler(ws) -> None:
    role: str | None = None
    peer = ws.remote_address
    try:
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except (ValueError, TypeError):
                await send(ws, {"t": "error", "code": "bad_message", "message": "invalid json"})
                continue

            t = msg.get("t")

            # ---- рукопожатие ----
            if role is None:
                if t != "hello":
                    await send(ws, {"t": "error", "code": "bad_message", "message": "ожидался hello"})
                    continue
                r = msg.get("role")
                if r == "extension":
                    if not is_loopback(peer):
                        await send(ws, {"t": "error", "code": "auth",
                                        "message": "extension доступен только с loopback"})
                        return
                    set_ext_caps(msg.get("caps") or [])
                    register("extension", ws)
                    role = "extension"
                    await send(ws, {"t": "welcome", "proto": 1, "bridge_version": VERSION})
                    snap = state_snapshot()
                    if snap:
                        await send(ws, snap)
                elif r == "remote":
                    if str(msg.get("token") or "") != token():
                        await send(ws, {"t": "error", "code": "auth", "message": "неверный токен"})
                        return
                    register("remote", ws)
                    role = "remote"
                    await send(ws, {"t": "welcome", "proto": 1, "device": device_name(),
                                    "bridge_version": VERSION, "caps": ["system_volume"]})
                    snap = state_snapshot()
                    if snap:
                        await send(ws, snap)
                else:
                    await send(ws, {"t": "error", "code": "bad_message",
                                    "message": f"неизвестная роль: {r}"})
                    return
                continue

            # ---- рабочий обмен ----
            await dispatch(role, t, msg, ws)
    except websockets.ConnectionClosed:
        pass
    finally:
        with _lock:
            was_active = role is not None and clients.get(role) is ws
            if was_active:
                clients[role] = None
        if was_active and role == "extension":
            await forward("remote", {"t": "ext", "connected": False})


async def dispatch(role: str, t, msg: dict, ws) -> None:
    if t == "ping":
        await send(ws, {"t": "pong"})
        return

    if role == "extension":
        if t == "state":
            store_state(msg)
            snap = state_snapshot()
            if snap:
                await forward("remote", snap)
        elif t == "caps":
            set_ext_caps(msg.get("caps"))
            await forward("remote", msg)
        elif t in ("tick", "ack", "error", "ext"):
            await forward("remote", msg)
        else:
            await send(ws, {"t": "error", "code": "bad_message",
                            "message": f"неизвестное сообщение: {t}"})
        return

    # роль remote
    if t == "sync":
        await forward("extension", {"t": "sync"})
    elif t == "volume":
        if msg.get("target") == "system":
            value = float(msg.get("value") or 0)
            volume.set_percent(value)
            now = volume.get_percent_rounded()
            ack = {"t": "ack", "volume_system": now}
            if msg.get("id") is not None:
                ack["id"] = msg["id"]
            await send(ws, ack)
            await send(ws, {"t": "meta", "volume_system": now})
        else:
            await forward("extension", msg)
    elif t in COMMAND_TYPES:
        await forward("extension", msg)
    else:
        await send(ws, {"t": "error", "code": "bad_message",
                        "message": f"неизвестное сообщение: {t}"})


# --------------------------------------------------------------------- старт

def _run(loop_: asyncio.AbstractEventLoop) -> None:
    asyncio.set_event_loop(loop_)
    loop_.run_until_complete(amain())


async def amain() -> None:
    global listening
    async with websockets.serve(handler, "0.0.0.0", PORT,
                                max_size=64 * 1024, ping_interval=20, ping_timeout=20):
        listening = True
        print(f"[bridge] ws://0.0.0.0:{PORT}/ws — ждём расширение и телефон…")
        await asyncio.Future()


def start() -> None:
    """Запустить сервер в фоновом потоке (перед webview.start())."""
    global loop
    loop = asyncio.new_event_loop()
    threading.Thread(target=_run, args=(loop,), daemon=True, name="scr-ws").start()
