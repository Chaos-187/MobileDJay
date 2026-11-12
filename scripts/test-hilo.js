const { evaluateGuess, rankValue } = require('../lib/hilo');

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

const low = { rank: '5', suit: 'clubs' };
const high = { rank: '9', suit: 'hearts' };
assert(evaluateGuess(low, high, 'higher') === 'win', 'higher should win');
assert(evaluateGuess(high, low, 'lower') === 'win', 'lower should win');
assert(evaluateGuess(low, high, 'lower') === 'lose', 'lower wrong');
const ace = { rank: 'A', suit: 'spades' };
const king = { rank: 'K', suit: 'diamonds' };
assert(rankValue('A', true) === 14, 'ace high');
assert(rankValue('A', false) === 1, 'ace low');
assert(evaluateGuess(ace, king, 'lower', { aceHigh: true }) === 'win', 'A vs K lower wins ace high');
assert(evaluateGuess({ rank: '7', suit: 'clubs' }, { rank: '7', suit: 'hearts' }, 'higher', { tiesWin: false }) === 'lose', 'tie loses');
assert(evaluateGuess({ rank: '7', suit: 'clubs' }, { rank: '7', suit: 'hearts' }, 'higher', { tiesWin: true }) === 'win', 'tie wins');

console.log('test-hilo: ok');
