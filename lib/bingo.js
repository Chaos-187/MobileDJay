/**
 * Bingo card logic — UK 90-ball (3×9) and US 75-ball (5×5 with free centre).
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

    throw new Error(
        'Could not generate a valid UK 90-ball ticket' +
            (ballCap < 80 ? ' — use ball count 90 (numbers 80–90 are required on every card)' : '')
    );
}

function ticketNumbers(grid) {
    const n = [];
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 9; c++) {
            const v = grid[r][c];
            if (v != null) n.push(v);
        }
    }
    return n;
}

function ticketNumberSetKey(grid) {
    return ticketNumbers(grid)
        .sort((a, b) => a - b)
        .join(',');
}

function ticketNumberOverlap(numsA, numsB) {
    const seen = new Set(numsA);
    let n = 0;
    for (const x of numsB) {
        if (seen.has(x)) n++;
    }
    return n;
}

/**
 * New ticket for a batch — avoids duplicate 15-number sets and heavy overlap with cards already in the batch.
 * @param {number[][][]} existingGrids grids already accepted in this batch
 * @param {number} [maxPairOverlap=6] max shared numbers vs any single prior card (2–3 is typical at random)
 */
function generateUK90TicketForBatch(maxBall = 90, existingGrids = [], maxPairOverlap = 6, rng = Math.random) {
    const priorNums = existingGrids.map(ticketNumbers);
    const usedKeys = new Set(existingGrids.map(ticketNumberSetKey));
    const cap = Math.max(9, Math.min(90, Number(maxBall) || 90));
    const overlapLimit = Math.max(3, Math.min(12, Number(maxPairOverlap) || 6));

    for (let attempt = 0; attempt < 400; attempt++) {
        const grid = generateUK90Ticket(cap, rng);
        const key = ticketNumberSetKey(grid);
        if (usedKeys.has(key)) continue;
        const nums = ticketNumbers(grid);
        let ok = true;
        for (const prev of priorNums) {
            if (ticketNumberOverlap(nums, prev) > overlapLimit) {
                ok = false;
                break;
            }
        }
        if (ok) return grid;
    }
    return generateUK90Ticket(cap, rng);
}

const US75_COL_RANGES = [
    [1, 15],
    [16, 30],
    [31, 45],
    [46, 60],
    [61, 75]
];

const BINGO_CARD_FORMATS = [
    {
        id: 'uk-90',
        label: 'UK 90-ball',
        description: '3 rows × 9 columns — line, two lines, full house',
        ballCount: 90
    },
    {
        id: 'us-75',
        label: 'US 75-ball',
        description: '5×5 BINGO card — four corners, line, two lines, full house',
        ballCount: 75
    }
];

function normalizeCardFormat(value) {
    const s = String(value == null ? 'uk-90' : value)
        .trim()
        .toLowerCase();
    if (s === 'us-75' || s === 'us75' || s === '75' || s === 'american') return 'us-75';
    return 'uk-90';
}

/** Caller + card generation ball count — UK 90 needs 1–90 (column nine is 80–90). */
function normalizeBallCountForFormat(cardFormat, ballCount) {
    const fmt = normalizeCardFormat(cardFormat);
    if (fmt === 'us-75') return 75;
    return 90;
}

/** Venue / guest TTS: numbers only, UK nicknames, or both (UK 90-ball). */
function normalizeCallerAnnounceStyle(value) {
    const s = String(value == null ? 'number' : value)
        .trim()
        .toLowerCase();
    if (s === 'phrase' || s === 'phrases') return 'phrase';
    if (s === 'both' || s === 'number_and_phrase') return 'both';
    return 'number';
}

function callerAnnounceStyleLabel(style) {
    const s = normalizeCallerAnnounceStyle(style);
    if (s === 'phrase') return 'UK phrases only';
    if (s === 'both') return 'Phrase then number';
    return 'Numbers only';
}

function inferCardFormat(grid) {
    if (Array.isArray(grid) && grid.length === 5 && Array.isArray(grid[0]) && grid[0].length === 5) return 'us-75';
    return 'uk-90';
}

function prizeTiersForFormat(cardFormat) {
    const fmt = normalizeCardFormat(cardFormat);
    if (fmt === 'us-75') return ['four-corners', 'line', 'two-lines', 'house'];
    return ['line', 'two-lines', 'house'];
}

function defaultPlayingFor(cardFormat) {
    return normalizeCardFormat(cardFormat) === 'us-75' ? 'four-corners' : 'line';
}

function emptyPrizeWinners(cardFormat) {
    const tiers = prizeTiersForFormat(cardFormat);
    const out = {};
    for (const t of tiers) out[t] = null;
    return out;
}

function isUS75Center(row, col) {
    return row === 2 && col === 2;
}

/** @returns {number[][]} 5×5 grid; centre cell is null (FREE) */
function generateUS75Ticket(rng = Math.random) {
    const grid = Array.from({ length: 5 }, () => Array(5).fill(null));
    for (let col = 0; col < 5; col++) {
        const [lo, hi] = US75_COL_RANGES[col];
        const pool = [];
        for (let n = lo; n <= hi; n++) pool.push(n);
        const shuffled = shuffle(pool, rng);
        const rows = col === 2 ? [0, 1, 3, 4] : [0, 1, 2, 3, 4];
        rows.forEach((row, i) => {
            grid[row][col] = shuffled[i];
        });
    }
    grid[2][2] = null;
    return grid;
}

function ticketNumbersUS75(grid) {
    const n = [];
    for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
            if (isUS75Center(r, c)) continue;
            const v = grid[r][c];
            if (v != null) n.push(v);
        }
    }
    return n;
}

function generateUS75TicketForBatch(existingGrids = [], maxPairOverlap = 10, rng = Math.random) {
    const priorNums = existingGrids.map((g) =>
        inferCardFormat(g) === 'us-75' ? ticketNumbersUS75(g) : ticketNumbers(g)
    );
    const usedKeys = new Set(
        existingGrids.map((g) =>
            (inferCardFormat(g) === 'us-75' ? ticketNumbersUS75(g) : ticketNumbers(g))
                .sort((a, b) => a - b)
                .join(',')
        )
    );
    const overlapLimit = Math.max(6, Math.min(18, Number(maxPairOverlap) || 10));

    for (let attempt = 0; attempt < 400; attempt++) {
        const grid = generateUS75Ticket(rng);
        const key = ticketNumbersUS75(grid).sort((a, b) => a - b).join(',');
        if (usedKeys.has(key)) continue;
        const nums = ticketNumbersUS75(grid);
        let ok = true;
        for (const prev of priorNums) {
            if (ticketNumberOverlap(nums, prev) > overlapLimit) {
                ok = false;
                break;
            }
        }
        if (ok) return grid;
    }
    return generateUS75Ticket(rng);
}

function generateTicketForBatch(cardFormat, ballCount, existingGrids = [], rng = Math.random) {
    const fmt = normalizeCardFormat(cardFormat);
    if (fmt === 'us-75') return generateUS75TicketForBatch(existingGrids, 10, rng);
    const cap = normalizeBallCountForFormat(fmt, ballCount);
    return generateUK90TicketForBatch(cap, existingGrids, 6, rng);
}

function us75CellMarked(grid, r, c, calledSet) {
    if (isUS75Center(r, c)) return true;
    const n = grid[r][c];
    if (n == null) return true;
    return calledSet.has(n);
}

function us75UncalledOnLine(grid, coords, calledSet) {
    let need = 0;
    for (const [r, c] of coords) {
        if (isUS75Center(r, c)) continue;
        const n = grid[r][c];
        if (n != null && !calledSet.has(n)) need++;
    }
    return need;
}

function us75AllLines(grid) {
    const lines = [];
    for (let r = 0; r < 5; r++) {
        lines.push([0, 1, 2, 3, 4].map((c) => [r, c]));
    }
    for (let c = 0; c < 5; c++) {
        lines.push([0, 1, 2, 3, 4].map((r) => [r, c]));
    }
    lines.push([0, 1, 2, 3, 4].map((i) => [i, i]));
    lines.push([0, 1, 2, 3, 4].map((i) => [i, 4 - i]));
    return lines;
}

function us75Corners(grid) {
    return [
        [0, 0],
        [0, 4],
        [4, 0],
        [4, 4]
    ];
}

function us75FourCornersComplete(grid, calledSet) {
    return us75Corners(grid).every(([r, c]) => us75CellMarked(grid, r, c, calledSet));
}

function us75CompletedLineCount(grid, calledSet) {
    return us75AllLines(grid).filter((coords) => us75UncalledOnLine(grid, coords, calledSet) === 0).length;
}

function us75HouseComplete(grid, calledSet) {
    for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
            if (!us75CellMarked(grid, r, c, calledSet)) return false;
        }
    }
    return true;
}

function verifyClaimUS75(grid, calledBalls, claimType) {
    const calledSet = new Set(calledBalls || []);
    const pf = normalizePlayingFor(claimType);
    if (pf === 'four-corners') return us75FourCornersComplete(grid, calledSet);
    if (pf === 'line') return us75CompletedLineCount(grid, calledSet) >= 1;
    if (pf === 'two-lines') return us75CompletedLineCount(grid, calledSet) >= 2;
    if (pf === 'house') return us75HouseComplete(grid, calledSet);
    return false;
}

function progressTowardClaimUS75(grid, calledBalls, claimType, prizeLabel) {
    const calledSet = new Set(calledBalls || []);
    const playingFor = normalizePlayingFor(claimType);
    const defaultPrize =
        playingFor === 'four-corners'
            ? 'four corners'
            : playingFor === 'line'
              ? 'a line'
              : playingFor === 'two-lines'
                ? 'two lines'
                : 'full house';
    const prize = prizeLabel && String(prizeLabel).trim() ? String(prizeLabel).trim() : defaultPrize;

    const lineNeeds = us75AllLines(grid).map((coords) => us75UncalledOnLine(grid, coords, calledSet));
    const sortedLineNeeds = lineNeeds.slice().sort((a, b) => a - b);
    const completedLines = lineNeeds.filter((n) => n === 0).length;

    let toGo = 0;
    let label = '';

    if (playingFor === 'four-corners') {
        const cornerNeed = us75Corners(grid).filter(([r, c]) => !us75CellMarked(grid, r, c, calledSet)).length;
        toGo = cornerNeed;
        if (toGo === 0) {
            label = prize !== 'four corners' ? `${prize} — claim!` : 'Four corners — claim!';
        } else if (toGo === 1) label = `1 to go for ${prize}`;
        else label = `${toGo} to go for ${prize}`;
    } else if (playingFor === 'line') {
        toGo = sortedLineNeeds[0] ?? 0;
        if (completedLines >= 1) {
            label = prize !== 'a line' ? `${prize} — claim!` : 'Line — claim!';
            toGo = 0;
        } else if (toGo === 1) label = `1 to go for ${prize}`;
        else label = `${toGo} to go for ${prize}`;
    } else if (playingFor === 'two-lines') {
        if (completedLines >= 2) {
            toGo = 0;
            label = prize !== 'two lines' ? `${prize} — claim!` : 'Two lines — claim!';
        } else if (completedLines === 1) {
            const incomplete = lineNeeds.filter((n) => n > 0);
            toGo = incomplete.length ? Math.min(...incomplete) : 0;
            label = toGo === 1 ? `1 to go for ${prize}` : `${toGo} to go for ${prize}`;
        } else {
            toGo = (sortedLineNeeds[0] ?? 0) + (sortedLineNeeds[1] ?? 0);
            label = toGo === 1 ? `1 to go for ${prize}` : `${toGo} to go for ${prize}`;
        }
    } else {
        for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 5; c++) {
                if (isUS75Center(r, c)) continue;
                const n = grid[r][c];
                if (n != null && !calledSet.has(n)) toGo++;
            }
        }
        if (toGo === 0) label = prize !== 'full house' ? `${prize} — claim!` : 'Full house — claim!';
        else if (toGo === 1) label = `1 to go for ${prize}`;
        else label = `${toGo} to go for ${prize}`;
    }

    return { toGo, completedRows: completedLines, rowNeeds: lineNeeds, playingFor, label };
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

function verifyClaimUK90(grid, calledBalls, claimType) {
    const completed = countCompletedRows(grid, calledBalls);
    const pf = normalizePlayingFor(claimType);
    if (pf === 'four-corners') return false;
    if (pf === 'line') return completed >= 1;
    if (pf === 'two-lines') return completed >= 2;
    if (pf === 'house') return completed >= 3;
    return false;
}

function verifyClaim(grid, calledBalls, claimType, cardFormat) {
    const fmt = cardFormat ? normalizeCardFormat(cardFormat) : inferCardFormat(grid);
    if (fmt === 'us-75') return verifyClaimUS75(grid, calledBalls, claimType);
    return verifyClaimUK90(grid, calledBalls, claimType);
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
function progressTowardClaimUK90(grid, calledBalls, claimType, prizeLabel) {
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
            label = prize !== 'a line' ? `${prize} — claim!` : 'Line — claim!';
            toGo = 0;
        } else if (toGo === 1) label = `1 to go for ${prize}`;
        else label = `${toGo} to go for ${prize}`;
    } else if (playingFor === 'two-lines') {
        if (completedRows >= 2) {
            toGo = 0;
            label = prize !== 'two lines' ? `${prize} — claim!` : 'Two lines — claim!';
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
        if (toGo === 0) label = prize !== 'full house' ? `${prize} — claim!` : 'Full house — claim!';
        else if (toGo === 1) label = `1 to go for ${prize}`;
        else label = `${toGo} to go for ${prize}`;
    }

    return { toGo, completedRows, rowNeeds, playingFor, label };
}

function progressTowardClaim(grid, calledBalls, claimType, prizeLabel, cardFormat) {
    const fmt = cardFormat ? normalizeCardFormat(cardFormat) : inferCardFormat(grid);
    if (fmt === 'us-75') return progressTowardClaimUS75(grid, calledBalls, claimType, prizeLabel);
    return progressTowardClaimUK90(grid, calledBalls, claimType, prizeLabel);
}

function claimLabel(claimType) {
    if (claimType === 'four-corners') return 'Four Corners';
    if (claimType === 'line') return 'One Line';
    if (claimType === 'two-lines') return 'Two Lines';
    if (claimType === 'house') return 'Full House';
    return claimType;
}

/** Short label for display screens (e.g. “Playing for · 1 Line”). */
function playingForDisplayLabel(claimType) {
    if (claimType === 'four-corners') return '4 Corners';
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
        pf === 'four-corners'
            ? sanitizePrizeName(prizes?.['four-corners'] ?? prizes?.fourCorners)
            : pf === 'line'
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
        'four-corners': sanitizePrizeName(src['four-corners'] ?? src.fourCorners ?? src.four_corners),
        line: sanitizePrizeName(src.line),
        'two-lines': sanitizePrizeName(src['two-lines'] ?? src.twoLines ?? src.two_lines),
        house: sanitizePrizeName(src.house)
    };
}

function normalizePlayingFor(value) {
    const s = String(value || 'line').trim();
    if (s === 'four-corners' || s === '4-corners' || s === 'corners' || s === 'fourcorners') return 'four-corners';
    if (s === 'two-lines' || s === '2-lines' || s === '2lines') return 'two-lines';
    if (s === 'house' || s === 'full-house') return 'house';
    if (s === 'line' || s === '1-line' || s === '1line') return 'line';
    return 'line';
}

function ballCap(maxBall, cardFormat) {
    if (cardFormat && normalizeCardFormat(cardFormat) === 'us-75') return 75;
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
    if (!Array.isArray(parsed)) return null;
    if (parsed.length === 3 && Array.isArray(parsed[0]) && parsed[0].length === 9) {
        return parsed.map((row) => (Array.isArray(row) && row.length === 9 ? row : null));
    }
    if (parsed.length === 5 && Array.isArray(parsed[0]) && parsed[0].length === 5) {
        return parsed.map((row) => (Array.isArray(row) && row.length === 5 ? row : null));
    }
    return null;
}

const BINGO_THEMES = [
    { id: 'default', label: 'Default', description: 'Teal tickets and warm orange ball' },
    { id: 'christmas', label: 'Christmas', description: 'Red and green with gold highlights' },
    { id: 'halloween', label: 'Halloween', description: 'Orange, purple, and midnight black' },
    { id: 'easter', label: 'Easter', description: 'Spring pastels with decorated egg dabbers' },
    { id: 'classic', label: 'Classic hall', description: 'Cream cards and traditional red dabbers' },
    { id: 'neon-90s', label: '90s neon', description: 'Hot pink, cyan, and arcade glow' },
    { id: 'wedding', label: 'Wedding', description: 'Ivory linen, champagne gold, and soft blush' }
];

const BINGO_THEME_IDS = new Set(BINGO_THEMES.map((t) => t.id));

function normalizeBingoTheme(value) {
    const id = String(value == null ? 'default' : value)
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-');
    if (BINGO_THEME_IDS.has(id)) return id;
    if (id === 'xmas' || id === 'christmas-theme') return 'christmas';
    if (id === 'easter-spring' || id === 'spring') return 'easter';
    if (id === 'neon' || id === '90s' || id === '90s-neon') return 'neon-90s';
    if (id === 'wedding-theme' || id === 'bridal') return 'wedding';
    return 'default';
}

function listBingoThemes() {
    return BINGO_THEMES.map((t) => ({ ...t }));
}

module.exports = {
    COL_RANGES,
    US75_COL_RANGES,
    BINGO_CARD_FORMATS,
    normalizeCardFormat,
    normalizeBallCountForFormat,
    normalizeCallerAnnounceStyle,
    callerAnnounceStyleLabel,
    inferCardFormat,
    prizeTiersForFormat,
    defaultPlayingFor,
    emptyPrizeWinners,
    generateUK90Ticket,
    generateUK90TicketForBatch,
    generateUS75Ticket,
    generateUS75TicketForBatch,
    generateTicketForBatch,
    ticketNumbers,
    ticketNumbersUS75,
    ticketNumberSetKey,
    verifyClaim,
    verifyClaimUK90,
    verifyClaimUS75,
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
    pickInt,
    BINGO_THEMES,
    normalizeBingoTheme,
    listBingoThemes
};
