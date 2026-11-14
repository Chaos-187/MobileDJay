/** Upper bound for per-guest virtual cards (event / game settings clamp here). */
const BINGO_MAX_VIRTUAL_PER_GUEST_CAP = 100;

function clampBingoMaxVirtualPerGuest(raw) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.min(BINGO_MAX_VIRTUAL_PER_GUEST_CAP, n);
}

module.exports = {
    BINGO_MAX_VIRTUAL_PER_GUEST_CAP,
    clampBingoMaxVirtualPerGuest
};