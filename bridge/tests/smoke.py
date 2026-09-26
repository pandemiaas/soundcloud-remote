"""Smoke-тест моста SCR-1 без Chrome и без телефона.

Поднимает настоящий сервер (bridge.handler) на 127.0.0.1 и эмулирует обе роли:
  extension — hello/welcome, приём команд (seek), отправка state (обогащение);
  remote    — hello с неверным токеном (auth error), верный токен, relay, volume.

Запуск:  python tests/smoke.py
"""
from __future__ import annotations

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import websockets  # noqa: E402

import server as bridge  # noqa: E402

URL = f"ws://127.0.0.1:{bridge.PORT}/ws"


async def recv_json(ws, timeout=3.0):
    return json.loads(await asyncio.wait_for(ws.recv(), timeout))


async def main() -> int:
    failures = 0

    def check(name: str, cond: bool, extra="") -> None:
        nonlocal failures
        print(("PASS  " if cond else "FAIL  ") + name + (f"   {extra}" if extra and not cond else ""))
        if not cond:
            failures += 1

    async with websockets.serve(bridge.handler, "127.0.0.1", bridge.PORT):
        bridge.listening = True
        tok = bridge.token()

        # ---- extension: hello -> welcome ----
        async with websockets.connect(URL) as ext:
            await ext.send(json.dumps({"t": "hello", "role": "extension", "proto": 1,
                                       "ext": "chrome", "version": "0.1.3",
                                       "caps": ["metadata", "seek"]}))
            welcome = await recv_json(ext)
            check("extension hello -> welcome", welcome.get("t") == "welcome", str(welcome))
            check("extension caps update", bridge.ext_caps == ["metadata", "seek"], str(bridge.ext_caps))

            # ---- remote: неверный токен -> error auth ----
            async with websockets.connect(URL) as bad:
                await bad.send(json.dumps({"t": "hello", "role": "remote", "proto": 1,
                                           "token": "000000", "name": "intruder"}))
                err = await recv_json(bad)
                check("remote bad token -> error auth",
                      err.get("t") == "error" and err.get("code") == "auth", str(err))

            # ---- remote: верный токен -> welcome ----
            async with websockets.connect(URL) as rem:
                await rem.send(json.dumps({"t": "hello", "role": "remote", "proto": 1,
                                           "token": tok, "name": "smoke-phone"}))
                w2 = await recv_json(rem)
                check("remote hello -> welcome", w2.get("t") == "welcome", str(w2))
                check("welcome содержит system_volume",
                      "system_volume" in (w2.get("caps") or []), str(w2))

                # ---- remote -> seek: команда доходит до расширения ----
                await rem.send(json.dumps({"t": "seek", "id": 7, "ms": 12345}))
                cmd = await recv_json(ext)
                check("relay seek -> extension",
                      cmd.get("t") == "seek" and cmd.get("id") == 7 and cmd.get("ms") == 12345,
                      str(cmd))

                # ---- extension -> state: обогащается и уходит телефону ----
                await ext.send(json.dumps({
                    "t": "state", "playing": True, "position_ms": 1000, "duration_ms": 60000,
                    "volume_player": 80, "repeat": "off", "shuffle": False,
                    "track": {"title": "Test", "artist": "Artist", "artwork": None,
                              "liked": False, "url": None},
                }))
                st = await recv_json(rem)
                check("state forwarded", st.get("t") == "state", str(st)[:120])
                check("state обогащён ext_connected", st.get("ext_connected") is True)
                check("state обогащён volume_system", "volume_system" in st, str(st)[:120])

                # ---- tick релеится ----
                await ext.send(json.dumps({"t": "tick", "position_ms": 2000, "playing": True,
                                           "volume_player": 80}))
                tick = await recv_json(rem)
                check("tick relayed", tick.get("t") == "tick" and tick.get("position_ms") == 2000)

                # ---- remote volume{system}: ack + meta от моста ----
                await rem.send(json.dumps({"t": "volume", "id": 9, "target": "system", "value": 37}))
                ack = await recv_json(rem)
                check("system volume ack", ack.get("t") == "ack" and "volume_system" in ack, str(ack))
                meta = await recv_json(rem)
                check("system volume meta", meta.get("t") == "meta"
                      and "volume_system" in meta, str(meta))

                # ---- remote volume{player}: уходит расширению ----
                await rem.send(json.dumps({"t": "volume", "target": "player", "value": 10}))
                cmd2 = await recv_json(ext)
                check("player volume forwarded", cmd2.get("t") == "volume"
                      and cmd2.get("target") == "player", str(cmd2))

                # ---- неизвестное сообщение ----
                await rem.send(json.dumps({"t": "nonsense"}))
                e2 = await recv_json(rem)
                check("unknown t -> bad_message", e2.get("code") == "bad_message", str(e2))

        # ---- extension отключился -> remote получает ext:false ----
        # (новое соединение remote, чтобы было кому доставить)
        async with websockets.connect(URL) as rem2:
            await rem2.send(json.dumps({"t": "hello", "role": "remote", "proto": 1,
                                        "token": tok, "name": "watcher"}))
            await recv_json(rem2)  # welcome
            async with websockets.connect(URL) as ext2:
                await ext2.send(json.dumps({"t": "hello", "role": "extension", "proto": 1,
                                            "ext": "chrome", "caps": []}))
                await recv_json(ext2)  # welcome
            # ext2 закрылся — ждём ext:false
            try:
                while True:
                    msg = await recv_json(rem2, timeout=3.0)
                    if msg.get("t") == "ext" and msg.get("connected") is False:
                        check("extension disconnect -> ext:false", True)
                        break
            except asyncio.TimeoutError:
                check("extension disconnect -> ext:false", False)

    print()
    if failures:
        print(f"SMOKE FAILED: {failures} проверок не прошло")
        return 1
    print("SMOKE OK — все проверки прошли")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
