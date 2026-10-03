/**
 * Color Registry v2 - Simplified Color Groups
 * 
 * Replaces 40+ individual colors with 7 intuitive groups.
 * Changing one group color auto-derives all related element colors.
 *
 * Groups:
 * 1. Background - darkest layer (editor, terminal, input)
 * 2. Surface - panels, headers, cards
 * 3. Accent - brand color, highlights
 * 4. Text - primary/secondary/muted (auto-derived)
 * 5. Border - all borders and separators
 * 6. Status - success/error/warning
 * 7. Syntax - code highlighting
 * 
 * @author Sameko Team
 */

const ColorRegistry = {
    /**
     * Color Groups Definition
     * Each group has:
     * - label: Display name
     * - description: UI tooltip
     * - members: Keys that belong to this group
     * - baseKey: The primary key used for the color picker
     */
    groups: {
        background: {
            label: 'Background',
            description: 'Main app background - darkest layer',
            icon: 'moon',
            baseKey: 'bgBase',
            members: ['bgOceanDark', 'editorBg', 'bgInput', 'terminalBg', 'bgOceanMedium']
        },
        surface: {
            label: 'Surface',
            description: 'Panels, headers, cards - slightly lighter',
            icon: 'layers',
            baseKey: 'bgSurface',
            members: ['bgPanel', 'bgHeader', 'bgGlass', 'bgGlassHeavy', 'bgButton', 'bgButtonHover', 'bgOceanLight']
        },
        accent: {
            label: 'Accent',
            description: 'Brand color - buttons, links, highlights',
            icon: 'star',
            baseKey: 'accent',
            members: ['accent', 'accentHover', 'bgOceanDeep', 'borderStrong']
        },
        text: {
            label: 'Text',
            description: 'Text colors - auto 3 levels',
            icon: 'type',
            baseKey: 'textPrimary',
            members: ['textPrimary', 'textSecondary', 'textMuted', 'settingsLabelColor']
        },
        border: {
            label: 'Border',
            description: 'Borders and separators',
            icon: 'square',
            baseKey: 'border',
            members: ['border', 'bgGlassBorder']
        },
        status: {
            label: 'Status',
            description: 'Success, error, warning colors',
            icon: 'activity',
            baseKey: null, // Has 3 separate pickers
            members: ['success', 'error', 'warning']
        },
        syntax: {
            label: 'Syntax',
            description: 'Code syntax highlighting',
            icon: 'code',
            baseKey: null, // Has multiple pickers
            members: ['syntaxKeyword', 'syntaxString', 'syntaxNumber', 'syntaxType', 'syntaxFunction', 'syntaxComment']
        }
    },

    /**
     * CSS Variable Mappings
     * Maps internal keys to CSS custom properties
     */
    _cssVars: {
        // Background group
        'bgBase': '--bg-base',
        'bgOceanDark': '--bg-ocean-dark',
        'bgOceanMedium': '--bg-ocean-medium',
        'bgOceanLight': '--bg-ocean-light',
        'bgOceanDeep': '--bg-ocean-deep',
        'editorBg': '--editor-bg',
        'bgInput': '--bg-input',
        'terminalBg': '--terminal-bg',

        // Surface group
        'bgSurface': '--bg-surface',
        'bgPanel': '--bg-panel',
        'bgHeader': '--bg-header',
        'bgGlass': '--bg-glass',
        'bgGlassHeavy': '--bg-glass-heavy',
        'bgButton': '--bg-button',
        'bgButtonHover': '--bg-button-hover',

        // Accent group
        'accent': '--accent',
        'accentHover': '--accent-hover',
        'borderStrong': '--border-strong',

        // Text group
        'textPrimary': '--text-primary',
        'textSecondary': '--text-secondary',
        'textMuted': '--text-muted',
        'settingsLabelColor': '--settings-label-color',
        'settingsSectionColor': '--settings-section-color',

        // Border group
        'border': '--border',
        'bgGlassBorder': '--bg-glass-border',

        // Status group
        'success': '--success',
        'error': '--error',
        'warning': '--warning',

        // Syntax group
        'syntaxKeyword': '--syntax-keyword',
        'syntaxString': '--syntax-string',
        'syntaxNumber': '--syntax-number',
        'syntaxType': '--syntax-type',
        'syntaxFunction': '--syntax-function',
        'syntaxComment': '--syntax-comment',
        'syntaxOperator': '--syntax-operator',
        'syntaxBracket': '--syntax-bracket',

        // Effects (kept for compatibility)
        'bgOpacity': '--app-bg-opacity',
        'editorBgOpacity': '--editor-bg-opacity',
        'terminalOpacity': '--terminal-opacity',
        'bgBlur': '--app-bg-blur',
        'editorBgBlur': '--editor-bg-blur',
        'terminalBgBlur': '--terminal-bg-blur'
    },

    /**
     * Color manipulation utilities
     */
    _utils: {
        /**
         * Parse hex to RGB
         */
        hexToRgb(hex) {
            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return result ? {
                r: parseInt(result[1], 16),
                g: parseInt(result[2], 16),
                b: parseInt(result[3], 16)
            } : null;
        },

        /**
         * RGB to hex
         */
        rgbToHex(r, g, b) {
            return '#' + [r, g, b].map(x => {
                const hex = Math.max(0, Math.min(255, Math.round(x))).toString(16);
                return hex.length === 1 ? '0' + hex : hex;
            }).join('');
        },

        /**
         * Lighten a color by percentage
         */
        lighten(hex, percent) {
            const rgb = this.hexToRgb(hex);
            if (!rgb) return hex;
            const amount = percent / 100;
            return this.rgbToHex(
                rgb.r + (255 - rgb.r) * amount,
                rgb.g + (255 - rgb.g) * amount,
                rgb.b + (255 - rgb.b) * amount
            );
        },

        /**
         * Darken a color by percentage
         */
        darken(hex, percent) {
            const rgb = this.hexToRgb(hex);
            if (!rgb) return hex;
            const amount = 1 - (percent / 100);
            return this.rgbToHex(
                rgb.r * amount,
                rgb.g * amount,
                rgb.b * amount
            );
        },

        /**
         * Convert hex to rgba string
         */
        toRgba(hex, alpha) {
            const rgb = this.hexToRgb(hex);
            if (!rgb) return hex;
            return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
        },

        /**
         * Adjust saturation
         */
        desaturate(hex, percent) {
            const rgb = this.hexToRgb(hex);
            if (!rgb) return hex;
            const gray = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
            const amount = percent / 100;
            return this.rgbToHex(
                rgb.r + (gray - rgb.r) * amount,
                rgb.g + (gray - rgb.g) * amount,
                rgb.b + (gray - rgb.b) * amount
            );
        }
    },

    /**
     * Derive all member colors from a group's base color
     * @param {string} groupId - Group identifier
     * @param {string} baseColor - Base hex color
     * @returns {object} Map of key -> derived color
     */
    deriveGroupColors(groupId, baseColor) {
        const utils = this._utils;

        switch (groupId) {
            case 'background':
                return {
                    bgBase: baseColor,
                    bgOceanDark: baseColor,
                    editorBg: baseColor,
                    bgInput: utils.lighten(baseColor, 5),
                    terminalBg: utils.lighten(baseColor, 3),
                    bgOceanMedium: utils.lighten(baseColor, 8)
                };

            case 'surface':
                return {
                    bgSurface: baseColor,
                    bgPanel: utils.toRgba(baseColor, 0.95),
                    bgHeader: utils.toRgba(utils.darken(baseColor, 10), 0.97),
                    bgGlass: utils.toRgba(baseColor, 0.92),
                    bgGlassHeavy: utils.toRgba(baseColor, 0.97),
                    bgButton: utils.lighten(baseColor, 10),
                    bgButtonHover: utils.lighten(baseColor, 20),
                    bgOceanLight: utils.lighten(baseColor, 15)
                };

            case 'accent':
                return {
                    accent: baseColor,
                    accentHover: utils.lighten(baseColor, 15),
                    bgOceanDeep: baseColor,
                    borderStrong: baseColor,
                    settingsSectionColor: baseColor
                };

            case 'text':
                return {
                    textPrimary: baseColor,
                    textSecondary: utils.desaturate(utils.darken(baseColor, 20), 20),
                    textMuted: utils.desaturate(utils.darken(baseColor, 40), 30),
                    settingsLabelColor: baseColor
                };

            case 'border':
                return {
                    border: baseColor,
                    bgGlassBorder: utils.toRgba(baseColor, 0.9)
                };

            default:
                return {};
        }
    },

    /**
     * Get CSS variable name for a color key
     */
    getCssVar(colorKey) {
        return this._cssVars[colorKey] || null;
    },

    /**
     * Get all keys in a group
     */
    getGroupMembers(groupId) {
        return this.groups[groupId]?.members || [];
    },

    /**
     * Get group info
     */
    getGroup(groupId) {
        return this.groups[groupId] || null;
    },

    /**
     * Get all group IDs
     */
    getGroupIds() {
        return Object.keys(this.groups);
    },

    /**
     * Find which group a key belongs to
     */
    getGroupForKey(key) {
        for (const [groupId, group] of Object.entries(this.groups)) {
            if (group.members.includes(key)) {
                return groupId;
            }
        }
        return null;
    },

    /**
     * Get all CSS variable mappings
     */
    getAllCssVars() {
        return { ...this._cssVars };
    },

    /**
     * Get SVG icon for an icon type
     * Used by UI components to render color group icons
     */
    getIconSvg(iconType) {
        const icons = {
            moon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
            layers: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
            star: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
            type: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
            square: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>',
            activity: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
            code: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>'
        };
        return icons[iconType] || '';
    }
};

// Freeze to prevent modifications
Object.freeze(ColorRegistry.groups);
Object.freeze(ColorRegistry._cssVars);
Object.freeze(ColorRegistry);

// Make globally available
window.ColorRegistry = ColorRegistry;

