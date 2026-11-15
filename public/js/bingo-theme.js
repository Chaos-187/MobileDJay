/**
 * Apply bingo-theme-* classes (caller, guest play, display layer).
 */
(function (global) {
    'use strict';

    var THEME_IDS = ['default', 'christmas', 'halloween', 'classic', 'neon-90s', 'wedding'];

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

    global.MdjBingoTheme = {
        normalize: normalizeBingoTheme,
        apply: applyBingoTheme,
        ids: THEME_IDS.slice()
    };
})(typeof window !== 'undefined' ? window : global);