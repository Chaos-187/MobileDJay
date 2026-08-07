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
})(typeof window !== 'undefined' ? window : globalThis);
