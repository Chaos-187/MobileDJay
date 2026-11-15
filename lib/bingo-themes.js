/**
 * Built-in bingo visual themes (caller, guest cards, venue display).
 */

const BINGO_THEMES = [
    { id: 'default', label: 'Default', description: 'Teal tickets and warm orange ball' },
    { id: 'christmas', label: 'Christmas', description: 'Red and green with gold highlights' },
    { id: 'halloween', label: 'Halloween', description: 'Orange, purple, and midnight black' },
    { id: 'classic', label: 'Classic hall', description: 'Cream cards and traditional red dabbers' },
    { id: 'neon-90s', label: '90s neon', description: 'Hot pink, cyan, and arcade glow' },
    { id: 'wedding', label: 'Wedding', description: 'Ivory, blush, and soft gold' }
];

const THEME_IDS = new Set(BINGO_THEMES.map((t) => t.id));

function normalizeBingoTheme(value) {
    const id = String(value == null ? 'default' : value)
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-');
    if (THEME_IDS.has(id)) return id;
    if (id === 'xmas' || id === 'christmas-theme') return 'christmas';
    if (id === 'neon' || id === '90s' || id === '90s-neon') return 'neon-90s';
    if (id === 'wedding-theme' || id === 'bridal') return 'wedding';
    return 'default';
}

function listBingoThemes() {
    return BINGO_THEMES.map((t) => ({ ...t }));
}

module.exports = {
    BINGO_THEMES,
    normalizeBingoTheme,
    listBingoThemes
};