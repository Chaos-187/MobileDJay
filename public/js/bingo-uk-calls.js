/**
 * Traditional UK 90-ball bingo nicknames (one primary call per number).
 */
(function (global) {
    'use strict';

    const PHRASES = [
        '', // 0 unused
        "Kelly's eye",
        'One little duck',
        'Cup of tea',
        'Knock at the door',
        'Man alive',
        'Half a dozen',
        'Lucky',
        'Garden gate',
        "Doctor's orders",
        'Downing Street',
        'Legs eleven',
        'One dozen',
        'Unlucky for some',
        "Valentine's Day",
        'Young and keen',
        'Never been kissed',
        'Dancing Queen',
        'Coming of age',
        'Goodbye, teens',
        'Score',
        'Key to the door',
        'Two little ducks',
        'The Lord is my Shepherd',
        'Two dozen',
        'Duck and dive',
        'Pick and mix',
        'Duck and a crutch',
        'In a state',
        'Rise and shine',
        'Dirty Gertie',
        'Get up and run',
        'Buckle my shoe',
        'Dirty knee',
        'Ask for more',
        'Jump and jive',
        'Three dozen',
        'More than eleven',
        'Christmas cake',
        'All the steps',
        'Life begins',
        'Time for fun',
        'Winnie-the-Pooh',
        'Down on your knees',
        'Droopy drawers',
        'Halfway there',
        'Up to tricks',
        'Four and seven',
        'Four dozen',
        'PC',
        "It's a bullseye",
        'Tweak of the thumb',
        'Danny La Rue',
        'Here comes Herbie',
        'Man at the door',
        'Snakes alive',
        'Was she worth it',
        'Heinz varieties',
        'Make them wait',
        'Brighton line',
        'Five dozen',
        "Baker's bun",
        'Tickety-boo',
        'Tickle me',
        'Almost retired',
        'Old age pension',
        'Clickety click',
        'Stairway to heaven',
        'Pick a mate',
        'Either way up',
        'Three score and ten',
        'Bang on the drum',
        'Danny La Rue',
        'Queen bee',
        'Hit the floor',
        'Strive and strive',
        'Trombones',
        'Sunset Strip',
        '39 more steps',
        'One more time',
        "Gandhi's breakfast",
        'Fat lady with a walking stick',
        'Straight on through',
        'Time for tea',
        'Give me more',
        'Staying alive',
        'Between the sticks',
        'Torquay in Devon',
        'Two fat ladies',
        'Nearly there',
        'Top of the shop'
    ];

    const STYLES = [
        { id: 'number', label: 'Numbers only', example: 'Number 42' },
        { id: 'phrase', label: 'UK phrases', example: 'Winnie-the-Pooh' },
        { id: 'both', label: 'Number and phrase', example: '42. Winnie-the-Pooh' }
    ];

    function phraseForNumber(num) {
        const n = parseInt(num, 10);
        if (!Number.isFinite(n) || n < 1 || n > 90) return '';
        return PHRASES[n] || '';
    }

    function normalizeCallerStyle(raw) {
        const s = String(raw || 'number').trim().toLowerCase();
        if (s === 'phrase' || s === 'both') return s;
        return 'number';
    }

    /**
     * @param {number|string} num
     * @param {'number'|'phrase'|'both'} style
     * @param {'uk-90'|'us-75'|string} [cardFormat]
     */
    function announcementText(num, style, cardFormat) {
        const n = parseInt(num, 10);
        if (!Number.isFinite(n)) return '';
        const fmt = String(cardFormat || 'uk-90').toLowerCase();
        const uk = fmt !== 'us-75';
        const st = uk ? normalizeCallerStyle(style) : 'number';
        const nick = uk ? phraseForNumber(n) : '';
        if (st === 'phrase') {
            return nick || 'Number ' + n;
        }
        if (st === 'both') {
            return nick ? n + '. ' + nick : 'Number ' + n;
        }
        return 'Number ' + n;
    }

    global.MdjBingoUkCalls = {
        phraseForNumber,
        announcementText,
        normalizeCallerStyle,
        STYLES
    };
})(typeof window !== 'undefined' ? window : global);