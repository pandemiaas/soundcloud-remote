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
      '.skipControl__next',
      '.playControls__next',
      'button[aria-label^="Next"]',
    ],

    /** Предыдущий трек. */
    prevButton: [
      '.skipControl__previous',
      '.playControls__prev',
      'button[aria-label^="Previous"]',
    ],

    /** Полоса прогресса: aria-valuenow / aria-valuemax (СЕКУНДЫ). */
    timelineProgress: [
      '.playbackTimeline__progressWrapper',
    ],

    /** Слайдер громкости: aria-valuenow / aria-valuemax (0..1). */
    volumeSliderWrap: [
      '.volume__sliderWrapper',
    ],

    /** Заголовок текущего трека (aria-label содержит полное название). */
    playerTitle: [
      '.playbackSoundBadge__title',
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

    /** Ссылка на трек (для поля url). */
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

    /** Аватар бейджа — внутри span с background-image (обложка). */
    artworkAvatar: [
      '.playbackSoundBadge__avatar',
      '.playbackSoundBadge',
    ],

    /** Кнопка лайка текущего трека. */
    likeButton: [
      '.playbackSoundBadge__like',
      '.playbackSoundBadge__likeButton',
      '.playbackSoundBadge .sc-button-like',
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

    /** Кнопка повтора в панели плеера (m-none/m-one/m-all). */
    repeatButton: [
      '.repeatControl',
      '.repeat',
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
