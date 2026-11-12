const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];

const SUIT_SYMBOL = {
    hearts: '♥',
    diamonds: '♦',
    clubs: '♣',
    spades: '♠'
};

function createDeck() {
    const deck = [];
    for (const suit of SUITS) {
        for (const rank of RANKS) {
            deck.push({ rank, suit, id: `${rank}-${suit}` });
        }
    }
    return deck;
}

function shuffle(deck) {
    const a = deck.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function rankValue(rank, aceHigh = true) {
    if (rank === 'A') return aceHigh ? 14 : 1;
    if (rank === 'K') return 13;
    if (rank === 'Q') return 12;
    if (rank === 'J') return 11;
    return parseInt(rank, 10);
}

function compareCards(a, b, aceHigh = true) {
    const va = rankValue(a.rank, aceHigh);
    const vb = rankValue(b.rank, aceHigh);
    if (va < vb) return -1;
    if (va > vb) return 1;
    return 0;
}

function evaluateGuess(current, next, guess, options = {}) {
    const aceHigh = options.aceHigh !== false;
    const tiesWin = !!options.tiesWin;
    const cmp = compareCards(current, next, aceHigh);
    if (cmp === 0) return tiesWin ? 'win' : 'lose';
    if (guess === 'higher') return cmp < 0 ? 'win' : 'lose';
    if (guess === 'lower') return cmp > 0 ? 'win' : 'lose';
    return 'lose';
}

function cardLabel(card) {
    if (!card) return '';
    const sym = SUIT_SYMBOL[card.suit] || '';
    return `${card.rank}${sym}`;
}

function isRedSuit(suit) {
    return suit === 'hearts' || suit === 'diamonds';
}

module.exports = {
    RANKS,
    SUITS,
    SUIT_SYMBOL,
    createDeck,
    shuffle,
    rankValue,
    compareCards,
    evaluateGuess,
    cardLabel,
    isRedSuit
};
