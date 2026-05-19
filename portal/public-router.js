const express = require('express');
const { getSiteSettings } = require('./site-settings-service');

const router = express.Router();

router.get('/site-settings', (req, res, next) => {
    try {
        const settings = getSiteSettings();
        res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
        res.json(settings);
    } catch (e) {
        next(e);
    }
});

module.exports = router;
