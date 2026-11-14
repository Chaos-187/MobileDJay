/**
 * UK-style 90-ball bingo (3 rows × 9 columns, 15 numbers per ticket).
 * Supports configurable maximum ball count (e.g. 90 or 75 — numbers above max are omitted from columns).
 */

const COL_RANGES = [
    [1, 9],
    [10, 19],
    [20, 29],
    [30, 39],
    [40, 49],
    [50, 59],
    [60, 69],
    [70, 79],
    [80, 90]
];

function pickInt(rng, lo, hi) {
    return lo + Math.floor(rng() * (hi - lo + 1));
}

function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function columnRangeForMaxBall(colIndex, maxBall) {
    const [lo, hi] = COL_RANGES[colIndex];
    const cap = Math.min(hi, maxBall);
    if (cap < lo) return null;
    return [lo, cap];
}

/**
 * @returns {number[][]} 3×9 grid; null = blank cell
 */
function generateUK90Ticket(maxBall = 90, rng = Math.random) {
    const ballCap = Math.max(9, Math.min(90, Number(maxBall) || 90));

    for (let attempt = 0; attempt < 120; attempt++) {
        const grid = Array.from({ length: 3 }, () => Array(9).fill(null));
        const rowCounts = [0, 0, 0];
        let failed = false;
        const usedOnTicket = new Set();

        for (let col = 0; col < 9; col++) {
            const range = columnRangeForMaxBall(col, ballCap);
            if (!range) {
                failed = true;
                break;
            }

            const remainingCols = 9 - col;
            const need = rowCounts.map((c) => 5 - c);
            const eligibleRows = [0, 1, 2].filter((r) => need[r] > 0);
            if (!eligibleRows.length) {
                failed = true;
                break;
            }

            const totalNeed = need.reduce((a, b) => a + b, 0);
            if (totalNeed < remainingCols) {
                failed = true;
                break;
            }

            const maxInCol = Math.min(3, eligibleRows.length);
            let nInCol = 1 + Math.floor(rng() * maxInCol);
            const minRequiredRest = remainingCols - 1;
            nInCol = Math.min(nInCol, totalNeed - minRequiredRest);
            nInCol = Math.max(1, Math.min(nInCol, maxInCol));

            const chosenRows = shuffle(eligibleRows, rng).slice(0, nInCol);
            const [lo, hi] = range;
            const pool = [];
            for (let n = lo; n <= hi; n++) {
                if (!usedOnTicket.has(n)) pool.push(n);
            }
            if (pool.length < chosenRows.length) {
                failed = true;
                break;
            }
            const shuffledPool = shuffle(pool, rng);

            for (const r of chosenRows) {
                const num = shuffledPool.pop();
                grid[r][col] = num;
                usedOnTicket.add(num);
                rowCounts[r]++;
            }
        }

        if (!failed && rowCounts.every((c) => c === 5)) {
            return grid;
        }
    }

    throw new Error('Could not generate a valid bingo ticket');
}

function rowIsComplete(grid, rowIndex, calledSet) {
    for (let c = 0; c < 9; c++) {
        const n = grid[rowIndex][c];
        if (n != null && !calledSet.has(n)) return false;
    }
    return true;
}

function countCompletedRows(grid, calledBalls) {
    const calledSet = new Set(calledBalls);
    return [0, 1, 2].filter((r) => rowIsComplete(grid, r, calledSet)).length;
}

function verifyClaim(grid, calledBalls, claimType) {
    const completed = countCompletedRows(grid, calledBalls);
    if (claimType === 'line') return completed >= 1;
    if (claimType === 'two-lines') return completed >= 2;
    if (claimType === 'house') return completed >= 3;
    return false;
}

function rowUncalledCount(grid, rowIndex, calledSet) {
    let need = 0;
    for (let c = 0; c < 9; c++) {
        const n = grid[rowIndex][c];
        if (n != null && !calledSet.has(n)) need++;
    }
    return need;
}

/**
 * How many numbers still needed for the current prize (DJ "playing for").
 * @returns {{ toGo: number, completedRows: number, label: string }}
 */
function progressTowardClaim(grid, calledBalls, claimType, prizeLabel) {
    const calledSet = new Set(calledBalls || []);
    const rowNeeds = [0, 1, 2].map((r) => rowUncalledCount(grid, r, calledSet));
    const completedRows = rowNeeds.filter((n) => n === 0).length;
    const sorted = rowNeeds.slice().sort((a, b) => a - b);
    const playingFor = normalizePlayingFor(claimType);
    const prize =
        prizeLabel && String(prizeLabel).trim()
            ? String(prizeLabel).trim()
            : playingFor === 'line'
              ? 'a line'
              : playingFor === 'two-lines'
                ? 'two lines'
                : 'full house';

    let toGo = 0;
    let label = '';

    if (playingFor === 'line') {
        toGo = sorted[0];
        if (completedRows >= 1) {
            label = prize !== 'a line' ? `${prize} — complete` : 'Line complete';
            toGo = 0;
        } else if (toGo === 1) label = `1 to go for ${prize}`;
        else label = `${toGo} to go for ${prize}`;
    } else if (playingFor === 'two-lines') {
        if (completedRows >= 2) {
            toGo = 0;
            label = prize !== 'two lines' ? `${prize} — complete` : 'Two lines complete';
        } else if (completedRows === 1) {
            const incompleteNeeds = rowNeeds.filter((n) => n > 0);
            toGo = incompleteNeeds.length ? Math.min(...incompleteNeeds) : 0;
            label = toGo === 1 ? `1 to go for ${prize}` : `${toGo} to go for ${prize}`;
        } else {
            toGo = sorted[0] + sorted[1];
            label = toGo === 1 ? `1 to go for ${prize}` : `${toGo} to go for ${prize}`;
        }
    } else {
        toGo = rowNeeds.reduce((a, b) => a + b, 0);
        if (toGo === 0) label = prize !== 'full house' ? `${prize} — call it!` : 'Full house — call it!';
        else if (toGo === 1) label = `1 to go for ${prize}`;
        else label = `${toGo} to go for ${prize}`;
    }

    return { toGo, completedRows, rowNeeds, playingFor, label };
}

function claimLabel(claimType) {
    if (claimType === 'line') return 'One Line';
    if (claimType === 'two-lines') return 'Two Lines';
    if (claimType === 'house') return 'Full House';
    return claimType;
}

/** Short label for display screens (e.g. “Playing for · 1 Line”). */
function playingForDisplayLabel(claimType) {
    if (claimType === 'line') return '1 Line';
    if (claimType === 'two-lines') return '2 Lines';
    if (claimType === 'house') return 'Full House';
    return claimLabel(claimType);
}

function sanitizePrizeName(name) {
    return String(name || '')
        .trim()
        .slice(0, 80);
}

/**
 * @param {string} playingFor — line | two-lines | house
 * @param {{ line?: string, 'two-lines'?: string, house?: string }} [prizes]
 */
function prizeLabelForPlayingFor(playingFor, prizes) {
    const pf = normalizePlayingFor(playingFor);
    const custom =
        pf === 'line'
            ? sanitizePrizeName(prizes?.line)
            : pf === 'two-lines'
              ? sanitizePrizeName(prizes?.['two-lines'])
              : sanitizePrizeName(prizes?.house);
    if (custom) return custom;
    return playingForDisplayLabel(pf);
}

function normalizePrizes(input) {
    const src = input && typeof input === 'object' ? input : {};
    return {
        line: sanitizePrizeName(src.line),
        'two-lines': sanitizePrizeName(src['two-lines'] ?? src.twoLines ?? src.two_lines),
        house: sanitizePrizeName(src.house)
    };
}

function normalizePlayingFor(value) {
    const s = String(value || 'line').trim();
    if (s === 'two-lines' || s === '2-lines' || s === '2lines') return 'two-lines';
    if (s === 'house' || s === 'full-house') return 'house';
    if (s === 'line' || s === '1-line' || s === '1line') return 'line';
    return 'line';
}

function ballCap(maxBall) {
    return Math.max(9, Math.min(90, Number(maxBall) || 90));
}

/** Numbers not yet called (for display ball-machine decoys). */
function remainingBalls(calledBalls, maxBall) {
    const cap = ballCap(maxBall);
    const called = new Set(calledBalls || []);
    const remaining = [];
    for (let n = 1; n <= cap; n++) {
        if (!called.has(n)) remaining.push(n);
    }
    return remaining;
}

function pickNextBall(calledBalls, maxBall) {
    const remaining = remainingBalls(calledBalls, maxBall);
    if (!remaining.length) return null;
    return remaining[Math.floor(Math.random() * remaining.length)];
}

/** One random uncalled ball — visual only (tumbler / preview). */
function pickRandomDecoy(calledBalls, maxBall, rng = Math.random) {
    const remaining = remainingBalls(calledBalls, maxBall);
    if (!remaining.length) return null;
    return remaining[Math.floor(rng() * remaining.length)];
}

/**
 * Short sequence of decoy picks ending on `finalBall` (must be uncalled or last called).
 * Used to sync display tumbler slowdown before revealing the real call.
 */
function buildDecoySequence(calledBalls, maxBall, finalBall, length = 8, rng = Math.random) {
    const cap = ballCap(maxBall);
    const remaining = remainingBalls(calledBalls, maxBall);
    const seq = [];
    const steps = Math.max(3, Math.min(20, length));
    for (let i = 0; i < steps - 1; i++) {
        let decoy = pickRandomDecoy(calledBalls, maxBall, rng);
        if (decoy === finalBall && remaining.length > 1) {
            decoy = pickRandomDecoy(calledBalls, maxBall, rng);
        }
        if (decoy != null) seq.push(decoy);
    }
    if (finalBall != null && finalBall >= 1 && finalBall <= cap) {
        seq.push(finalBall);
    } else if (remaining.length) {
        seq.push(remaining[Math.floor(rng() * remaining.length)]);
    }
    return seq;
}

function normalizeGrid(parsed) {
    if (!Array.isArray(parsed) || parsed.length !== 3) return null;
    return parsed.map((row) => (Array.isArray(row) && row.length === 9 ? row : null));
}

module.exports = {
    COL_RANGES,
    generateUK90Ticket,
    verifyClaim,
    countCompletedRows,
    progressTowardClaim,
    claimLabel,
    playingForDisplayLabel,
    prizeLabelForPlayingFor,
    normalizePrizes,
    sanitizePrizeName,
    normalizePlayingFor,
    ballCap,
    remainingBalls,
    pickNextBall,
    pickRandomDecoy,
    buildDecoySequence,
    normalizeGrid,
    pickInt
};
