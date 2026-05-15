/** Default playlist shape per events-portal-api-spec §3.4 */
function emptyPlaylist() {
    return {
        must_play: [],
        dont_play: [],
        dont_play_early: [],
        floor_fillers: [],
        first_dance: '',
        last_dance: '',
        parent_dances: ''
    };
}

function normalizePlaylist(raw) {
    const base = emptyPlaylist();
    if (!raw || typeof raw !== 'object') return base;
    return {
        must_play: Array.isArray(raw.must_play) ? raw.must_play.map(String) : [],
        dont_play: Array.isArray(raw.dont_play) ? raw.dont_play.map(String) : [],
        dont_play_early: Array.isArray(raw.dont_play_early) ? raw.dont_play_early.map(String) : [],
        floor_fillers: Array.isArray(raw.floor_fillers) ? raw.floor_fillers.map(String) : [],
        first_dance: raw.first_dance != null ? String(raw.first_dance) : '',
        last_dance: raw.last_dance != null ? String(raw.last_dance) : '',
        parent_dances: raw.parent_dances != null ? String(raw.parent_dances) : ''
    };
}

/** Plain-text summary for DJ UI (aligned with typical formatPlaylistSummary mock). */
function formatMusicPlanSummary(payload) {
    const p = normalizePlaylist(payload);
    const lines = [];
    const pushHeading = (h) => {
        if (lines.length) lines.push('');
        lines.push(h);
    };
    if (p.must_play.length) {
        pushHeading('Must play');
        p.must_play.forEach((x) => lines.push(`• ${x}`));
    }
    if (p.dont_play.length) {
        pushHeading("Don't play");
        p.dont_play.forEach((x) => lines.push(`• ${x}`));
    }
    if (p.dont_play_early.length) {
        pushHeading("Don't play early (ceremony / speeches)");
        p.dont_play_early.forEach((x) => lines.push(`• ${x}`));
    }
    if (p.floor_fillers.length) {
        pushHeading('Floor fillers');
        p.floor_fillers.forEach((x) => lines.push(`• ${x}`));
    }
    if (p.first_dance) {
        pushHeading('First dance');
        lines.push(p.first_dance);
    }
    if (p.last_dance) {
        pushHeading('Last dance');
        lines.push(p.last_dance);
    }
    if (p.parent_dances) {
        pushHeading('Parent dances');
        lines.push(p.parent_dances);
    }
    return lines.join('\n');
}

function parsePayloadRow(row) {
    if (!row || !row.payload) return emptyPlaylist();
    try {
        return normalizePlaylist(JSON.parse(row.payload));
    } catch {
        return emptyPlaylist();
    }
}

module.exports = { emptyPlaylist, normalizePlaylist, formatMusicPlanSummary, parsePayloadRow };
