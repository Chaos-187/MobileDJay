/**
 * Mobile bingo play for guests at /event/:slug/bingo
 */
(function () {
    const slug = window.eventSlug;
    if (!slug || !window.MdjGuestBingoPlay) return;

    const guestSession = window.MdjGuestSession;
    const play = window.MdjGuestBingoPlay.create({
        slug,
        customerName: () =>
            guestSession ? guestSession.getGuestName(slug) : sessionStorage.getItem('customerName') || '',
        deviceId: () => (guestSession ? guestSession.deviceId() : null),
        root: document,
        initialGameId: window.guestBingoGameId || null
    });

    document.addEventListener('DOMContentLoaded', function () {
        const name = guestSession ? guestSession.getGuestName(slug) : sessionStorage.getItem('customerName') || '';
        if (!name) {
            window.location.href = '/event/' + encodeURIComponent(slug) + '?edit=true';
            return;
        }
        if (guestSession && guestSession.registerCheckin) {
            guestSession.registerCheckin(name, slug);
        }
        if (play.getActiveGameId()) {
            play.startPlay();
        } else {
            play.loadGames();
        }
    });
})();