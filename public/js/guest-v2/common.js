/**
 * Guest Hub v2 — shared helpers (name guard for flow pages).
 */
(function (global) {
    'use strict';

    function ensureGuestName(cfg) {
        cfg = cfg || global.GuestV2Config || {};
        var slug = cfg.eventSlug || global.eventSlug || '';
        var hub = cfg.v2Base || '';
        var guestSession = global.MdjGuestSession;
        var fromQuery = new URLSearchParams(global.location.search).get('customerName') || '';
        var stored = guestSession ? guestSession.getGuestName(slug) : sessionStorage.getItem('customerName') || '';
        var name = (fromQuery || stored || '').trim();
        if (!name) {
            global.location.replace(hub + '?edit=true');
            return '';
        }
        if (guestSession) guestSession.setGuestName(slug, name);
        else sessionStorage.setItem('customerName', name);
        return name;
    }

    global.GuestV2 = {
        ensureGuestName: ensureGuestName
    };
})(typeof window !== 'undefined' ? window : globalThis);
