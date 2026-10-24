'use strict';

const astyle = require('./astyle');
const styles = require('./styles');

module.exports = {
    // AStyle
    detectAStyle: astyle.detectAStyle,
    getAStylePath: astyle.getAStylePath,
    checkAStyle: astyle.checkAStyle,
    formatCode: astyle.formatCode,

    // Styles
    STYLE_ARGS: styles.STYLE_ARGS,
    getStyleArgs: styles.getStyleArgs,
};
