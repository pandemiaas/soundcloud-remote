/* SoundCloud Remote — страница настроек: адрес моста. */
/* global chrome */
'use strict';

const DEFAULT_URL = 'ws://127.0.0.1:8765/ws';
const input = document.getElementById('bridgeUrl');
const statusEl = document.getElementById('status');

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = cls || '';
}

chrome.storage.sync.get({ bridgeUrl: DEFAULT_URL }).then((s) => {
  input.value = s.bridgeUrl;
});

document.getElementById('save').addEventListener('click', async () => {
  const url = input.value.trim() || DEFAULT_URL;
  if (!/^wss?:\/\//.test(url)) {
    setStatus('Адрес должен начинаться с ws:// или wss://', 'bad');
    return;
  }
  await chrome.storage.sync.set({ bridgeUrl: url });
  input.value = url;
  setStatus('Сохранено. Переподключаюсь…', 'ok');
  chrome.runtime.sendMessage({ cmd: '__reconnect' }, () => {
    if (chrome.runtime.lastError) { /* noop */ }
  });
});

document.getElementById('test').addEventListener('click', () => {
  setStatus('Проверяю…');
  chrome.runtime.sendMessage({ cmd: '__reconnect' }, () => {
    if (chrome.runtime.lastError) { /* noop */ }
    setTimeout(() => {
      chrome.runtime.sendMessage({ cmd: '__status' }, (st) => {
        if (chrome.runtime.lastError || !st) {
          setStatus('Не удалось получить статус', 'bad');
          return;
        }
        if (st.connected) {
          const dev = st.welcome && st.welcome.device ? ' — ' + st.welcome.device : '';
          setStatus('Мост подключен' + dev, 'ok');
        } else {
          setStatus('Мост недоступен по адресу ' + st.url, 'bad');
        }
      });
    }, 1500);
  });
});
