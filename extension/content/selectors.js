/**
 * SoundCloud Remote — селекторы DOM (единственное место правок при смене разметки).
 *
 * Каждый селектор — СПИСОК кандидатов от более нового/надёжного к запасным.
 * runtime.querySelector пробует их по очереди. Никогда не пишите селектор
 * напрямую в content.js — добавляйте сюда.
 */
/* global window */
(function () {
  'use strict';

  const SELECTORS = {
    /** Кнопка play/pause (в одном месте панель плеера и mini-player). */
    playButton: [
      '.playControl',
      'button[aria-label="Play current"]',
      'button[aria-label="Pause current"]',
    ],

    /** Следующий трек. */
    nextButton: [
      '.playControls__next',
      'button[aria-label^="Next"]',
    ],

    /** Предыдущий трек. */
    prevButton: [
      '.playControls__prev',
      'button[aria-label^="Previous"]',
    ],

    /** Прогресс-бар (полоса). Диапазон читаем через aria-valuenow. */
    timeline: [
      '.playbackTimeline',
      'div[role="slider"][aria-label*="Playback"]',
      'div[role="slider"][aria-label*="timeline" i]',
    ],

    /** Какая кнопка активна (pressed) — признак "играет". */
    playPressed: [
      '.playControl[aria-label="Pause current"]',
      '.playing',
    ],

    /** Название трека (ссылка в панели плеера). */
    title: [
      '.playbackSoundBadge__titleLink',
      '.playbackSoundBadge a[title]',
      'a.soundTitle__title',
    ],

    /** Исполнитель (ссылка в панели плеера). */
    artist: [
      '.playbackSoundBadge__lightLink',
      '.playbackSoundBadge .soundTitle__username',
    ],

    /** Обложка текущего трека (img или span с background-image). */
    artwork: [
      '.playbackSoundBadge__titleLink + div img',
      '.playbackSoundBadge__avatar img',
      '.playbackSoundBadge span[role="img"] img',
      '.playbackSoundBadge span.sc-artwork',
      '.playbackSoundBadge span[style*="background-image"]',
      '.playbackSoundBadge img',
    ],

    /** Кнопка лайка текущего трека. */
    likeButton: [
      '.playbackSoundBadge__likeButton',
      '.playControls .likeButton',
      'button[aria-label^="Like"]',
      'button[aria-label^="Unlike"]',
    ],

    /** Признак залайканного трека (кнопка в состоянии pressed). */
    likePressed: [
      '.playbackSoundBadge__likeButton[aria-checked="true"]',
      '.playbackSoundBadge__likeButton[aria-pressed="true"]',
      '.likeButton.likeButton--active',
      '.likeButton--active',
    ],

    /** Кнопка повтора в панели плеера. */
    repeatButton: [
      '.playControls__repeat',
      'button[aria-label^="Repeat"]',
    ],

    /** Признак включённого повтора (+ режим one по второму классу/лейблу). */
    repeatPressed: [
      '.playControls__repeat.repeatControl--active',
      '.repeatControl--active',
    ],

    repeatOne: [
      '.playControls__repeat.repeatControl--one',
      '.repeatControl--one',
      'button[aria-label*="one" i][aria-label^="Repeat"]',
    ],

    /** Кнопка shuffle — часто живёт в панели очереди. */
    shuffleButton: [
      '.shuffleButton',
      '.playControls__shuffle',
      'button[aria-label^="Shuffle"]',
    ],

    shufflePressed: [
      '.shuffleButton.shuffleControl--active',
      '.shuffleControl--active',
    ],

    /** Панель очереди (для queue-assist с shuffle). */
    queuePanel: [
      '.queue__panelWrapper',
      '.queue',
    ],

    volumeSlider: [
      '.volume__sliderWrapper',
      '.volume__slider',
      'div[role="slider"][aria-label*="olume"]',
    ],

    /** Медиа-элемент плеера. Выбор по «живости» — см. getMedia() в content.js. */
    mediaElement: ['video', 'audio'],

    /** Текстовые тайминги таймлайна (фолбэк, если медиа-элемент не найден). */
    timeElapsed: ['.playbackTimeline__timeSpan'],
    timeDuration: ['.playbackTimeline__duration'],

    /** Корень панели плеера и кнопка очереди. */
    playerControls: ['.playControls'],
    queueToggle: ['.playControls__queue'],
  };

  /** Пороги для выравнивания обложки на лучшее качество. */
  const ARTWORK_UPGRADE = {
    from: ['-large.', '-t67x67.', '-t50x50.', '-badge.', '-t120x120.'],
    to: '-t500x500.',
  };

  function firstMatch(list, root) {
    const scope = root || document;
    for (const sel of list) {
      try {
        const el = scope.querySelector(sel);
        if (el) return el;
      } catch (e) {
        // Селектор мог стать невалидным в новой версии Chrome — пропускаем.
      }
    }
    return null;
  }

  window.__SCR_SELECTORS = {
    version: 'selectors-1',
    SELECTORS,
    ARTWORK_UPGRADE,
    firstMatch,
  };
})();
