/**
 * Games tab — switch between Bingo, virtual horses, and virtual dogs.
 */
(function () {
    const picker = document.getElementById('mdjGamesKindPicker');
    if (!picker) return;

    const bingoPanel = document.getElementById('gamePanelBingo');
    const hiloPanel = document.getElementById('gamePanelHilo');
    const racingPanel = document.getElementById('gamePanelRacing');
    const bingoHub = document.getElementById('mdjBingoHub');
    const hiloHub = document.getElementById('mdjHiloHub');
    const racingHub = document.getElementById('mdjRacingHub');

    function setKind(kind) {
        picker.querySelectorAll('[data-games-kind]').forEach(function (btn) {
            const match = btn.getAttribute('data-games-kind') === kind;
            btn.classList.toggle('active', match);
        });
        const isBingo = kind === 'bingo';
        const isHilo = kind === 'hilo';
        const isRace = kind === 'horse' || kind === 'dog';
        if (bingoPanel) bingoPanel.hidden = !isBingo;
        if (hiloPanel) hiloPanel.hidden = !isHilo;
        if (racingPanel) racingPanel.hidden = !isRace;
        if (bingoHub) bingoHub.hidden = !isBingo;
        if (hiloHub) hiloHub.hidden = !isHilo;
        if (racingHub) racingHub.hidden = !isRace;
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

})();
