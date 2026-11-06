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
            shuffle(pool, rng);

            for (const r of chosenRows) {
                const num = pool.pop();
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

function claimLabel(claimType) {
    if (claimType === 'line') return 'One Line';
    if (claimType === 'two-lines') return 'Two Lines';
    if (claimType === 'house') return 'Full House';
    return claimType;
}

function pickNextBall(calledBalls, maxBall) {
    const cap = Math.max(9, Math.min(90, Number(maxBall) || 90));
    const called = new Set(calledBalls);
    const remaining = [];
    for (let n = 1; n <= cap; n++) {
        if (!called.has(n)) remaining.push(n);
    }
    if (!remaining.length) return null;
    return remaining[Math.floor(Math.random() * remaining.length)];
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
    claimLabel,
    pickNextBall,
    normalizeGrid,
    pickInt
};
