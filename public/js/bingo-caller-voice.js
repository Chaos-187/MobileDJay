/**
 * Bingo caller speech — e.g. 10 as “1” then “0”, not “number ten”.
 */
(function (global) {
    'use strict';

    function ballCallParts(num) {
        const n = Math.floor(Number(num));
        if (!Number.isFinite(n) || n < 1 || n > 90) {
            return [String(num)];
        }
        if (n < 10) {
            return [String(n)];
        }
        const tens = Math.floor(n / 10);
        const ones = n % 10;
        if (ones === 0) {
            return [String(tens), '0'];
        }
        return [String(tens), String(ones)];
    }

    function speak(num) {
        if (typeof window === 'undefined' || !window.speechSynthesis) return;
        const parts = ballCallParts(num);
        try {
            window.speechSynthesis.cancel();
        } catch (e) {
            /* ignore */
        }
        let i = 0;
        function next() {
            if (i >= parts.length) return;
            const u = new SpeechSynthesisUtterance(parts[i]);
            u.lang = 'en-GB';
            u.rate = 0.92;
            u.pitch = 1;
            u.onend = function () {
                i += 1;
                next();
            };
            u.onerror = function () {
                i += 1;
                next();
            };
            try {
                window.speechSynthesis.speak(u);
            } catch (err) {
                i += 1;
                next();
            }
        }
        next();
    }

    global.MdjBingoCallerVoice = { speak: speak, parts: ballCallParts };
})(typeof window !== 'undefined' ? window : global);