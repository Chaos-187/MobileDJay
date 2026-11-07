const HORSE_NAMES = [
    'Thunder Bolt',
    'Midnight Star',
    'Golden Arrow',
    'Wild Spirit',
    'Royal Flush',
    'Desert Wind',
    'Iron Hoof',
    'Silver Creek',
    'Storm Chaser',
    'Lucky Charm'
];

const DOG_NAMES = [
    'Blue Rocket',
    'Swift Shadow',
    'Turbo Max',
    'Neon Flyer',
    'Ace Tracker',
    'Flash Gordon',
    'Rocket Pete',
    'Zoom Star',
    'Dash King',
    'Pixel Bolt'
];

const SILKS = [
    '#e11d48',
    '#2563eb',
    '#16a34a',
    '#eab308',
    '#a855f7',
    '#ea580c',
    '#0891b2',
    '#4b5563'
];

function pickNames(pool, count) {
    const shuffled = pool.slice().sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.max(1, Math.min(count, shuffled.length)));
}

function generateRunners(variant, count) {
    const n = Math.max(4, Math.min(8, Number(count) || 6));
    const pool = variant === 'dog' ? DOG_NAMES : HORSE_NAMES;
    const names = pickNames(pool, n);
    return names.map((name, i) => ({
        id: `${variant}-${i + 1}-${Math.random().toString(36).slice(2, 8)}`,
        lane: i + 1,
        number: i + 1,
        name,
        silk: SILKS[i % SILKS.length],
        progress: 0,
        finished: false
    }));
}

function variantLabel(variant) {
    return variant === 'dog' ? 'Virtual greyhound racing' : 'Virtual horse racing';
}

function variantIcon(variant) {
    return variant === 'dog' ? 'fa-dog' : 'fa-horse';
}

module.exports = {
    generateRunners,
    variantLabel,
    variantIcon,
    HORSE_NAMES,
    DOG_NAMES
};
