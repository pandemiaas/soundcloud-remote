/* SoundCloud Remote — popup: показывает статус моста и вкладки SoundCloud. */
/* global chrome */
'use strict';

const $ = (id) => document.getElementById(id);

function fmtTime(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}

function render(st) {
  const bridge = $('dot-bridge');
  bridge.className = 'dot ' + (st.connected ? 'on' : 'off');
  $('bridge-text').textContent = st.connected
    ? 'Мост: подключен' + (st.welcome && st.welcome.device ? ' (' + st.welcome.device + ')' : '')
    : 'Мост: нет соединения';

  const sc = $('dot-sc');
  sc.className = 'dot ' + (st.extConnected ? 'on' : 'off');
  $('sc-text').textContent = st.extConnected
    ? 'SoundCloud: вкладка найдена'
    : 'SoundCloud: вкладка не открыта';

  const track = st.lastState && st.lastState.track;
  if (track) {
    $('track').hidden = false;
    $('t-title').textContent = track.title || '—';
    $('t-artist').textContent = track.artist || '—';
    const s = st.lastState;
    $('t-pos').textContent =
      fmtTime(s.position_ms) + ' / ' + fmtTime(s.duration_ms) +
      (s.playing ? '  ▶' : '  ⏸');
  } else {
    $('track').hidden = true;
  }

  const err = $('err');
  if (st.lastError && !st.connected) {
    err.hidden = false;
    err.textContent = 'Мост: ' + st.url + ' — ' + st.lastError;
  } else {
    err.hidden = true;
  }
}

function refresh() {
  try {
    chrome.runtime.sendMessage({ cmd: '__status' }, (st) => {
      if (chrome.runtime.lastError) return;
      if (st) render(st);
    });
  } catch (e) { /* noop */ }
}

$('btn-open').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://soundcloud.com/' });
  window.close();
});

$('btn-options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

$('btn-debug').addEventListener('click', () => {
  const box = $('debug');
  if (!box.hidden) { box.hidden = true; return; }
  box.hidden = false;
  box.textContent = 'Считываю…';
  chrome.runtime.sendMessage({ cmd: '__debug' }, (resp) => {
    if (chrome.runtime.lastError || !resp || !resp.ok) {
      box.textContent = 'Нет ответа от вкладки SoundCloud';
      return;
    }
    const s = resp.snapshot;
    const found = Object.entries(s.found)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(', ');
    const media = s.media
      ? s.media.tag +
        ' pos=' + Math.round(s.media.pos || 0) + 's' +
        ' dur=' + Math.round(s.media.duration || 0) + 'c' +
        (s.media.paused ? ' [пауза]' : ' [играет]') +
        ' src=' + (s.media.src || '—')
      : 'НЕ НАЙДЕН (время из полосы)';
    const t = s.time || {};
    box.textContent =
      'время: pos=' + Math.round((t.position_ms || 0) / 1000) + 's / dur=' +
        Math.round((t.duration_ms || 0) / 1000) + 's, источник=' + (s.posSource || '—') +
        ', панель=' + (s.playerRoot ? 'ok' : 'НЕТ') + '\n' +
      'медиа: ' + media + '\n' +
      'селекторы: ' + (found || 'ничего') + '\n' +
      'название: ' + (s.state && s.state.track ? s.state.track.title : '—');
  });
});

refresh();
setInterval(refresh, 1500);
