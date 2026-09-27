/**
 * SoundCloud Remote — content script.
 *
 * Читает состояние плеера и выполняет команды моста (протокол SCR-1, ../PROTOCOL.md).
 * Селекторы/приёмы портированы из рабочего оверлея (soundcloud-overlay-main):
 *  - кнопки SC игнорируют el.click() — нужен полный pointer-цикл с координатами;
 *  - время: aria-valuenow/aria-valuemax на .playbackTimeline__progressWrapper (секунды);
 *  - title: .playbackSoundBadge__title aria-label со схлопыванием дублей;
 *  - обложка: background-image на span внутри .playbackSoundBadge__avatar;
 *  - repeat: классы m-none/m-one/m-all; лайк: sc-button-selected/m-active.
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
  const RECHECK_MS = 3000;     // переискать панель плеера
  const DEBOUNCE_MS = 120;     // антидребезг пересчёта state
  const SETTLE_MS = 200;       // пауза после клика, пока DOM обновится
  const REPEAT_MAX_CLICKS = 4; // максимум докликов до нужного режима повтора

  let lastFullKey = '';
  let lastTickKey = '';
  let fullTimer = null;
  let observer = null;
  let posSource = '—'; // 'aria' | 'text' | 'media' — для диагностики

  // ---------------------------------------------------------------- utils

  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const first = (list, root) => SEL.firstMatch(list, root);

  function playerRoot() { return first(SEL.SELECTORS.playerControls); }

  /**
   * Поиск элемента НИЖНЕЙ панели плеера (.playControls).
   * На страницах треков есть и другие плееры (большой встроенный плеер
   * страницы, related tracks) со своими таймлайнами и кнопками — они стоят
   * раньше в DOM и всегда «на нуле». Сначала ищем строго в панели,
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

  // -------------------------------------------- настоящий клик (как юзер)

  /**
   * SoundCloud игнорирует el.click() на кнопках плеера — реагирует только
   * на полную последовательность pointer/mouse событий с координатами.
   * Если элемент не в layout — фолбэк на el.click().
   */
  function realClick(el) {
    if (!el) return false;
    let target = el;
    if (target.tagName !== 'BUTTON' && target.tagName !== 'A') {
      const inner = target.querySelector('button, a');
      if (inner) target = inner;
    }
    const r = target.getBoundingClientRect();
    if (!r || !r.width || !r.height) {
      try { target.click(); } catch (e) { /* noop */ }
      return true;
    }
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const o = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, view: window };
    target.dispatchEvent(new MouseEvent('pointerdown', o));
    target.dispatchEvent(new MouseEvent('mousedown', o));
    target.dispatchEvent(new MouseEvent('pointerup', o));
    target.dispatchEvent(new MouseEvent('mouseup', o));
    target.dispatchEvent(new MouseEvent('click', o));
    return true;
  }

  // ---------------------------------------------------------- media element

  let mediaEl = null;

  function getMedia() {
    if (mediaEl && mediaEl.isConnected && !mediaEl.paused) return mediaEl;
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
    const cl = btn.classList;
    return cl.contains('sc-button-selected') || cl.contains('m-active');
  }

  /** Режим повтора: SC маркирует .repeatControl классами m-none/m-one/m-all. */
  function readRepeat(btn) {
    if (!btn) return null;
    const cl = btn.classList;
    if (cl.contains('m-one')) return 'one';
    if (cl.contains('m-all')) return 'all';
    if (matchesAny(btn, SEL.SELECTORS.repeatOne)) return 'one';
    if (matchesAny(btn, SEL.SELECTORS.repeatPressed)) return 'all';
    if (cl.contains('sc-button-selected') || cl.contains('m-active') ||
        cl.contains('repeatControl--active')) return 'all';
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
    const cl = btn.classList;
    return cl.contains('sc-button-selected') || cl.contains('m-active');
  }

  /** Полное название: aria-label/.playbackSoundBadge__title со схлопыванием дублей. */
  function extractTitle(link) {
    if (!link) return '';
    let raw = link.getAttribute('aria-label') || norm(link.textContent);
    raw = norm(raw);
    raw = raw.replace(/^Current track\s*:/i, '').trim();
    // SC дублирует строку целиком: "FooFoo" = "Foo"+"Foo". Схлопываем только
    // точные половины, иначе реальные треки ("Лето Лето") склеятся неверно.
    const half = Math.floor(raw.length / 2);
    if (half >= 3 && raw.length % 2 === 0) {
      const a = raw.slice(0, half);
      const b = raw.slice(half);
      if (a === b) raw = a;
    }
    return raw;
  }

  function extractArtist() {
    const el = pfirst(SEL.SELECTORS.artist);
    return el ? norm(el.textContent) : '';
  }

  /** Обложка: background-image на span внутри аватара бейджа (как в оверлее). */
  function extractArtwork() {
    const avatar = first(SEL.SELECTORS.artworkAvatar);
    if (!avatar) return null;
    const holder = avatar.querySelector('span[style*="background-image"]')
      || avatar.querySelector('[style*="background-image"]');
    let raw = '';
    if (holder) {
      const st = holder.getAttribute('style') || '';
      const m = st.match(/url\(["']?(https?:[^)"']+)["']?\)/);
      raw = m ? m[1] : '';
    }
    if (!raw) {
      const img = avatar.querySelector('img');
      if (img && img.src) raw = img.src;
    }
    if (!raw) return null;
    for (const token of SEL.ARTWORK_UPGRADE.from) {
      if (raw.includes(token)) { raw = raw.replace(token, SEL.ARTWORK_UPGRADE.to); break; }
    }
    return raw;
  }

  function absoluteUrl(link) {
    if (!link) return null;
    try { return new URL(link.getAttribute('href') || '', location.origin).href; }
    catch (e) { return null; }
  }

  // ----------------------------------------------- время: 3 источника

  /**
   * 1) aria-valuenow/aria-valuemax на .playbackTimeline__progressWrapper (секунды)
   * 2) текстовые таймеры плеера
   * 3) медиа-элемент
   */
  function readTime() {
    const wrap = pfirst(SEL.SELECTORS.timelineProgress);
    if (wrap) {
      const now = Number(wrap.getAttribute('aria-valuenow'));
      const max = Number(wrap.getAttribute('aria-valuemax'));
      if (Number.isFinite(max) && max > 0) {
        posSource = 'aria';
        return {
          position_ms: Math.round((Number.isFinite(now) ? now : 0) * 1000),
          duration_ms: Math.round(max * 1000),
        };
      }
    }

    const times = [];
    document.querySelectorAll(
      '.playbackTimeline__timePassed, .playbackTimeline__timeLeft, ' +
      '.playbackTimeline__duration, .playbackTimeline [class*="time"]'
    ).forEach((el) => {
      const m = norm(el.textContent).match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
      if (m) {
        const h = m[1] ? parseInt(m[1], 10) : 0;
        times.push((h * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10)));
      }
    });
    if (times.length >= 2) {
      posSource = 'text';
      const second = times[times.length - 1];
      return {
        position_ms: times[0] * 1000,
        duration_ms: (second > times[0] ? second : times[0] + second) * 1000,
      };
    }

    const media = getMedia();
    if (media && Number.isFinite(media.duration) && media.duration > 0) {
      posSource = 'media';
      return {
        position_ms: Math.round((media.currentTime || 0) * 1000),
        duration_ms: Math.round(media.duration * 1000),
      };
    }

    posSource = 'none';
    return { position_ms: 0, duration_ms: 0 };
  }

  /** Громкость плеера: aria на .volume__sliderWrapper (0..1), фолбэк — media.volume. */
  function readPlayerVolume() {
    const wrap = pfirst(SEL.SELECTORS.volumeSliderWrap);
    if (wrap) {
      const va = Number(wrap.getAttribute('aria-valuenow'));
      const vm = Number(wrap.getAttribute('aria-valuemax')) || 1;
      if (Number.isFinite(va) && vm > 0) {
        return Math.round(clamp(va / vm, 0, 1) * 100);
      }
    }
    const media = getMedia();
    if (media) return Math.round(clamp(media.volume, 0, 1) * 100);
    return null;
  }

  function computeState() {
    const t = readTime();
    const title = extractTitle(pfirst(SEL.SELECTORS.playerTitle) ||
                               pfirst(SEL.SELECTORS.title));
    const artist = extractArtist();
    const track = (title || artist)
      ? {
          title: title || artist,
          artist,
          artwork: extractArtwork(),
          liked: readLiked(pfirst(SEL.SELECTORS.likeButton)),
          url: absoluteUrl(pfirst(SEL.SELECTORS.title)),
        }
      : null;

    return {
      playing: isPlaying(),
      position_ms: t.position_ms,
      duration_ms: t.duration_ms,
      volume_player: readPlayerVolume(),
      repeat: readRepeat(pfirst(SEL.SELECTORS.repeatButton)),
      shuffle: findShuffleButton() ? readShuffle(findShuffleButton()) : null,
      track,
    };
  }

  function computeCaps() {
    const caps = [];
    if (pfirst(SEL.SELECTORS.title)) caps.push('metadata');
    if (pfirst(SEL.SELECTORS.timelineProgress) || getMedia()) {
      caps.push('position', 'seek', 'player_volume');
    }
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
    const playing = isPlaying();
    const t = readTime();
    const data = {
      position_ms: t.position_ms,
      playing,
      volume_player: readPlayerVolume(),
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
      attributeFilter: ['class', 'style', 'title', 'aria-label', 'aria-checked', 'aria-pressed', 'aria-valuenow', 'aria-valuemax'],
    };
    const panel = first(SEL.SELECTORS.playerControls);
    const queue = first(SEL.SELECTORS.queuePanel);
    if (panel) observer.observe(panel, opts);
    if (queue) observer.observe(queue, opts);
    if (!panel && !queue && document.body) observer.observe(document.body, opts);
  }

  // -------------------------------------------------------------- commands

  /** Seek: клик по полосе в нужной пропорции (как в оверлее). */
  function doSeek(ms, sendResponse) {
    const wrap = pfirst(SEL.SELECTORS.timelineProgress);
    const rect = wrap && wrap.getBoundingClientRect();
    if (wrap && rect && rect.width) {
      const max = Number(wrap.getAttribute('aria-valuemax')) || 0;
      if (max > 0) {
        const ratio = clamp(ms / 1000 / max, 0, 1);
        const x = rect.left + rect.width * ratio;
        const y = rect.top + rect.height / 2;
        const o = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, view: window };
        wrap.dispatchEvent(new MouseEvent('pointerdown', o));
        wrap.dispatchEvent(new MouseEvent('mousedown', o));
        wrap.dispatchEvent(new MouseEvent('pointerup', o));
        wrap.dispatchEvent(new MouseEvent('mouseup', o));
        wrap.dispatchEvent(new MouseEvent('click', o));
        setTimeout(() => {
          pushFull(true);
          const t = readTime();
          sendResponse({ ok: true, position_ms: t.position_ms });
        }, SETTLE_MS);
        return;
      }
    }
    // фолбэк: прямой currentTime у медиа-элемента
    const media = getMedia();
    if (!media) return sendResponse({ ok: false, code: 'unavailable', message: 'полоса и медиа не найдены' });
    const durMs = Number.isFinite(media.duration) ? media.duration * 1000 : null;
    media.currentTime = (durMs ? clamp(Number(ms) || 0, 0, durMs) : Math.max(0, Number(ms) || 0)) / 1000;
    setTimeout(() => {
      pushFull(true);
      sendResponse({ ok: true, position_ms: Math.round((media.currentTime || 0) * 1000) });
    }, 80);
  }

  /** Громкость плеера: клик по слайдеру громкости в нужной пропорции. */
  function doVolume(value, sendResponse) {
    const target = clamp(Number(value) || 0, 0, 100);
    const wrap = pfirst(SEL.SELECTORS.volumeSliderWrap);
    const rect = wrap && wrap.getBoundingClientRect();
    if (wrap && rect && rect.width) {
      const ratio = target / 100;
      const x = rect.left + rect.width * ratio;
      const y = rect.top + rect.height / 2;
      const o = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, view: window };
      wrap.dispatchEvent(new MouseEvent('pointerdown', o));
      wrap.dispatchEvent(new MouseEvent('mousedown', o));
      wrap.dispatchEvent(new MouseEvent('pointerup', o));
      wrap.dispatchEvent(new MouseEvent('mouseup', o));
      wrap.dispatchEvent(new MouseEvent('click', o));
      setTimeout(() => sendResponse({ ok: true, volume_player: readPlayerVolume() }), SETTLE_MS);
      return;
    }
    const media = getMedia();
    if (!media) return sendResponse({ ok: false, code: 'unavailable', message: 'медиа-элемент не найден' });
    media.volume = target / 100;
    setTimeout(() => sendResponse({ ok: true, volume_player: Math.round(media.volume * 100) }), 80);
  }

  function doLike(on, sendResponse) {
    const btn = pfirst(SEL.SELECTORS.likeButton);
    if (!btn) return sendResponse({ ok: false, code: 'unavailable', message: 'кнопка лайка не найдена' });
    const cur = readLiked(btn);
    if ((on === true || on === false) && cur === on) {
      return sendResponse({ ok: true, liked: cur });
    }
    realClick(btn);
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
      realClick(btn);
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
        realClick(queueToggle);
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
    if (!((on === true || on === false) && cur === on)) realClick(btn);
    await sleep(SETTLE_MS);
    const result = readShuffle(findShuffleButton());
    if (openedQueue) closeQueue();
    pushFull(true);
    sendResponse({ ok: true, shuffle: result });
  }

  function closeQueue() {
    const queueToggle = pfirst(SEL.SELECTORS.queueToggle);
    if (queueToggle) realClick(queueToggle);
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
      posSource,
      time: readTime(),
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

  function clickPlay(target, sendResponse) {
    const btn = pfirst(SEL.SELECTORS.playButton);
    if (!btn) return sendResponse({ ok: false, code: 'unavailable', message: 'кнопка play не найдена' });
    if (isPlaying() !== target) realClick(btn);
    setTimeout(() => { pushFull(true); sendResponse({ ok: true, playing: isPlaying() }); }, SETTLE_MS);
  }

  function clickSimple(list, sendResponse) {
    const el = pfirst(list);
    if (!el) return sendResponse({ ok: false, code: 'unavailable', message: 'элемент не найден' });
    realClick(el);
    setTimeout(() => { pushFull(true); sendResponse({ ok: true }); }, SETTLE_MS);
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
