/**
 * Ball call audio — female recorded numbers or browser TTS.
 */
(function (global) {
    'use strict';

    var FEMALE_NUMBERS_BASE = '/audio/Female-Numbers/';
    var audioByUrl = Object.create(null);
    var currentFemaleAudio = null;
    var lastAnnouncedBall = null;
    var lastAnnouncedAt = 0;
    var ANNOUNCE_DEBOUNCE_MS = 1400;

    function normalizeVoiceMode(raw) {
        var s = String(raw == null ? 'tts' : raw)
            .trim()
            .toLowerCase();
        if (s === 'female' || s === 'female-numbers' || s === 'recorded') return 'female';
        return 'tts';
    }

    function femaleNumberUrl(num) {
        var n = parseInt(num, 10);
        if (!Number.isFinite(n) || n < 1 || n > 90) return null;
        return FEMALE_NUMBERS_BASE + n + '.mp3';
    }

    function stopFemaleClip() {
        if (currentFemaleAudio) {
            try {
                currentFemaleAudio.pause();
                currentFemaleAudio.currentTime = 0;
            } catch (e) {
                /* ignore */
            }
            currentFemaleAudio = null;
        }
    }

    function playFemaleNumber(num) {
        var url = femaleNumberUrl(num);
        if (!url || typeof Audio === 'undefined') return false;
        if (global.MdjBingoTts && global.MdjBingoTts.cancel) global.MdjBingoTts.cancel();
        stopFemaleClip();
        try {
            if (!audioByUrl[url]) {
                audioByUrl[url] = new Audio(url);
                audioByUrl[url].preload = 'auto';
            }
            var a = audioByUrl[url];
            currentFemaleAudio = a;
            a.pause();
            a.currentTime = 0;
            var p = a.play();
            if (p && typeof p.catch === 'function') p.catch(function () {});
            return true;
        } catch (e) {
            return false;
        }
    }

    function cancelAll() {
        stopFemaleClip();
        if (global.MdjBingoTts && global.MdjBingoTts.cancel) global.MdjBingoTts.cancel();
    }

    function speakNumberFallback(num) {
        if (global.MdjBingoTts && global.MdjBingoTts.speakParts) {
            global.MdjBingoTts.speakParts([String(num)]);
        } else if (global.MdjBingoTts && global.MdjBingoTts.speak) {
            global.MdjBingoTts.speak(String(num));
        }
    }

    /**
     * @param {number|string} num
     * @param {{ style?: string, cardFormat?: string, voiceMode?: string, theme?: string }} opts
     */
    function announceBall(num, opts) {
        opts = opts || {};
        var n = parseInt(num, 10);
        if (!Number.isFinite(n)) return;

        var now = Date.now();
        if (n === lastAnnouncedBall && now - lastAnnouncedAt < ANNOUNCE_DEBOUNCE_MS) {
            return;
        }
        lastAnnouncedBall = n;
        lastAnnouncedAt = now;

        var style = opts.style || 'number';
        var cardFormat = opts.cardFormat;
        var voiceMode = normalizeVoiceMode(opts.voiceMode);
        var theme = opts.theme || 'default';

        function runCall() {
            var st =
                global.MdjBingoUkCalls && global.MdjBingoUkCalls.normalizeCallerStyle
                    ? global.MdjBingoUkCalls.normalizeCallerStyle(style)
                    : 'number';
            var fmt = String(cardFormat || 'uk-90').toLowerCase();
            var uk = fmt !== 'us-75';

            if (voiceMode !== 'female' || !uk) {
                if (global.MdjBingoTts && global.MdjBingoTts.speakBall) {
                    global.MdjBingoTts.speakBall(num, style, cardFormat);
                }
                return;
            }

            if (st === 'phrase') {
                if (global.MdjBingoTts && global.MdjBingoTts.speakBall) {
                    global.MdjBingoTts.speakBall(num, style, cardFormat);
                }
                return;
            }

            cancelAll();

            if (st === 'number') {
                if (!playFemaleNumber(num)) speakNumberFallback(num);
                return;
            }

            if (st === 'both') {
                var parts =
                    global.MdjBingoUkCalls && global.MdjBingoUkCalls.announcementParts
                        ? global.MdjBingoUkCalls.announcementParts(num, style, cardFormat)
                        : [];
                if (parts.length > 1 && global.MdjBingoTts && global.MdjBingoTts.speakTextThen) {
                    global.MdjBingoTts.speakTextThen(parts[0], function () {
                        if (!playFemaleNumber(num)) speakNumberFallback(num);
                    });
                    return;
                }
                if (!playFemaleNumber(num)) speakNumberFallback(num);
                return;
            }

            if (!playFemaleNumber(num)) speakNumberFallback(num);
        }

        if (global.MdjBingoTheme && typeof global.MdjBingoTheme.announceCalledBall === 'function') {
            global.MdjBingoTheme.announceCalledBall(theme, num, runCall);
        } else {
            runCall();
        }
    }

    /** Preload a few clips after user interaction. */
    function warmup() {
        [1, 42, 90].forEach(function (bn) {
            var url = femaleNumberUrl(bn);
            if (!url) return;
            if (!audioByUrl[url]) {
                audioByUrl[url] = new Audio(url);
                audioByUrl[url].preload = 'auto';
            }
        });
    }

    global.MdjBingoCallerVoice = {
        normalizeVoiceMode: normalizeVoiceMode,
        announceBall: announceBall,
        playFemaleNumber: playFemaleNumber,
        cancel: cancelAll,
        warmup: warmup,
        femaleNumberUrl: femaleNumberUrl
    };
})(typeof window !== 'undefined' ? window : global);