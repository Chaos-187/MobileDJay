const { createDeck, shuffle, evaluateGuess, rankValue } = require('./hilo');

const stateBySlug = {};

function emptyState() {
    return {
        active: false,
        aceHigh: true,
        tiesWin: false,
        deck: [],
        currentCard: null,
        previousCard: null,
        revealedCard: null,
        lastGuess: null,
        lastResult: null,
        resultUntil: null,
        streak: 0,
        bestStreak: 0,
        round: 0,
        revision: 0,
        phase: 'idle',
        lostAt: null,
        streakAtLoss: 0
    };
}

function getState(slug) {
    if (!slug) return emptyState();
    if (!stateBySlug[slug]) stateBySlug[slug] = emptyState();
    return stateBySlug[slug];
}

function bumpRevision(state) {
    state.revision = (state.revision || 0) + 1;
}

function drawCard(state) {
    if (!state.deck.length) return null;
    return state.deck.pop();
}

function startGame(slug, options = {}) {
    const state = getState(slug);
    state.active = true;
    state.aceHigh = options.aceHigh !== false;
    state.tiesWin = !!options.tiesWin;
    state.deck = shuffle(createDeck());
    state.streak = 0;
    state.round = 0;
    state.lastGuess = null;
    state.lastResult = null;
    state.resultUntil = null;
    state.previousCard = null;
    state.revealedCard = null;
    state.phase = 'playing';
    state.lostAt = null;
    state.streakAtLoss = 0;
    state.currentCard = drawCard(state);
    if (!state.currentCard) {
        state.active = false;
        state.phase = 'idle';
        return { error: 'Could not start deck' };
    }
    bumpRevision(state);
    return { success: true, state: publicState(slug) };
}

function stopGame(slug) {
    const state = getState(slug);
    state.active = false;
    state.phase = 'idle';
    state.resultUntil = null;
    state.lostAt = null;
    bumpRevision(state);
    return { success: true, state: publicState(slug) };
}

function updateConfig(slug, options = {}) {
    const state = getState(slug);
    if (options.aceHigh != null) state.aceHigh = !!options.aceHigh;
    if (options.tiesWin != null) state.tiesWin = !!options.tiesWin;
    bumpRevision(state);
    return { success: true, state: publicState(slug) };
}

function newDeck(slug) {
    const state = getState(slug);
    const streak = state.streak;
    const best = state.bestStreak;
    state.deck = shuffle(createDeck());
    state.streak = 0;
    state.bestStreak = best;
    state.round = 0;
    state.lastGuess = null;
    state.lastResult = null;
    state.resultUntil = null;
    state.previousCard = null;
    state.revealedCard = null;
    state.phase = 'playing';
    state.lostAt = null;
    state.streakAtLoss = 0;
    state.currentCard = drawCard(state);
    state.active = !!state.currentCard;
    if (!state.currentCard) {
        return { error: 'Could not shuffle deck' };
    }
    bumpRevision(state);
    return { success: true, state: publicState(slug), keptStreakNote: streak };
}

function makeGuess(slug, guess) {
    const state = getState(slug);
    if (!state.active || !state.currentCard) {
        return { error: 'Start a Hi-Lo round on the display first' };
    }
    if (state.phase === 'gameover') {
        return { error: 'Game over — tap Start for a new game' };
    }
    if (!state.deck.length) {
        return { error: 'No cards left — tap New deck' };
    }
    const g = guess === 'lower' ? 'lower' : guess === 'higher' ? 'higher' : null;
    if (!g) {
        return { error: 'Guess must be higher or lower' };
    }
    const next = drawCard(state);
    if (!next) {
        return { error: 'No cards left' };
    }
    const result = evaluateGuess(state.currentCard, next, g, {
        aceHigh: state.aceHigh,
        tiesWin: state.tiesWin
    });
    state.previousCard = state.currentCard;
    state.revealedCard = next;
    state.lastGuess = g;
    state.lastResult = result;
    state.round += 1;
    const now = Date.now();
    if (result === 'win') {
        state.streak += 1;
        if (state.streak > state.bestStreak) state.bestStreak = state.streak;
        state.currentCard = next;
        state.resultUntil = now + 2200;
        state.phase = 'playing';
        state.lostAt = null;
    } else {
        state.streakAtLoss = state.streak;
        state.streak = 0;
        state.phase = 'gameover';
        state.lostAt = now;
        state.resultUntil = null;
        state.currentCard = next;
    }
    bumpRevision(state);
    return { success: true, state: publicState(slug) };
}

function publicState(slug) {
    const state = getState(slug);
    const now = Date.now();
    const showingResult = !!(state.resultUntil && now < state.resultUntil);
    const gameOver = state.phase === 'gameover';
    return {
        active: state.active,
        phase: state.phase,
        gameOver,
        aceHigh: state.aceHigh,
        tiesWin: state.tiesWin,
        currentCard: state.currentCard,
        previousCard: showingResult || gameOver ? state.previousCard : null,
        revealedCard: showingResult || gameOver ? state.revealedCard : null,
        lastGuess: showingResult || gameOver ? state.lastGuess : null,
        lastResult: showingResult || gameOver ? state.lastResult : gameOver ? 'lose' : null,
        resultRemainingMs: showingResult ? Math.max(0, state.resultUntil - now) : 0,
        streakAtLoss: gameOver ? state.streakAtLoss ?? 0 : 0,
        streak: state.streak,
        bestStreak: state.bestStreak,
        round: state.round,
        cardsLeft: state.deck.length,
        currentValue: state.currentCard ? rankValue(state.currentCard.rank, state.aceHigh) : null,
        revision: state.revision,
        serverNow: now
    };
}

module.exports = {
    getState,
    startGame,
    stopGame,
    updateConfig,
    newDeck,
    makeGuess,
    publicState
};
