/**
 * SoundCloud Remote — background service worker (MV3).
 *
 * Держит WebSocket до ПК-моста (ws://127.0.0.1:8765/ws), передаёт команды
 * моста во вкладку SoundCloud (content script) и события состояния — обратно.
 * Протокол — ../PROTOCOL.md (SCR-1), роль "extension".
 */
/* global chrome, WebSocket */

const DEFAULT_SETTINGS = { bridgeUrl: 'ws://127.0.0.1:8765/ws' };
const PING_INTERVAL_MS = 20000;
const BACKOFF_MAX_MS = 30000;
const COMMAND_TYPES = new Set([
  'play', 'pause', 'toggle', 'next', 'prev',
  'seek', 'volume', 'like', 'repeat', 'shuffle',
]);

const state = {
  ws: null,
  bridgeUrl: DEFAULT_SETTINGS.bridgeUrl,
  connected: false,     // WebSocket до моста
  welcome: null,        // ответ моста на hello
  backoffMs: 1000,
  reconnectTimer: null,
  pingTimer: null,
  lastError: null,

  extConnected: false,  // живая вкладка SoundCloud с content script
  scTabId: null,
  caps: [],
  lastState: null,
};

// ---------------------------------------------------------------- helpers

function wsSend(obj) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    try { state.ws.send(JSON.stringify(obj)); } catch (e) { /* соединение умерло */ }
  }
}

function broadcastStatus() {
  try {
    const p = chrome.runtime.sendMessage({ event: 'status', data: statusSnapshot() });
    if (p && p.catch) p.catch(() => { /* popup может быть закрыт */ });
  } catch (e) { /* noop */ }
}

function statusSnapshot() {
  return {
    connected: state.connected,
    url: state.bridgeUrl,
    welcome: state.welcome
      ? { device: state.welcome.device, bridge_version: state.welcome.bridge_version, caps: state.welcome.caps }
      : null,
    extConnected: state.extConnected,
    caps: state.caps,
    lastState: state.lastState,
    lastError: state.lastError,
    version: chrome.runtime.getManifest().version,
  };
}

// -------------------------------------------------------------- connection

function connect() {
  if (state.ws &&
      (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  chrome.storage.sync.get(DEFAULT_SETTINGS).then((s) => {
    state.bridgeUrl = s.bridgeUrl;
    let ws;
    try {
      ws = new WebSocket(s.bridgeUrl);
    } catch (e) {
      state.lastError = 'неверный URL: ' + s.bridgeUrl;
      scheduleReconnect();
      return;
    }
    state.ws = ws;
    ws.onopen = () => { onOpen(); };
    ws.onmessage = (ev) => { onBridgeMessage(ev); };
    ws.onclose = () => { onDown('closed'); };
    ws.onerror = () => { onDown('error'); };
  });
}

function scheduleReconnect() {
  if (state.reconnectTimer) return;
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connect();
  }, state.backoffMs);
  state.backoffMs = Math.min(state.backoffMs * 2, BACKOFF_MAX_MS);
}

function reconnectNow() {
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  state.backoffMs = 1000;
  if (state.ws) {
    try { state.ws.close(); } catch (e) { /* noop */ }
    state.ws = null;
  }
  state.connected = false;
  connect();
}

async function onOpen() {
  state.connected = true;
  state.backoffMs = 1000;
  state.lastError = null;

  const info = await askContent({ t: '__hello_info' }).catch(() => null);
  if (info && info.ok) {
    state.caps = info.caps || [];
    state.lastState = info.state || null;
    state.extConnected = true;
  }

  wsSend({
    t: 'hello',
    role: 'extension',
    proto: 1,
    ext: 'chrome',
    version: chrome.runtime.getManifest().version,
    caps: state.caps,
  });
  if (state.lastState) wsSend({ t: 'state', ext_connected: true, ...state.lastState });

  startPing();
  broadcastStatus();
}

function onDown(reason) {
  stopPing();
  const wasOpen = state.connected;
  state.connected = false;
  state.ws = null;
  state.lastError = reason;
  if (wasOpen) broadcastStatus();
  scheduleReconnect();
}

function startPing() {
  stopPing();
  state.pingTimer = setInterval(() => wsSend({ t: 'ping' }), PING_INTERVAL_MS);
}

function stopPing() {
  if (state.pingTimer) {
    clearInterval(state.pingTimer);
    state.pingTimer = null;
  }
}

// ------------------------------------------------------------ content-side

async function findScTab() {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: ['*://soundcloud.com/*', '*://*.soundcloud.com/*'] });
  } catch (e) { /* нет прав/нет вкладок */ }
  if (!tabs.length) {
    state.extConnected = false;
    state.scTabId = null;
    return null;
  }
  const tab = tabs.find((t) => t.audible) || tabs[0];
  state.scTabId = tab.id;
  state.extConnected = true;
  return tab;
}

async function askContent(msg) {
  const tab = await findScTab();
  if (!tab) return { ok: false, code: 'unavailable', message: 'вкладка SoundCloud не найдена' };
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, msg);
    return resp || { ok: true };
  } catch (e) {
    // content script может отсутствовать (вкладка открыта до установки
    // расширения) — переинжектим и пробуем ещё раз
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/selectors.js', 'content/content.js'],
      });
      await new Promise((r) => setTimeout(r, 150));
      const resp = await chrome.tabs.sendMessage(tab.id, msg);
      return resp || { ok: true };
    } catch (e2) {
      return { ok: false, code: 'unavailable', message: String((e2 && e2.message) || e2) };
    }
  }
}

// ------------------------------------------------------------------ bridge

async function onBridgeMessage(ev) {
  let msg;
  try { msg = JSON.parse(ev.data); } catch (e) {
    return wsSend({ t: 'error', code: 'bad_message', message: 'invalid json' });
  }

  switch (msg.t) {
    case 'welcome':
      state.welcome = msg;
      broadcastStatus();
      return;

    case 'pong':
      return;

    case 'ping':
      return wsSend({ t: 'pong' });

    case 'sync': {
      const info = await askContent({ t: '__hello_info' }).catch(() => null);
      if (info && info.ok) {
        state.caps = info.caps || state.caps;
        state.lastState = info.state || state.lastState;
        state.extConnected = true;
        wsSend({ t: 'state', ext_connected: true, ...info.state });
      } else {
        state.extConnected = false;
        wsSend({ t: 'ext', connected: false });
      }
      return;
    }

    default:
      break;
  }

  if (COMMAND_TYPES.has(msg.t)) {
    if (msg.t === 'volume' && msg.target === 'system') {
      // системную громкость исполняет сам мост, расширению она не приходит
      return wsSend({ t: 'error', id: msg.id, code: 'unsupported', message: 'system volume исполняет мост' });
    }
    const resp = await askContent(msg);
    if (msg.id == null) return;
    if (resp && resp.ok) {
      const { ok, ...rest } = resp;
      wsSend({ t: 'ack', id: msg.id, ...rest });
    } else {
      wsSend({
        t: 'error',
        id: msg.id,
        code: (resp && resp.code) || 'internal',
        message: (resp && resp.message) || '',
      });
    }
    return;
  }

  wsSend({ t: 'error', id: msg.id, code: 'bad_message', message: 'неизвестный t: ' + msg.t });
}

// ------------------------------------------------------------- event wiring

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  // запросы от popup / options
  if (msg.cmd === '__status') {
    sendResponse(statusSnapshot());
    return;
  }
  if (msg.cmd === '__reconnect') {
    reconnectNow();
    sendResponse({ ok: true });
    return;
  }
  if (msg.cmd === '__debug') {
    askContent({ t: '__debug_snapshot' }).then(sendResponse);
    return;
  }

  // события от content script
  if (sender.tab && sender.tab.id != null) {
    if (msg.event === 'state') {
      state.lastState = msg.data || null;
      state.extConnected = true;
      wsSend({ t: 'state', ext_connected: true, ...(msg.data || {}) });
    } else if (msg.event === 'tick') {
      const d = msg.data || {};
      wsSend({ t: 'tick', ...d });
      // держим кэш свежим: попап и повторный hello опираются на lastState
      if (state.lastState) {
        if (Number.isFinite(d.position_ms)) state.lastState.position_ms = d.position_ms;
        if (typeof d.playing === 'boolean') state.lastState.playing = d.playing;
        if (Number.isFinite(d.volume_player)) state.lastState.volume_player = d.volume_player;
      }
    } else if (msg.event === 'caps') {
      state.caps = msg.data || [];
      wsSend({ t: 'caps', caps: state.caps });
    } else if (msg.event === 'ext') {
      state.extConnected = !!(msg.data && msg.data.connected !== false);
      wsSend({ t: 'ext', connected: state.extConnected });
    }
    sendResponse({ ok: true });
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (tabId !== state.scTabId) return;
  const tab = await findScTab();
  if (!tab) {
    state.lastState = null;
    wsSend({ t: 'ext', connected: false });
    broadcastStatus();
  }
});

// страховка от засыпания service worker'а: ping по будильнику
chrome.alarms.create('scr-keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'scr-keepalive') return;
  if (state.connected) wsSend({ t: 'ping' });
  else connect();
});

chrome.runtime.onInstalled.addListener((details) => {
  connect();
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(() => connect());

connect();
