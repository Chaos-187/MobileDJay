/**
 * Apply bingo-theme-* classes (caller, guest play, display layer).
 */
(function (global) {
    'use strict';

    var THEME_IDS = ['default', 'christmas', 'halloween', 'classic', 'neon-90s', 'wedding'];

      /** Theme-specific ball-call sounds (replaces TTS when present). */
    var CALL_SOUND_BY_THEME = {
        christmas: '/audio/Xmas-call.mp3'
    };

    var DEFAULT_VERIFIED_CALL_SOUND = '/audio/verified_call.mp3';

    /** Theme-specific sounds when a claim is verified on the display. */
    var VERIFIED_CALL_SOUND_BY_THEME = {
        halloween: '/audio/halloween-VerfiedCall.mp3'
    };

    function normalizeBingoTheme(value) {
        var id = String(value == null ? 'default' : value)
            .trim()
            .toLowerCase()
            .replace(/\s+/g, '-');
        if (THEME_IDS.indexOf(id) >= 0) return id;
        if (id === 'xmas') return 'christmas';
        if (id === 'neon' || id === '90s' || id === '90s-neon') return 'neon-90s';
        if (id === 'wedding-theme' || id === 'bridal') return 'wedding';
        return 'default';
    }

    function applyBingoTheme(host, theme) {
        if (!host || !host.classList) return;
        var list = host.classList;
        var remove = [];
        for (var i = 0; i < list.length; i++) {
            if (list[i].indexOf('bingo-theme-') === 0) remove.push(list[i]);
        }
        remove.forEach(function (c) {
            list.remove(c);
        });
        var t = normalizeBingoTheme(theme);
        if (t !== 'default') list.add('bingo-theme-' + t);
    }

    var callAudioByUrl = Object.create(null);

    function playAudioUrl(url) {
        if (!url || typeof Audio === 'undefined') return false;
        try {
            if (!callAudioByUrl[url]) {
                callAudioByUrl[url] = new Audio(url);
                callAudioByUrl[url].preload = 'auto';
            }
            var a = callAudioByUrl[url];
            a.pause();
            a.currentTime = 0;
            var p = a.play();
            if (p && typeof p.catch === 'function') {
                p.catch(function () {});
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    function callSoundUrl(theme) {
        var t = normalizeBingoTheme(theme);
        return CALL_SOUND_BY_THEME[t] || null;
    }

    function playThemeCallSound(theme) {
        var url = callSoundUrl(theme);
        if (!url) return false;
        return playAudioUrl(url);
    }

    function verifiedCallSoundUrl(theme) {
        var t = normalizeBingoTheme(theme);
        return VERIFIED_CALL_SOUND_BY_THEME[t] || DEFAULT_VERIFIED_CALL_SOUND;
    }

    function playVerifiedCallSound(theme) {
        return playAudioUrl(verifiedCallSoundUrl(theme));
    }

    /**
     * Play theme call sting or fall back to speakTts(num).
     * @param {string} theme
     * @param {number|string} num — passed to TTS fallback only
     * @param {function(number|string): void} [speakTts]
     */
    function announceCalledBall(theme, num, speakTts) {
        if (playThemeCallSound(theme)) return;
        if (typeof speakTts === 'function') speakTts(num);
    }

    global.MdjBingoTheme = {
        normalize: normalizeBingoTheme,
        apply: applyBingoTheme,
        ids: THEME_IDS.slice(),
        callSoundUrl: callSoundUrl,
        playThemeCallSound: playThemeCallSound,
        announceCalledBall: announceCalledBall,
        verifiedCallSoundUrl: verifiedCallSoundUrl,
        playVerifiedCallSound: playVerifiedCallSound
    };
})(typeof window !== 'undefined' ? window : global);