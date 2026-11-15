/**
 * UK bingo caller speech — natural en-GB voice pick + phrase/number cadence.
 */
(function (global) {
    'use strict';

    var cachedVoice = null;
    var voicesReady = false;
    var warmupDone = false;

    var VOICE_SCORE = [
        { re: /libby/i, add: 130 },
        { re: /sonia/i, add: 115 },
        { re: /serena/i, add: 110 },
        { re: /maisie/i, add: 108 },
        { re: /kate/i, add: 105 },
        { re: /google uk english female/i, add: 100 },
        { re: /google uk english male/i, add: 88 },
        { re: /\bdaniel\b/i, add: 95 },
        { re: /\bgeorge\b/i, add: 90 },
        { re: /\bryan\b/i, add: 85 },
        { re: /hazel/i, add: 78 },
        { re: /microsoft.*english.*united kingdom/i, add: 70 },
        { re: /microsoft/i, add: 25 }
    ];

    var VOICE_PENALTY = [/espeak/i, /ekho/i, /android.*speech/i, /\bsamantha\b/i];

    function langIsGb(lang) {
        var l = String(lang || '').toLowerCase().replace('_', '-');
        return l === 'en-gb' || l.indexOf('en-gb') === 0;
    }

    function scoreVoice(v) {
        if (!v) return -9999;
        var name = v.name || '';
        var score = 0;
        var i;

        if (langIsGb(v.lang)) {
            score += 50;
        } else if (String(v.lang || '').toLowerCase().indexOf('en-') === 0) {
            score += 12;
        } else {
            return -9999;
        }

        if (v.localService) score += 18;

        for (i = 0; i < VOICE_PENALTY.length; i++) {
            if (VOICE_PENALTY[i].test(name)) score -= 80;
        }

        for (i = 0; i < VOICE_SCORE.length; i++) {
            if (VOICE_SCORE[i].re.test(name)) score += VOICE_SCORE[i].add;
        }

        if (!v.localService && /online|natural/i.test(name)) score += 35;

        return score;
    }

    function pickBestVoice(voices) {
        var best = null;
        var bestScore = -9999;
        if (!voices || !voices.length) return null;
        for (var i = 0; i < voices.length; i++) {
            var s = scoreVoice(voices[i]);
            if (s > bestScore) {
                bestScore = s;
                best = voices[i];
            }
        }
        return best;
    }

    function refreshVoiceCache() {
        if (typeof window === 'undefined' || !window.speechSynthesis) return;
        try {
            var voices = window.speechSynthesis.getVoices();
            if (voices && voices.length) {
                cachedVoice = pickBestVoice(voices);
                voicesReady = true;
            }
        } catch (e) {
            /* ignore */
        }
    }

    function warmup() {
        if (warmupDone || typeof window === 'undefined' || !window.speechSynthesis) return;
        warmupDone = true;
        refreshVoiceCache();
        window.speechSynthesis.addEventListener('voiceschanged', refreshVoiceCache);
        /* Chrome lazy-loads voices on first getVoices after listener */
        try {
            window.speechSynthesis.getVoices();
        } catch (e) {
            /* ignore */
        }
    }

    function cancel() {
        if (typeof window === 'undefined' || !window.speechSynthesis) return;
        try {
            window.speechSynthesis.cancel();
        } catch (e) {
            /* ignore */
        }
    }

    function applyUtterance(u, partKind) {
        u.lang = 'en-GB';
        if (cachedVoice) u.voice = cachedVoice;
        u.volume = 1;
        if (partKind === 'number') {
            u.rate = 0.86;
            u.pitch = 1;
        } else if (partKind === 'phrase') {
            u.rate = 0.9;
            u.pitch = 1.02;
        } else {
            u.rate = 0.88;
            u.pitch = 1.01;
        }
    }

    var GAP_MS = 320;

    function speakParts(parts) {
        if (typeof window === 'undefined' || !window.speechSynthesis) return;
        if (!parts || !parts.length) return;
        warmup();
        refreshVoiceCache();
        cancel();

        var idx = 0;
        var multi = parts.length > 1;

        function speakNext() {
            if (idx >= parts.length) return;
            var text = String(parts[idx]);
            if (!text.trim()) {
                idx++;
                speakNext();
                return;
            }
            var kind = multi && idx === 0 ? 'phrase' : multi && idx === parts.length - 1 ? 'number' : 'single';
            var u = new SpeechSynthesisUtterance(text);
            applyUtterance(u, kind);
            u.onend = function () {
                idx++;
                if (idx < parts.length) {
                    setTimeout(speakNext, GAP_MS);
                }
            };
            u.onerror = function () {
                idx++;
                speakNext();
            };
            try {
                if (window.speechSynthesis.paused) window.speechSynthesis.resume();
                window.speechSynthesis.speak(u);
            } catch (e) {
                idx++;
                speakNext();
            }
        }

        speakNext();
    }

    function speakText(text) {
        speakParts([String(text || '')]);
    }

    function speakTextThen(text, onDone) {
        if (typeof window === 'undefined' || !window.speechSynthesis) {
            if (typeof onDone === 'function') onDone();
            return;
        }
        var t = String(text || '').trim();
        if (!t) {
            if (typeof onDone === 'function') onDone();
            return;
        }
        warmup();
        refreshVoiceCache();
        cancel();
        var u = new SpeechSynthesisUtterance(t);
        applyUtterance(u, 'phrase');
        u.onend = function () {
            if (typeof onDone === 'function') setTimeout(onDone, GAP_MS);
        };
        u.onerror = function () {
            if (typeof onDone === 'function') onDone();
        };
        try {
            if (window.speechSynthesis.paused) window.speechSynthesis.resume();
            window.speechSynthesis.speak(u);
        } catch (e) {
            if (typeof onDone === 'function') onDone();
        }
    }

    /**
     * @param {number|string} num
     * @param {string} style
     * @param {string} [cardFormat]
     */
    function speakBall(num, style, cardFormat) {
        var parts;
        if (global.MdjBingoUkCalls && global.MdjBingoUkCalls.announcementParts) {
            parts = global.MdjBingoUkCalls.announcementParts(num, style, cardFormat);
        } else if (global.MdjBingoUkCalls && global.MdjBingoUkCalls.announcementText) {
            parts = [global.MdjBingoUkCalls.announcementText(num, style, cardFormat)];
        } else {
            parts = ['Number ' + num];
        }
        speakParts(parts);
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', warmup);
        } else {
            warmup();
        }
    }

    global.MdjBingoTts = {
        warmup: warmup,
        cancel: cancel,
        speak: speakText,
        speakTextThen: speakTextThen,
        speakBall: speakBall,
        speakParts: speakParts
    };
})(typeof window !== 'undefined' ? window : global);