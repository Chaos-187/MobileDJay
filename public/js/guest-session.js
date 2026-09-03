/**
 * Guest identity on event pages — per-event display name + stable device id.
 */
(function (global) {
    'use strict';

    function deviceId() {
        try {
            var key = 'mdjDeviceId';
            var id = localStorage.getItem(key);
            if (id && String(id).trim()) return String(id).trim();
            id =
                typeof crypto !== 'undefined' && crypto.randomUUID
                    ? crypto.randomUUID()
                    : 'd-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
            localStorage.setItem(key, id);
            return id;
        } catch (e) {
            return 'd-anon-' + Math.random().toString(36).slice(2, 12);
        }
    }

    function nameStorageKey(eventSlug) {
        var slug = eventSlug != null ? String(eventSlug).trim() : '';
        return slug ? 'mdjGuestName:' + slug : 'mdjGuestName';
    }

    function getGuestName(eventSlug) {
        var slug = eventSlug != null ? String(eventSlug).trim() : global.eventSlug || '';
        try {
            var perEvent = sessionStorage.getItem(nameStorageKey(slug));
            if (perEvent && String(perEvent).trim()) return String(perEvent).trim();
            var legacy = sessionStorage.getItem('customerName');
            return legacy && String(legacy).trim() ? String(legacy).trim() : '';
        } catch (e) {
            return '';
        }
    }

    function setGuestName(eventSlug, name) {
        var slug = eventSlug != null ? String(eventSlug).trim() : global.eventSlug || '';
        var trimmed = name != null ? String(name).trim() : '';
        try {
            if (slug) sessionStorage.setItem(nameStorageKey(slug), trimmed);
            sessionStorage.setItem('customerName', trimmed);
        } catch (e) {
            /* ignore */
        }
    }

    function activityUrl(customerName, eventSlug) {
        var url = '/api/customer/activity/' + encodeURIComponent(customerName);
        var slug = eventSlug != null ? String(eventSlug).trim() : global.eventSlug || '';
        if (slug) url += '?eventSlug=' + encodeURIComponent(slug);
        return url;
    }

    function repliesUrl(customerName, eventSlug) {
        var url = '/api/customer/replies/' + encodeURIComponent(customerName);
        var slug = eventSlug != null ? String(eventSlug).trim() : global.eventSlug || '';
        if (slug) url += '?eventSlug=' + encodeURIComponent(slug);
        return url;
    }

    function registerCheckin(customerName, eventSlug) {
        var slug = eventSlug != null ? String(eventSlug).trim() : global.eventSlug || '';
        if (!slug || !customerName) return Promise.resolve({ ok: true, skipped: true });
        return fetch('/api/event/' + encodeURIComponent(slug) + '/guest-checkin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customerName: customerName, deviceId: deviceId() })
        })
            .then(function (res) {
                return res.json().then(function (data) {
                    return { ok: res.ok, status: res.status, data: data };
                });
            })
            .catch(function () {
                return { ok: false, status: 0, data: { error: 'network_error' } };
            });
    }

    global.MdjGuestSession = {
        deviceId: deviceId,
        nameStorageKey: nameStorageKey,
        getGuestName: getGuestName,
        setGuestName: setGuestName,
        activityUrl: activityUrl,
        repliesUrl: repliesUrl,
        registerCheckin: registerCheckin
    };
})(typeof window !== 'undefined' ? window : globalThis);
