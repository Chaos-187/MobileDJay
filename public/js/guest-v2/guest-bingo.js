/**
 * Guest Hub v2 — in-app bingo tab
 */
(function (global) {
    'use strict';

    var play = null;
    var eventSlug = '';

  function deviceId() {
    var guestSession = global.MdjGuestSession;
    return guestSession ? guestSession.deviceId() : null;
  }

  function customerName(getName) {
    return function () {
      return getName() || '';
    };
  }

  function initBingoTab(cfg, getGuestName) {
    var panel = document.getElementById('ghPanelBingo');
    if (!panel || !cfg.features || !cfg.features.bingo) return;

    var slug = cfg.eventSlug || global.eventSlug || '';
    eventSlug = slug;
    if (!global.MdjGuestBingoPlay) return;

    play = global.MdjGuestBingoPlay.create({
      slug: slug,
      customerName: customerName(getGuestName),
      deviceId: deviceId,
      root: panel,
      initialGameId: null
    });

    var stored = null;
    try {
      stored = sessionStorage.getItem('mdj_bingo_game_' + slug);
      if (stored) play.setActiveGameId(parseInt(stored, 10));
    } catch (e) {
      /* ignore */
    }

    if (play.ensurePlayBuyUi) play.ensurePlayBuyUi();
    return play;
  }

  function onTabShown() {
    if (!play) return;
    if (play.maybePromptFirstPlaySettings) play.maybePromptFirstPlaySettings();
    if (play.ensurePlayBuyUi) play.ensurePlayBuyUi();
    if (play.prefersLobby && play.prefersLobby()) {
      play.showJoin();
      play.loadGames();
      return;
    }
    var id = play.getActiveGameId();
    if (id) {
      play.startPlay();
    } else {
      play.showJoin();
      play.loadGames();
    }
  }

  function onTabHidden() {
    if (play) play.stopPoll();
  }

  function rememberGame(slug, gameId) {
    try {
      if (gameId) sessionStorage.setItem('mdj_bingo_game_' + slug, String(gameId));
    } catch (e) {
      /* ignore */
    }
  }

  function openBuyTickets() {
    if (play && play.openBuyTickets) play.openBuyTickets();
  }

  global.MdjGuestHubBingo = {
    init: initBingoTab,
    onTabShown: onTabShown,
    onTabHidden: onTabHidden,
    rememberGame: rememberGame,
    openBuyTickets: openBuyTickets
  };
})(window);