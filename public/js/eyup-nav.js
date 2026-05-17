/**
 * EYUP-style nav for mdj-site-navbar — mobile burger + Services accordion +
 * coarse-pointer desktop submenu (matches eyupevents.uk behaviour subset).
 */
(function () {
    'use strict';

    function mobileStackedMq() {
        return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)').matches;
    }

    function touchWideSubmenuMq() {
        if (typeof window.matchMedia !== 'function') return false;
        const wide = window.matchMedia('(min-width: 768px)').matches;
        const noHover = window.matchMedia('(hover: none)').matches;
        const coarse = window.matchMedia('(pointer: coarse)').matches;
        return wide && (noHover || coarse);
    }

    function clearDropdowns(navRoot) {
        if (!navRoot) return;
        navRoot.querySelectorAll('.nav-item-has-dropdown.submenu-open').forEach((item) => {
            item.classList.remove('submenu-open');
            const t = item.querySelector(':scope > a.nav-link');
            if (t) t.setAttribute('aria-expanded', 'false');
        });
    }

    function bindNav(rootSel) {
        const navbar = document.querySelector(rootSel);
        if (!navbar) return;

        const toggle = navbar.querySelector('.nav-toggle');
        const menu = navbar.querySelector('.nav-menu');

        toggle?.addEventListener('click', () => {
            if (!menu || !toggle) return;
            const open = !menu.classList.contains('active');
            menu.classList.toggle('active', open);
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            if (!open) clearDropdowns(navbar);
        });

        navbar.querySelectorAll('.nav-menu a').forEach((link) => {
            link.addEventListener('click', () => {
                const li = link.closest('li');
                if (
                    mobileStackedMq() &&
                    li &&
                    li.classList.contains('nav-item-has-dropdown') &&
                    link === li.querySelector(':scope > a.nav-link')
                ) {
                    return;
                }
                if (menu) menu.classList.remove('active');
                if (toggle) toggle.setAttribute('aria-expanded', 'false');
                clearDropdowns(navbar);
            });
        });

        navbar.querySelectorAll('.nav-item-has-dropdown').forEach((item) => {
            const trigger = item.querySelector(':scope > a.nav-link');
            if (!trigger) return;
            trigger.setAttribute('aria-haspopup', 'true');
            trigger.setAttribute('aria-expanded', 'false');

            trigger.addEventListener('click', (e) => {
                if (mobileStackedMq()) {
                    e.preventDefault();
                    const isOpen = item.classList.contains('submenu-open');
                    navbar.querySelectorAll('.nav-item-has-dropdown').forEach((i) => {
                        if (i !== item) {
                            i.classList.remove('submenu-open');
                            const o = i.querySelector(':scope > a.nav-link');
                            if (o) o.setAttribute('aria-expanded', 'false');
                        }
                    });
                    if (isOpen) {
                        item.classList.remove('submenu-open');
                        trigger.setAttribute('aria-expanded', 'false');
                    } else {
                        item.classList.add('submenu-open');
                        trigger.setAttribute('aria-expanded', 'true');
                    }
                    return;
                }

                if (touchWideSubmenuMq()) {
                    e.preventDefault();
                    const open = item.classList.contains('submenu-open');
                    clearDropdowns(navbar);
                    if (!open) {
                        item.classList.add('submenu-open');
                        trigger.setAttribute('aria-expanded', 'true');
                    }
                }
            });
        });

        document.addEventListener('click', (event) => {
            if (!touchWideSubmenuMq()) return;
            if (event.target.closest('.nav-item-has-dropdown')) return;
            clearDropdowns(navbar);
        });

        window.addEventListener('resize', () => clearDropdowns(navbar));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => bindNav('.mdj-site-navbar'));
    } else {
        bindNav('.mdj-site-navbar');
    }
})();
