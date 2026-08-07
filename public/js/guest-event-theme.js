/**
 * Guest hub event theme CSS (keep in sync with views/partials/guest-event-theme.ejs)
 */
(function (global) {
    const DEFAULT_HUB_BG = 'linear-gradient(145deg, #0a0a0a 0%, #111111 50%, #0d0d0d 100%)';

    function escapeCssUrl(url) {
        return String(url).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    }

    function buildGuestEventThemeCss(scope, theme) {
        const t = theme || {};
        const parts = [];
        const vars = [];

        if (t.heading_color) vars.push(`--event-heading-color: ${t.heading_color};`);
        if (t.text_color) vars.push(`--event-text-color: ${t.text_color};`);
        if (t.bg_color) vars.push(`--event-bg-color: ${t.bg_color};`);
        if (t.accent_color) vars.push(`--event-accent-color: ${t.accent_color};`);

        if (t.accent_color) {
            vars.push(`--accent: ${t.accent_color};`);
            vars.push(`--accent-secondary: color-mix(in srgb, ${t.accent_color} 65%, #ffffff);`);
            vars.push(`--accent-gradient: linear-gradient(135deg, ${t.accent_color} 0%, color-mix(in srgb, ${t.accent_color} 65%, #ffffff) 100%);`);
            vars.push(`--accent-glow: color-mix(in srgb, ${t.accent_color} 35%, transparent);`);
        }

        if (vars.length) {
            parts.push(`${scope} { ${vars.join(' ')} }`);
        }

        if (scope !== 'body') {
            parts.push(`${scope} main.container.mdj-guest-hub-main { background: transparent !important; }`);
        }

        if (t.bg_image) {
            let block = `${scope} {\n`;
            block += `  background-image: url('${escapeCssUrl(t.bg_image)}') !important;\n`;
            block += '  background-size: cover !important;\n';
            block += '  background-position: center !important;\n';
            block += '  background-repeat: no-repeat !important;\n';
            block += `  background-color: ${t.bg_color || '#0a0a0a'} !important;\n`;
            block += '}';
            parts.push(block);
        } else if (t.bg_color) {
            parts.push(`${scope} {\n  background: ${t.bg_color} !important;\n}`);
        } else if (scope !== 'body') {
            parts.push(`${scope} {\n  background: ${DEFAULT_HUB_BG};\n}`);
        }

        if (t.text_color) {
            parts.push(`${scope} { color: ${t.text_color}; }`);
            parts.push([
                `${scope} .hero-subtitle`,
                `${scope} .options-prompt`,
                `${scope} .option-card-desc`,
                `${scope} .mdj-company-foot__legal`,
                `${scope} .form-label`
            ].join(', ') + ` { color: ${t.text_color}; }`);
        }

        if (t.hero_title_color) {
            parts.push(`${scope} .hero-title {
  color: ${t.hero_title_color} !important;
  -webkit-text-fill-color: ${t.hero_title_color} !important;
  background: none !important;
  background-clip: border-box !important;
}`);
        }

        if (t.heading_color) {
            parts.push(`${scope} .option-card-title, ${scope} .name-card-title { color: ${t.heading_color} !important; }`);
        }

        if (t.guest_card_color) {
            parts.push(`${scope} .option-card, ${scope} .name-card-inner { background: ${t.guest_card_color} !important; }`);
        }

        if (t.guest_card_shadow_color) {
            const shadow = `0 12px 40px color-mix(in srgb, ${t.guest_card_shadow_color} 50%, transparent)`;
            parts.push(`${scope} .option-card, ${scope} .name-card-inner { box-shadow: ${shadow} !important; }`);
        }

        if (t.accent_color) {
            const a = t.accent_color;
            parts.push(`${scope} .btn-primary {
  background-color: ${a}; border-color: ${a};
}`);
            parts.push(`${scope} .btn-primary:hover {
  background-color: color-mix(in srgb, ${a} 85%, black);
  border-color: color-mix(in srgb, ${a} 85%, black);
}`);
            parts.push(`${scope} .text-primary { color: ${a} !important; }`);
            parts.push(`${scope} a { color: ${a}; }`);
            parts.push(`${scope} .hero-icon {
  background: linear-gradient(135deg, ${a} 0%, color-mix(in srgb, ${a} 65%, #ffffff) 100%) !important;
  box-shadow: 0 8px 32px color-mix(in srgb, ${a} 40%, transparent) !important;
}`);
            parts.push(`${scope} .guest-hub-messages-btn {
  background: color-mix(in srgb, ${a} 14%, transparent) !important;
  border-color: color-mix(in srgb, ${a} 45%, transparent) !important;
}`);
            parts.push([
                `${scope} .option-card-icon--songs`,
                `${scope} .option-card-icon--karaoke`,
                `${scope} .option-card-icon--message`
            ].join(', ') + ` {
  background: linear-gradient(135deg, color-mix(in srgb, ${a} 22%, transparent), color-mix(in srgb, ${a} 6%, transparent)) !important;
  color: ${a} !important;
  box-shadow: 0 4px 16px color-mix(in srgb, ${a} 18%, transparent) !important;
}`);
            parts.push(`${scope} .option-card:hover .option-card-arrow { color: ${a}; }`);
            parts.push(`${scope} .btn-warning { background-color: ${a}; border-color: ${a}; color: #fff; }`);
            parts.push(`${scope} .btn-warning:hover, ${scope} .btn-warning:focus { background-color: color-mix(in srgb, ${a} 85%, black); border-color: color-mix(in srgb, ${a} 85%, black); }`);
            parts.push(`body.mdj-eyup-brand .mdj-site-navbar { background-color: ${a} !important; border-bottom-color: ${a} !important; }`);
        }

        if (t.custom_css) parts.push(t.custom_css);
        return parts.join('\n');
    }

    global.buildGuestEventThemeCss = buildGuestEventThemeCss;
    global.escapeGuestThemeCssUrl = escapeCssUrl;

    /** Built-in guest hub themes (null/ omitted color = EYUP default for that slot) */
    global.GUEST_THEME_PRESETS = [
        {
            id: 'eyup',
            name: 'EYUP Dark',
            swatch: ['#0a0a0a', '#ff6b00', '#f0f0f5'],
            theme: {}
        },
        {
            id: 'midnight',
            name: 'Midnight',
            swatch: ['#0a0a12', '#6366f1', '#c7d2fe'],
            theme: {
                bg_color: '#0a0a12',
                accent_color: '#6366f1',
                hero_title_color: '#a5b4fc',
                heading_color: '#e0e7ff',
                text_color: '#94a3b8',
                guest_card_color: 'rgba(99,102,241,0.12)',
                guest_card_shadow_color: '#1e1b4b'
            }
        },
        {
            id: 'ocean',
            name: 'Ocean',
            swatch: ['#041824', '#00cec9', '#7dd3fc'],
            theme: {
                bg_color: '#041824',
                accent_color: '#00cec9',
                hero_title_color: '#22d3ee',
                heading_color: '#7dd3fc',
                text_color: '#94a3b8',
                guest_card_color: 'rgba(0,206,201,0.12)',
                guest_card_shadow_color: '#004e92'
            }
        },
        {
            id: 'neon',
            name: 'Neon',
            swatch: ['#0b0b14', '#ff00e6', '#9fe8ff'],
            theme: {
                bg_color: '#0b0b14',
                accent_color: '#ff00e6',
                hero_title_color: '#ff9df3',
                heading_color: '#9fe8ff',
                text_color: '#c9d4e0',
                guest_card_color: 'rgba(255,0,230,0.1)',
                guest_card_shadow_color: '#ff00e6'
            }
        },
        {
            id: 'wedding',
            name: 'Elegant',
            swatch: ['#faf7f2', '#d4af37', '#5c534a'],
            theme: {
                bg_color: '#faf7f2',
                accent_color: '#d4af37',
                hero_title_color: '#8a6d1d',
                heading_color: '#6b5b1e',
                text_color: '#5c534a',
                guest_card_color: 'rgba(255,255,255,0.92)',
                guest_card_shadow_color: '#d4af37'
            }
        },
        {
            id: 'forest',
            name: 'Forest',
            swatch: ['#0d1a0f', '#22c55e', '#bbf7d0'],
            theme: {
                bg_color: '#0d1a0f',
                accent_color: '#22c55e',
                hero_title_color: '#4ade80',
                heading_color: '#bbf7d0',
                text_color: '#86efac',
                guest_card_color: 'rgba(34,197,94,0.1)',
                guest_card_shadow_color: '#14532d'
            }
        },
        {
            id: 'ruby',
            name: 'Ruby',
            swatch: ['#1a0808', '#e11d48', '#fecdd3'],
            theme: {
                bg_color: '#1a0808',
                accent_color: '#e11d48',
                hero_title_color: '#fb7185',
                heading_color: '#fecdd3',
                text_color: '#fda4af',
                guest_card_color: 'rgba(225,29,72,0.12)',
                guest_card_shadow_color: '#881337'
            }
        }
    ];
})(typeof window !== 'undefined' ? window : globalThis);
