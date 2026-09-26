/* SoundCloud Remote — мост: окно статуса (pywebview). */
"use strict";

const $ = (id) => document.getElementById(id);

function fmtTime(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return (h > 0 ? h + ":" : "") + mm + ":" + String(s).padStart(2, "0");
}

function render(s) {
  $("version").textContent = "мост v" + s.bridge_version;

  $("dot-listen").className = "dot " + (s.listening ? "on" : "off");
  $("listen-text").textContent = s.listening
    ? "Сервер: ws://" + s.host + ":" + s.port + "/ws"
    : "Сервер: не запущен";

  $("dot-ext").className = "dot " + (s.ext_connected ? "on" : "off");
  $("ext-text").textContent = s.ext_connected
    ? "Расширение SoundCloud: подключено"
    : "Расширение: откройте soundcloud.com в Chrome";

  $("dot-remote").className = "dot " + (s.remote_connected ? "on" : "off");
  $("remote-text").textContent = s.remote_connected
    ? "Телефон: подключен"
    : "Телефон: ждёт подключения";

  const track = s.track;
  const card = $("track");
  if (track && track.title) {
    card.hidden = false;
    $("t-title").textContent = track.title;
    $("t-artist").textContent = track.artist || "—";
    $("t-pos").textContent =
      (track.playing ? "▶ " : "⏸ ") + fmtTime(track.position_ms) + " / " + fmtTime(track.duration_ms);
    $("t-vol").textContent = track.volume_player != null ? track.volume_player + "%" : "—";
  } else {
    card.hidden = true;
  }

  const slider = $("vol");
  if (document.activeElement !== slider) {
    slider.value = String(Math.round(s.volume_system));
    $("vol-label").textContent = Math.round(s.volume_system) + "%";
  }
}

async function refresh() {
  try {
    render(await window.pywebview.api.get_status());
  } catch (e) {
    /* pywebview ещё не готов */
  }
}

async function loadQr() {
  try {
    const svg = await window.pywebview.api.get_qr_svg();
    $("qr").innerHTML = svg;
    const s = await window.pywebview.api.get_status();
    $("conn-info").textContent = s.host + ":" + s.port + " · токен " + s.token;
  } catch (e) {
    $("conn-info").textContent = String(e);
  }
}

function initVolume() {
  const slider = $("vol");
  slider.addEventListener("input", async () => {
    $("vol-label").textContent = slider.value + "%";
    try {
      const real = await window.pywebview.api.set_system_volume(Number(slider.value));
      $("vol-label").textContent = Math.round(real) + "%";
    } catch (e) { /* noop */ }
  });
}

$("btn-token").addEventListener("click", async () => {
  await window.pywebview.api.regenerate_token();
  await loadQr();
  await refresh();
});

window.addEventListener("pywebviewready", () => {
  initVolume();
  loadQr();
  refresh();
  setInterval(refresh, 1000);
});
