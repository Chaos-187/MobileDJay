/** @deprecated — use require('./bingo'); kept so older deploys with this file still work */
module.exports = {
    BINGO_THEMES: require('./bingo').BINGO_THEMES,
    normalizeBingoTheme: require('./bingo').normalizeBingoTheme,
    listBingoThemes: require('./bingo').listBingoThemes
};