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
    var audioPrimed = false;

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
        if (!url || typeof Audio === 'undefined') return Promise.resolve(false);
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
            if (p && typeof p.then === 'function') {
                return p
                    .then(function () {
                        return true;
                    })
                    .catch(function () {
                        return false;
                    });
            }
            return Promise.resolve(true);
        } catch (e) {
            return Promise.resolve(false);
        }
    }

    function markAnnounced(num) {
        lastAnnouncedBall = num;
        lastAnnouncedAt = Date.now();
    }

  /** Wake mobile audio after a user gesture (silent prime). */
    function unlockAudio() {
        warmup();
        if (audioPrimed || typeof Audio === 'undefined') return Promise.resolve();
        audioPrimed = true;
        var url = femaleNumberUrl(1);
        if (!url) return Promise.resolve();
        try {
            if (!audioByUrl[url]) {
                audioByUrl[url] = new Audio(url);
                audioByUrl[url].preload = 'auto';
            }
            var a = audioByUrl[url];
            var prevVol = a.volume;
            a.volume = 0.001;
            a.pause();
            a.currentTime = 0;
            var p = a.play();
            if (!p || typeof p.then !== 'function') {
                a.volume = prevVol;
                return Promise.resolve();
            }
            return p
                .then(function () {
                    a.pause();
                    a.currentTime = 0;
                    a.volume = prevVol;
                })
                .catch(function () {
                    a.volume = prevVol;
                    audioPrimed = false;
                });
        } catch (e) {
            audioPrimed = false;
            return Promise.resolve();
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
        if (!Number.isFinite(n)) return Promise.resolve(false);

        var now = Date.now();
        if (n === lastAnnouncedBall && now - lastAnnouncedAt < ANNOUNCE_DEBOUNCE_MS) {
            return Promise.resolve(true);
        }

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
                markAnnounced(n);
                return Promise.resolve(true);
            }

            if (st === 'phrase') {
                if (global.MdjBingoTts && global.MdjBingoTts.speakBall) {
                    global.MdjBingoTts.speakBall(num, style, cardFormat);
                }
                markAnnounced(n);
                return Promise.resolve(true);
            }

            cancelAll();

            if (st === 'number') {
                return playFemaleNumber(num).then(function (ok) {
                    if (!ok) {
                        speakNumberFallback(num);
                        return false;
                    }
                    markAnnounced(n);
                    return true;
                });
            }

            if (st === 'both') {
                var parts =
                    global.MdjBingoUkCalls && global.MdjBingoUkCalls.announcementParts
                        ? global.MdjBingoUkCalls.announcementParts(num, style, cardFormat)
                        : [];
                if (parts.length > 1 && global.MdjBingoTts && global.MdjBingoTts.speakTextThen) {
                    return new Promise(function (resolve) {
                        global.MdjBingoTts.speakTextThen(parts[0], function () {
                            playFemaleNumber(num).then(function (ok) {
                                if (!ok) {
                                    speakNumberFallback(num);
                                    resolve(false);
                                    return;
                                }
                                markAnnounced(n);
                                resolve(true);
                            });
                        });
                    });
                }
                return playFemaleNumber(num).then(function (ok) {
                    if (!ok) {
                        speakNumberFallback(num);
                        return false;
                    }
                    markAnnounced(n);
                    return true;
                });
            }

            return playFemaleNumber(num).then(function (ok) {
                if (!ok) {
                    speakNumberFallback(num);
                    return false;
                }
                markAnnounced(n);
                return true;
            });
        }

        if (global.MdjBingoTheme && typeof global.MdjBingoTheme.announceCalledBall === 'function') {
            return new Promise(function (resolve) {
                global.MdjBingoTheme.announceCalledBall(theme, num, function () {
                    Promise.resolve(runCall()).then(resolve);
                });
            });
        }
        return runCall();
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
        unlock: unlockAudio,
        femaleNumberUrl: femaleNumberUrl
    };
})(typeof window !== 'undefined' ? window : global);