/**
 * Sameko Dev C++ IDE - Formatting Style Configurations
 * AStyle style presets
 * @module app/services/formatter/styles
 */

'use strict';

/**
 * AStyle arguments for different style presets
 */
const STYLE_ARGS = {
    'google': [
        '--style=google',
        '--indent=spaces=4',
        '--attach-namespaces',
        '--attach-classes',
        '--attach-inlines',
        '--add-braces',
        '--align-pointer=type'
    ],
    'allman': [
        '--style=allman',
        '--indent=spaces=4'
    ],
    'java': [
        '--style=java',
        '--indent=spaces=4'
    ],
    'kr': [
        '--style=kr',
        '--indent=spaces=4'
    ],
    'stroustrup': [
        '--style=stroustrup',
        '--indent=spaces=4'
    ],
    'whitesmith': [
        '--style=whitesmith',
        '--indent=spaces=4'
    ],
    'vtk': [
        '--style=vtk',
        '--indent=spaces=4'
    ],
    'ratliff': [
        '--style=ratliff',
        '--indent=spaces=4'
    ],
    'gnu': [
        '--style=gnu',
        '--indent=spaces=4'
    ],
    'linux': [
        '--style=linux',
        '--indent=spaces=4'
    ],
    'horstmann': [
        '--style=horstmann',
        '--indent=spaces=4'
    ],
    'lisp': [
        '--style=lisp',
        '--indent=spaces=4'
    ],
    'pico': [
        '--style=pico',
        '--indent=spaces=4'
    ],
};

/**
 * Get style arguments for AStyle
 * @param {string} style - Style name
 * @returns {string[]}
 */
function getStyleArgs(style) {
    return STYLE_ARGS[style] || STYLE_ARGS['google'];
}

module.exports = {
    STYLE_ARGS,
    getStyleArgs,
};
