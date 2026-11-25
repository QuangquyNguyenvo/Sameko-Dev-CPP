#!/usr/bin/env node
'use strict';

/*
 * Reads `displayplacer list` output and prints the argument that switches the main screen to
 * the largest Retina (scaling:on) mode up to 1920 wide, else the largest mode up to 1920 wide.
 * Prints nothing when the screen offers no other mode. Used by .github/workflows/mac-check.yml.
 *
 *   node test/mac/pick-display.js <displayplacer-list.txt>
 */

const fs = require('node:fs');

const text = fs.readFileSync(process.argv[2], 'utf8');
const id = /Persistent screen id:\s*(\S+)/.exec(text)?.[1];
if (!id) process.exit(0);
const block = text.split(/Persistent screen id:/)[1] || '';
const modes = [...block.matchAll(/mode \d+: res:(\d+)x(\d+) hz:(\d+) color_depth:(\d+)( scaling:on)?/g)].map((m) => ({
    w: +m[1], h: +m[2], hz: +m[3], depth: +m[4], hidpi: !!m[5],
})).filter((m) => m.w <= 1920 && m.w >= 1024);
const best = (list) => list.sort((a, b) => b.w * b.h - a.w * a.h || b.hz - a.hz)[0];
const pick = best(modes.filter((m) => m.hidpi && m.w >= 1280)) || best(modes);
if (!pick) process.exit(0);
process.stdout.write(`"id:${id} res:${pick.w}x${pick.h} hz:${pick.hz} color_depth:${pick.depth}${pick.hidpi ? ' scaling:on' : ''} origin:(0,0) degree:0"`);
