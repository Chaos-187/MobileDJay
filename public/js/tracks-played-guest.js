// Guest "Recently Played" button + modal (song request page, etc.)
(function () {
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }

    function formatTime(iso) {
        try {
            return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch {
            return '';
        }
    }

    function initTracksPlayedGuest(eventSlug) {
        const listEl = document.getElementById('tracksPlayedModalList');
        const countEl = document.getElementById('tracksPlayedCount');
        const btnEl = document.getElementById('tracksPlayedBtn');
        if (!listEl || !eventSlug) return;

        function renderTracks(tracks) {
            if (!Array.isArray(tracks) || tracks.length === 0) {
                listEl.innerHTML = '<li class="tracks-played-empty text-muted">No tracks logged yet — check back soon!</li>';
                if (countEl) countEl.textContent = '0 tracks';
                return;
            }
            if (countEl) {
                countEl.textContent = tracks.length + (tracks.length === 1 ? ' track' : ' tracks');
            }
            listEl.innerHTML = tracks.map(function (track, i) {
                const isLatest = i === 0;
                return '<li class="tracks-played-item' + (isLatest ? ' tracks-played-item--latest' : '') + '">' +
                    '<span class="tracks-played-time">' + escapeHtml(formatTime(track.playedAt)) + '</span>' +
                    '<span class="tracks-played-track">' +
                        '<strong>' + escapeHtml(track.title) + '</strong>' +
                        (track.artist ? '<span class="tracks-played-artist">' + escapeHtml(track.artist) + '</span>' : '') +
                    '</span>' +
                '</li>';
            }).join('');
        }

        async function loadTracksPlayed() {
            try {
                const res = await fetch('/api/event/' + encodeURIComponent(eventSlug) + '/tracks-played?limit=30');
                const tracks = await res.json();
                renderTracks(tracks);
            } catch (err) {
                console.error('Error loading tracks played:', err);
                listEl.innerHTML = '<li class="tracks-played-empty text-muted">Could not load tracks. Try again later.</li>';
                if (countEl) countEl.textContent = '—';
            }
        }

        if (btnEl) {
            btnEl.addEventListener('click', loadTracksPlayed);
        }

        loadTracksPlayed();
        setInterval(loadTracksPlayed, 15000);
    }

    document.addEventListener('DOMContentLoaded', function () {
        const slug = window.eventSlug || '';
        if (slug && document.getElementById('tracksPlayedModalList')) {
            initTracksPlayedGuest(slug);
        }
    });
})();
