/**
 * Games tab — switch between Bingo, virtual horses, and virtual dogs.
 */
(function () {
    const picker = document.getElementById('mdjGamesKindPicker');
    if (!picker) return;

    const bingoPanel = document.getElementById('gamePanelBingo');
    const racingPanel = document.getElementById('gamePanelRacing');
    const topbarBingo = document.getElementById('mdjGamesTopbarBingo');
    const topbarRacing = document.getElementById('mdjGamesTopbarRacing');
    const bingoGameSelect = document.getElementById('bingoGameSelectWrap');
    const bingoHint = document.getElementById('bingoTargetHint');

    function setKind(kind) {
        picker.querySelectorAll('[data-games-kind]').forEach(function (btn) {
            const match = btn.getAttribute('data-games-kind') === kind;
            btn.classList.toggle('active', match);
        });
        const isBingo = kind === 'bingo';
        const isRace = kind === 'horse' || kind === 'dog';
        if (bingoPanel) bingoPanel.hidden = !isBingo;
        if (racingPanel) racingPanel.hidden = !isRace;
        if (topbarBingo) topbarBingo.hidden = !isBingo;
        if (topbarRacing) topbarRacing.hidden = !isRace;
        if (bingoGameSelect) bingoGameSelect.hidden = !isBingo;
        if (bingoHint) bingoHint.hidden = !isBingo;
        document.body.classList.toggle('mdj-dashboard-games-focus', isBingo);
        window.dispatchEvent(new CustomEvent('mdj-games-kind-changed', { detail: { kind: kind } }));
    }

    picker.querySelectorAll('[data-games-kind]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            setKind(btn.getAttribute('data-games-kind'));
        });
    });

    document.getElementById('games-tab')?.addEventListener('shown.bs.tab', function () {
        const active = picker.querySelector('[data-games-kind].active');
        setKind(active ? active.getAttribute('data-games-kind') : 'bingo');
    });

    document.getElementById('games-tab')?.addEventListener('hidden.bs.tab', function () {
        document.body.classList.remove('mdj-dashboard-games-focus');
    });
})();
