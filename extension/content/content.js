/**
 * SoundCloud Remote — content script.
 *
 * Живёт во вкладке soundcloud.com:
 *  - читает состояние плеера из DOM и медиа-элемента;
 *  - выполняет команды от моста (приходят через background service worker);
 *  - шлёт события state/tick/caps в service worker.
 *
 * Протокол сообщений — ../PROTOCOL.md (SCR-1). Селекторы — только в selectors.js.
 */
/* global chrome */
(function () {
  'use strict';

  if (window.__SCR_CONTENT_INJECTED) return;
  window.__SCR_CONTENT_INJECTED = true;

  const SEL = window.__SCR_SELECTORS;
  if (!SEL) {
    console.error('[SC Remote] selectors.js не загружен');
    return;
  }

  const TICK_MS = 1000;        // период tick-событий
  const RECHECK_MS = 3000;     // переискать панель/медиа-элемент
  const DEBOUNCE_MS = 120;     // антидребезг пересчёта state
  const SETTLE_MS = 200;       // пауза после клика, пока DOM обновится
  const REPEAT_MAX_CLICKS = 4; // максимум докликов до нужного режима повтора

  let mediaEl = null;
  let lastFullKey = '';
  let lastTickKey = '';
  let fullTimer = null;
  let observer = null;

  // Детектор «застрявшего» медиа-элемента: позиция не растёт при игре
  let lastMediaPos = -1;
  let stallCount = 0;
  let posSource = '—'; // 'media' | 'dom' | 'dom-stall' — для диагностики

  // ---------------------------------------------------------------- utils

  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const first = (list, root) => SEL.firstMatch(list, root);

  function playerRoot() { return first(SEL.SELECTORS.playerControls); }

  /**
   * Поиск элемента НИЖНЕЙ панели плеера (.playControls).
   * На страницах треков есть и другие плееры (большой встроенный плеер
   * страницы, related tracks) со своими таймлайнами и кнопками — они
   * стоят раньше в DOM и всегда «на нуле». Сначала ищем строго в панели,
   * и только потом — по всей странице.
   */
  function pfirst(list) {
    const root = playerRoot();
    if (root) {
      const el = SEL.firstMatch(list, root);
      if (el) return el;
    }
    return first(list);
  }

  const matchesAny = (el, list) => {
    if (!el) return false;
    for (const sel of list) {
      try { if (el.matches(sel)) return true; } catch (e) { /* noop */ }
    }
    return false;
  };

  function parseTime(text) {
    // «0:00», «1:02:03», а также «Total: 3:02» и подобные подписи
    const m = norm(text).match(/(?:(\d+):)?(\d{1,2}):(\d{2})/);
    if (!m) return 0;
    const h = m[1] ? parseInt(m[1], 10) : 0;
    return (h * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10)) * 1000;
  }

  function sendToSw(msg) {
    try {
      const p = chrome.runtime.sendMessage(msg);
      if (p && p.catch) p.catch(() => { /* popup закрыт — не страшно */ });
    } catch (e) { /* контекст может быть недоступен при выгрузке */ }
  }

  // ---------------------------------------------------------- media element

  function getMedia() {
    if (mediaEl && mediaEl.isConnected && !mediaEl.paused) return mediaEl;
    // Плеер SoundCloud — <video>, но на странице бывают и другие медиа-элементы.
    // Выбираем самый «живой»: играет > есть позиция > есть длительность.
    let best = null;
    let bestScore = -1;
    document.querySelectorAll('video, audio').forEach((el) => {
      const score = (el.paused ? 0 : 4) + (el.currentTime > 0 ? 2 : 0) + (el.duration > 0 ? 1 : 0);
      if (score > bestScore) { best = el; bestScore = score; }
    });
    if (!best && mediaEl && mediaEl.isConnected) best = mediaEl;
    mediaEl = best;
    if (mediaEl) attachMedia(mediaEl);
    return mediaEl;
  }

  function attachMedia(el) {
    if (!el || el.__scrHooked) return;
    el.__scrHooked = true;
    for (const ev of ['play', 'pause', 'timeupdate', 'volumechange', 'durationchange', 'ended']) {
      el.addEventListener(ev, scheduleFull);
    }
  }

  // ------------------------------------------------------------ read state

  function isPlaying() {
    const btn = pfirst(SEL.SELECTORS.playButton);
    if (!btn) return false;
    return btn.classList.contains('playing') || matchesAny(btn, SEL.SELECTORS.playPressed);
  }

  function readLiked(btn) {
    if (!btn) return null;
    if (btn.getAttribute('aria-pressed') === 'true' || btn.getAttribute('aria-checked') === 'true') return true;
    if (btn.getAttribute('aria-pressed') === 'false' || btn.getAttribute('aria-checked') === 'false') return false;
    if (matchesAny(btn, SEL.SELECTORS.likePressed)) return true;
    if (btn.classList.contains('sc-button-selected')) return true;
    return false;
  }

  function readRepeat(btn) {
    if (!btn) return null;
    if (matchesAny(btn, SEL.SELECTORS.repeatOne)) return 'one';
    if (matchesAny(btn, SEL.SELECTORS.repeatPressed)) return 'all';
    const cl = btn.classList;
    if (cl.contains('repeatOne')) return 'one';
    if (cl.contains('repeat') || cl.contains('m-active') ||
        cl.contains('sc-button-selected') || cl.contains('repeatControl--active')) return 'all';
    const label = norm(btn.getAttribute('aria-label') || btn.title).toLowerCase();
    if (/one/.test(label)) return 'one';
    if (/off|выкл/.test(label)) return 'off';
    if (/repeat|повтор/.test(label)) return 'all';
    return 'off';
  }

  function findShuffleButton() {
    return pfirst(SEL.SELECTORS.shuffleButton);
  }

  function readShuffle(btn) {
    if (!btn) return null;
    if (btn.getAttribute('aria-pressed') === 'true' || btn.getAttribute('aria-checked') === 'true') return true;
    if (btn.getAttribute('aria-pressed') === 'false' || btn.getAttribute('aria-checked') === 'false') return false;
    if (matchesAny(btn, SEL.SELECTORS.shufflePressed)) return true;
    if (btn.classList.contains('sc-button-selected') || btn.classList.contains('m-active')) return true;
    return false;
  }

  function readShuffleCached() {
    const btn = findShuffleButton();
    const val = readShuffle(btn);
    return val; // null, если кнопка сейчас не в DOM (панель очереди закрыта)
  }

  function extractTitle(link) {
    if (!link) return '';
    // Внутри ссылки лежит чистое название; атрибут title — это "Artist - Title"
    const inner = link.querySelector(
      '.playbackSoundBadge__titleTextContainer, .title, .sc-truncate'
    );
    if (inner) {
      const t = norm(inner.textContent);
      if (t) return t;
    }
    const attr = link.getAttribute('title');
    if (attr && norm(attr)) return norm(attr);
    return norm(link.textContent);
  }

  function extractArtist() {
    const el = pfirst(SEL.SELECTORS.artist);
    return el ? norm(el.textContent) : '';
  }

  function extractArtwork() {
    const img = pfirst(SEL.SELECTORS.artwork);
    if (!img) return null;
    let raw = '';
    if (img.tagName === 'IMG' && img.src) raw = img.src;
    else if (img.style && img.style.backgroundImage) {
      const m = img.style.backgroundImage.match(/url\(["']?([^"']+)["']?\)/);
      raw = m ? m[1] : '';
    }
    if (!raw) return null;
    for (const token of SEL.ARTWORK_UPGRADE.from) {
      if (raw.includes(token)) { raw = raw.replace(token, SEL.ARTWORK_UPGRADE.to); break; }
    }
    return raw;
  }

  function timelineTimes() {
    // «0:53 … 2:49» из всего таймлайна: первый тайм — прошло, последний — длительность
    const tl = pfirst(SEL.SELECTORS.timeline);
    if (!tl) return null;
    const m = tl.textContent.match(/\d{1,2}:\d{2}/g);
    return m && m.length ? m : null;
  }

  function durationFromDom() {
    const el = pfirst(SEL.SELECTORS.timeDuration);
    if (el) {
      const v = parseTime(el.textContent);
      if (v > 0) return v;
    }
    const times = timelineTimes();
    if (times && times.length > 1) return parseTime(times[times.length - 1]);
    return 0;
  }

  function positionFromDom() {
    const el = pfirst(SEL.SELECTORS.timeElapsed);
    if (el) {
      const v = parseTime(el.textContent);
      if (v > 0) return v;
    }
    const times = timelineTimes();
    if (times) return parseTime(times[0]);
    return 0;
  }

  /**
   * Позиция с защитой от «декоративного» медиа-элемента: если воспроизведение
   * идёт, а currentTime элемента не меняется — читаем время из таймлайна DOM
   * и сбрасываем кэш, чтобы следующий тик выбрал другого кандидата.
   */
  function estimatePosition(media) {
    if (!media) { posSource = 'dom'; return positionFromDom(); }
    const pos = Math.round((media.currentTime || 0) * 1000);
    if (pos === lastMediaPos) stallCount += 1;
    else { stallCount = 0; lastMediaPos = pos; }
    if (isPlaying() && stallCount >= 3) {
      if (mediaEl === media) mediaEl = null;
      posSource = 'dom-stall';
      return positionFromDom();
    }
    posSource = 'media';
    return pos;
  }

  function estimateDuration(media) {
    if (media && Number.isFinite(media.duration) && media.duration > 0) {
      return Math.round(media.duration * 1000);
    }
    return durationFromDom();
  }

  function computeState() {
    const media = getMedia();
    const title = extractTitle(pfirst(SEL.SELECTORS.title));
    const artist = extractArtist();
    // SoundCloud часто даёт заголовок "Artist - Title" — убираем дубль исполнителя
    const cleanTitle = (artist && title.toLowerCase().startsWith(artist.toLowerCase() + ' - '))
      ? title.slice(artist.length + 3).trim()
      : title;
    const rawTitle = cleanTitle || artist;
    const track = rawTitle
      ? {
          title: cleanTitle || artist,
          artist: artist || '',
          artwork: extractArtwork(),
          liked: readLiked(pfirst(SEL.SELECTORS.likeButton)),
          url: absoluteUrl(pfirst(SEL.SELECTORS.title)),
        }
      : null;

    return {
      playing: isPlaying(),
      position_ms: estimatePosition(media),
      duration_ms: estimateDuration(media),
      volume_player: media ? Math.round(clamp(media.volume, 0, 1) * 100) : null,
      repeat: readRepeat(pfirst(SEL.SELECTORS.repeatButton)),
      shuffle: readShuffleCached(),
      track,
    };
  }

  function absoluteUrl(link) {
    if (!link) return null;
    try { return new URL(link.getAttribute('href') || '', location.origin).href; }
    catch (e) { return null; }
  }

  function computeCaps() {
    const caps = [];
    if (pfirst(SEL.SELECTORS.title)) caps.push('metadata');
    if (getMedia()) caps.push('position', 'seek', 'player_volume');
    if (pfirst(SEL.SELECTORS.playButton)) caps.push('play', 'toggle');
    if (pfirst(SEL.SELECTORS.nextButton) || pfirst(SEL.SELECTORS.prevButton)) caps.push('next');
    if (pfirst(SEL.SELECTORS.likeButton)) caps.push('like');
    if (pfirst(SEL.SELECTORS.repeatButton)) caps.push('repeat');
    caps.push('shuffle'); // кнопка может подниматься из панели очереди (queue-assist)
    return caps;
  }

  // ------------------------------------------------------------- push state

  function scheduleFull() {
    if (fullTimer) return;
    fullTimer = setTimeout(() => { fullTimer = null; pushFull(false); }, DEBOUNCE_MS);
  }

  function pushFull(force) {
    let st;
    try { st = computeState(); } catch (e) { return; }
    const key = JSON.stringify(st);
    if (!force && key === lastFullKey) return;
    lastFullKey = key;
    sendToSw({ event: 'state', data: st });
  }

  function pushTick() {
    const media = getMedia();
    const playing = isPlaying();
    const data = {
      position_ms: estimatePosition(media),
      playing,
      volume_player: media ? Math.round(clamp(media.volume, 0, 1) * 100) : null,
    };
    const key = JSON.stringify(data);
    if (key === lastTickKey) return;
    lastTickKey = key;
    sendToSw({ event: 'tick', data });
  }

  // ------------------------------------------------------------- observers

  function watchDom() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(scheduleFull);
    const opts = {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'title', 'aria-label', 'aria-checked', 'aria-pressed'],
    };
    // Наблюдаем и нижнюю панель, и панель очереди (там живёт shuffle);
    // если обе ещё не отрисовались — следим за всем документом.
    const panel = first(SEL.SELECTORS.playerControls);
    const queue = first(SEL.SELECTORS.queuePanel);
    if (panel) observer.observe(panel, opts);
    if (queue) observer.observe(queue, opts);
    if (!panel && !queue && document.body) observer.observe(document.body, opts);
  }

  // -------------------------------------------------------------- commands

  function clickPlay(target, sendResponse) {
    const btn = pfirst(SEL.SELECTORS.playButton);
    if (!btn) return sendResponse({ ok: false, code: 'unavailable', message: 'кнопка play не найдена' });
    if (isPlaying() !== target) btn.click();
    setTimeout(() => { pushFull(true); sendResponse({ ok: true, playing: isPlaying() }); }, SETTLE_MS);
  }

  function clickSimple(list, sendResponse) {
    const el = pfirst(list);
    if (!el) return sendResponse({ ok: false, code: 'unavailable', message: 'элемент не найден' });
    el.click();
    setTimeout(() => { pushFull(true); sendResponse({ ok: true }); }, SETTLE_MS);
  }

  function doSeek(ms, sendResponse) {
    const media = getMedia();
    if (!media) return sendResponse({ ok: false, code: 'unavailable', message: 'медиа-элемент не найден' });
    const durMs = Number.isFinite(media.duration) ? media.duration * 1000 : null;
    const target = durMs ? clamp(Number(ms) || 0, 0, durMs) : Math.max(0, Number(ms) || 0);
    media.currentTime = target / 1000;
    setTimeout(() => {
      pushFull(true);
      sendResponse({ ok: true, position_ms: Math.round((media.currentTime || 0) * 1000) });
    }, 80);
  }

  function doVolume(value, sendResponse) {
    const media = getMedia();
    if (!media) return sendResponse({ ok: false, code: 'unavailable', message: 'медиа-элемент не найден' });
    media.volume = clamp(Number(value) || 0, 0, 100) / 100;
    setTimeout(() => sendResponse({ ok: true, volume_player: Math.round(media.volume * 100) }), 80);
  }

  function doLike(on, sendResponse) {
    const btn = pfirst(SEL.SELECTORS.likeButton);
    if (!btn) return sendResponse({ ok: false, code: 'unavailable', message: 'кнопка лайка не найдена' });
    const cur = readLiked(btn);
    if ((on === true || on === false) && cur === on) {
      return sendResponse({ ok: true, liked: cur });
    }
    btn.click();
    setTimeout(() => {
      pushFull(true);
      sendResponse({ ok: true, liked: readLiked(pfirst(SEL.SELECTORS.likeButton)) });
    }, SETTLE_MS);
  }

  function doRepeat(mode, sendResponse) {
    if (mode !== 'off' && mode !== 'all' && mode !== 'one') {
      return sendResponse({ ok: false, code: 'bad_message', message: 'mode должен быть off|all|one' });
    }
    const btn = pfirst(SEL.SELECTORS.repeatButton);
    if (!btn) return sendResponse({ ok: false, code: 'unavailable', message: 'кнопка повтора не найдена' });
    let tries = 0;
    const step = () => {
      const cur = readRepeat(pfirst(SEL.SELECTORS.repeatButton));
      if (cur === mode || tries >= REPEAT_MAX_CLICKS) {
        pushFull(true);
        return sendResponse({ ok: cur === mode, repeat: cur });
      }
      tries += 1;
      btn.click();
      setTimeout(step, SETTLE_MS);
    };
    step();
  }

  async function doShuffle(on, sendResponse) {
    let btn = findShuffleButton();
    let openedQueue = false;
    if (!btn) {
      // queue-assist: кнопка shuffle часто живёт в панели очереди
      const queueToggle = pfirst(SEL.SELECTORS.queueToggle);
      if (queueToggle) {
        queueToggle.click();
        openedQueue = true;
        await sleep(350);
        btn = findShuffleButton();
      }
    }
    if (!btn) {
      if (openedQueue) closeQueue();
      return sendResponse({ ok: false, code: 'unavailable', message: 'кнопка shuffle не найдена' });
    }
    const cur = readShuffle(btn);
    if (!((on === true || on === false) && cur === on)) btn.click();
    await sleep(SETTLE_MS);
    const result = readShuffle(findShuffleButton());
    if (openedQueue) closeQueue();
    pushFull(true);
    sendResponse({ ok: true, shuffle: result });
  }

  function closeQueue() {
    const queueToggle = pfirst(SEL.SELECTORS.queueToggle);
    if (queueToggle) queueToggle.click();
  }

  function debugSnapshot() {
    const found = {};
    for (const name of Object.keys(SEL.SELECTORS)) {
      const list = SEL.SELECTORS[name];
      if (Array.isArray(list)) found[name] = pfirst(list) ? true : false;
    }
    const media = getMedia();
    return {
      selectorsVersion: SEL.version,
      url: location.href,
      playerRoot: !!playerRoot(),
      domPos: positionFromDom(),
      domDur: durationFromDom(),
      posSource,
      found,
      media: media ? {
        tag: media.tagName,
        duration: media.duration,
        volume: media.volume,
        pos: media.currentTime,
        paused: media.paused,
        src: String(media.currentSrc || media.src || '').slice(0, 60),
      } : null,
      state: computeState(),
      caps: computeCaps(),
    };
  }

  function handleCommand(msg, sendResponse) {
    switch (msg.t) {
      case 'play': return clickPlay(true, sendResponse);
      case 'pause': return clickPlay(false, sendResponse);
      case 'toggle': return clickSimple(SEL.SELECTORS.playButton, sendResponse);
      case 'next': return clickSimple(SEL.SELECTORS.nextButton, sendResponse);
      case 'prev': return clickSimple(SEL.SELECTORS.prevButton, sendResponse);
      case 'seek': return doSeek(msg.ms, sendResponse);
      case 'volume': return doVolume(msg.value, sendResponse);
      case 'like': return doLike(msg.on === undefined ? null : msg.on, sendResponse);
      case 'repeat': return doRepeat(msg.mode, sendResponse);
      case 'shuffle': return doShuffle(msg.on, sendResponse);
      case 'sync': {
        pushFull(true);
        return sendResponse({ ok: true });
      }
      case '__hello_info': {
        return sendResponse({ ok: true, caps: computeCaps(), state: computeState() });
      }
      case '__debug_snapshot': {
        return sendResponse({ ok: true, snapshot: debugSnapshot() });
      }
      default:
        return sendResponse({ ok: false, code: 'bad_message', message: 'неизвестный t: ' + msg.t });
    }
  }

  // ------------------------------------------------------------------ init

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    try {
      handleCommand(msg || {}, sendResponse);
    } catch (e) {
      try { sendResponse({ ok: false, code: 'internal', message: String(e) }); } catch (_) {}
    }
    return true; // ответ может прийти асинхронно
  });

  watchDom();
  getMedia();
  pushFull(true);
  sendToSw({ event: 'caps', data: computeCaps() });
  sendToSw({ event: 'ext', data: { connected: true } });

  setInterval(() => {
    try { pushTick(); pushFull(false); }
    catch (e) { console.error('[SC Remote] tick error:', e); }
  }, TICK_MS);
  setInterval(() => {
    try {
      if (!playerRoot()) watchDom(); // SPA: панель плеера пересоздаётся
      getMedia();
    } catch (e) { console.error('[SC Remote] recheck error:', e); }
  }, RECHECK_MS);

  console.info('[SC Remote] content script готов');
})();
