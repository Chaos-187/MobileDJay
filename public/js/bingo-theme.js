/**
 * Apply bingo-theme-* classes (caller, guest play, display layer).
 */
(function (global) {
    'use strict';

    var THEME_IDS = ['default', 'christmas', 'halloween', 'easter', 'classic', 'neon-90s', 'wedding'];

    /** Labels, descriptions, and picker swatches — keep in sync with lib/bingo.js BINGO_THEMES */
    var THEME_LIST = [
        {
            id: 'default',
            label: 'Default',
            description: 'Teal tickets and warm orange ball',
            swatch: ['#0c1219', '#ff7a1a']
        },
        {
            id: 'christmas',
            label: 'Christmas',
            description: 'Red and green with gold highlights',
            swatch: ['#0d2818', '#c41e3a']
        },
        {
            id: 'halloween',
            label: 'Halloween',
            description: 'Orange, purple, and midnight black',
            swatch: ['#0a0510', '#f97316']
        },
        {
            id: 'easter',
            label: 'Easter',
            description: 'Spring pastels with decorated egg dabbers',
            swatch: ['#ede9fe', '#86efac']
        },
        {
            id: 'classic',
            label: 'Classic hall',
            description: 'Cream cards and traditional red dabbers',
            swatch: ['#1c1410', '#b91c1c']
        },
        {
            id: 'neon-90s',
            label: '90s neon',
            description: 'Hot pink, cyan, and arcade glow',
            swatch: ['#0a0014', '#ec4899']
        },
        {
            id: 'wedding',
            label: 'Wedding',
            description: 'Ivory linen, champagne gold, and soft blush',
            swatch: ['#faf7f2', '#c9a227']
        }
    ];

    /** Theme-specific ball-call stings (replaces TTS when present). Christmas uses spoken numbers. */
    var CALL_SOUND_BY_THEME = {};

    var DEFAULT_VERIFIED_CALL_SOUND = '/audio/verified_call.mp3';

    /** Theme-specific sounds when a claim is verified on the display. */
    var VERIFIED_CALL_SOUND_BY_THEME = {
        christmas: '/audio/Xmas-call.mp3',
        halloween: '/audio/halloween-VerfiedCall.mp3',
        'neon-90s': '/audio/Neon-Verified-Call.mp3'
    };

    function normalizeBingoTheme(value) {
        var id = String(value == null ? 'default' : value)
            .trim()
            .toLowerCase()
            .replace(/\s+/g, '-');
        if (THEME_IDS.indexOf(id) >= 0) return id;
        if (id === 'xmas') return 'christmas';
        if (id === 'easter-spring' || id === 'spring') return 'easter';
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

    function listThemes() {
        return THEME_LIST.map(function (t) {
            return { id: t.id, label: t.label, description: t.description, swatch: t.swatch.slice() };
        });
    }

    function themeLabel(themeId) {
        var id = normalizeBingoTheme(themeId);
        for (var i = 0; i < THEME_LIST.length; i++) {
            if (THEME_LIST[i].id === id) return THEME_LIST[i].label;
        }
        return id === 'default' ? 'Default' : id;
    }

    function populateThemeSelect(selectEl, selectedId) {
        if (!selectEl) return;
        var html = '';
        for (var i = 0; i < THEME_LIST.length; i++) {
            var t = THEME_LIST[i];
            html +=
                '<option value="' +
                t.id +
                '">' +
                t.label.replace(/</g, '&lt;').replace(/>/g, '&gt;') +
                '</option>';
        }
        selectEl.innerHTML = html;
        selectEl.value = normalizeBingoTheme(selectedId != null ? selectedId : selectEl.value);
    }

    global.MdjBingoTheme = {
        normalize: normalizeBingoTheme,
        apply: applyBingoTheme,
        ids: THEME_IDS.slice(),
        listThemes: listThemes,
        themeLabel: themeLabel,
        populateThemeSelect: populateThemeSelect,
        callSoundUrl: callSoundUrl,
        playThemeCallSound: playThemeCallSound,
        announceCalledBall: announceCalledBall,
        verifiedCallSoundUrl: verifiedCallSoundUrl,
        playVerifiedCallSound: playVerifiedCallSound
    };
})(typeof window !== 'undefined' ? window : global);