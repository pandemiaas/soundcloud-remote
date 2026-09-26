import { invoke } from "@tauri-apps/api/core";

interface TrackInfo {
  title: string;
  artist: string;
  artwork: string | null;
  liked: boolean | null;
  url: string | null;
}

interface BridgeStatus {
  listening: boolean;
  port: number;
  token: string;
  device: string;
  host: string;
  ext_connected: boolean;
  remote_connected: boolean;
  ext_caps: string[];
  volume_system: number;
  bridge_version: string;
  track: (TrackInfo & {
    playing: boolean;
    position_ms: number;
    duration_ms: number;
    volume_player: number | null;
  }) | null;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

function fmtTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function render(s: BridgeStatus): void {
  $("version").textContent = "мост v" + s.bridge_version;

  $("dot-listen").className = "dot " + (s.listening ? "on" : "off");
  $("listen-text").textContent = s.listening
    ? `Сервер: ws://${s.host}:${s.port}/ws`
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
      `${track.playing ? "▶" : "⏸"} ${fmtTime(track.position_ms)} / ${fmtTime(track.duration_ms)}`;
    $("t-vol").textContent = track.volume_player != null ? track.volume_player + "%" : "—";
  } else {
    card.hidden = true;
  }

  // Слайдер системной громкости — не дёргаем, пока пользователь тащит ползунок
  const slider = $("vol") as HTMLInputElement;
  if (document.activeElement !== slider) {
    slider.value = String(Math.round(s.volume_system));
    $("vol-label").textContent = Math.round(s.volume_system) + "%";
  }
}

async function refresh(): Promise<void> {
  try {
    render(await invoke<BridgeStatus>("get_bridge_status"));
  } catch {
    /* окно может опрашивать до старта бэкенда */
  }
}

async function loadQr(): Promise<void> {
  try {
    const svg = await invoke<string>("get_qr_svg");
    $("qr").innerHTML = svg;
    const s = await invoke<BridgeStatus>("get_bridge_status");
    $("conn-info").textContent = `${s.host}:${s.port} · токен ${s.token}`;
  } catch (e) {
    $("conn-info").textContent = String(e);
  }
}

async function initVolume(): Promise<void> {
  const slider = $("vol") as HTMLInputElement;
  let dragging = false;
  slider.addEventListener("pointerdown", () => { dragging = true; });
  slider.addEventListener("pointerup", () => { dragging = false; });
  slider.addEventListener("input", async () => {
    $("vol-label").textContent = slider.value + "%";
    try {
      const real = await invoke<number>("set_system_volume", { v: Number(slider.value) });
      $("vol-label").textContent = Math.round(real) + "%";
    } catch { /* noop */ }
  });
  // флаг dragging используется в refresh() через activeElement — оставляем простым
  void dragging;
}

$("btn-token").addEventListener("click", async () => {
  await invoke("regenerate_token");
  await loadQr();
  await refresh();
});

initVolume();
loadQr();
refresh();
setInterval(refresh, 1000);
