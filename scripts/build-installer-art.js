'use strict';

/**
 * Draws the Windows installer's artwork in the Kawaii Dark palette:
 *   installer/sidebar.bmp  164x314, Welcome and Finish pages (also the uninstaller's)
 *   installer/header.bmp   150x57,  top of the other pages
 * NSIS only takes 24-bit BMP, which sharp cannot write, so the pixels are encoded here.
 * The colours must match MUI_BGCOLOR in installer/installer.nsh.
 *
 *   node scripts/build-installer-art.js
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'installer');
const LOGO = path.join(ROOT, 'src', 'assets', 'icons', 'icon-256.png');

const BG = '#152535';
const BG_DEEP = '#0f1c2a';
const ACCENT = '#88c9ea';
const TEXT = '#e0f0ff';
const MUTED = '#8fb3cc';

/** 24-bit bottom-up BMP from raw RGB pixels. */
function encodeBmp(rgb, width, height) {
    const rowSize = Math.ceil((width * 3) / 4) * 4;
    const size = 54 + rowSize * height;
    const buf = Buffer.alloc(size);
    buf.write('BM', 0);
    buf.writeUInt32LE(size, 2);
    buf.writeUInt32LE(54, 10);
    buf.writeUInt32LE(40, 14);
    buf.writeInt32LE(width, 18);
    buf.writeInt32LE(height, 22);
    buf.writeUInt16LE(1, 26);
    buf.writeUInt16LE(24, 28);
    buf.writeUInt32LE(rowSize * height, 34);
    buf.writeInt32LE(2835, 38);
    buf.writeInt32LE(2835, 42);
    for (let y = 0; y < height; y++) {
        const row = 54 + (height - 1 - y) * rowSize;
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 3;
            buf[row + x * 3] = rgb[i + 2];
            buf[row + x * 3 + 1] = rgb[i + 1];
            buf[row + x * 3 + 2] = rgb[i];
        }
    }
    return buf;
}

async function render(svg, width, height, logo, file) {
    const layers = [];
    if (logo) {
        const img = await sharp(LOGO).resize(logo.size, logo.size).png().toBuffer();
        layers.push({ input: img, left: logo.left, top: logo.top });
    }
    const { data, info } = await sharp(Buffer.from(svg))
        .composite(layers)
        .flatten({ background: BG })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    if (info.width !== width || info.height !== height) throw new Error(`${file}: got ${info.width}x${info.height}`);
    fs.writeFileSync(path.join(OUT, file), encodeBmp(data, width, height));
    // A PNG copy to look at; not used by the build.
    await sharp(data, { raw: { width, height, channels: 3 } }).png().toFile(path.join(OUT, file.replace('.bmp', '.preview.png')));
}

const FONT = "font-family=\"Segoe UI Variable Display, Segoe UI, sans-serif\"";

const sidebar = `<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="${BG}"/>
      <stop offset="1" stop-color="${BG_DEEP}"/>
    </linearGradient>
  </defs>
  <rect width="164" height="314" fill="url(#g)"/>
  <circle cx="-10" cy="-6" r="70" fill="${ACCENT}" opacity="0.10"/>
  <circle cx="170" cy="300" r="64" fill="${ACCENT}" opacity="0.08"/>
  <circle cx="132" cy="44" r="7" fill="none" stroke="${TEXT}" stroke-opacity="0.18" stroke-width="1.5"/>
  <circle cx="26" cy="226" r="5" fill="none" stroke="${TEXT}" stroke-opacity="0.16" stroke-width="1.5"/>
  <circle cx="140" cy="196" r="3.5" fill="none" stroke="${TEXT}" stroke-opacity="0.16" stroke-width="1.5"/>
  <circle cx="82" cy="104" r="50" fill="${ACCENT}" opacity="0.10"/>
  <text x="82" y="190" text-anchor="middle" ${FONT} font-size="21" font-weight="700" fill="${TEXT}">Sameko</text>
  <text x="82" y="212" text-anchor="middle" ${FONT} font-size="13" font-weight="600" fill="${ACCENT}">Dev C++</text>
  <rect x="62" y="228" width="40" height="4" rx="2" fill="${ACCENT}" opacity="0.55"/>
  <text x="82" y="290" text-anchor="middle" ${FONT} font-size="9.5" fill="${MUTED}">GCC · GDB · clangd</text>
</svg>`;

const header = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="57">
  <rect width="150" height="57" fill="${BG}"/>
  <circle cx="150" cy="0" r="40" fill="${ACCENT}" opacity="0.10"/>
  <text x="140" y="27" text-anchor="end" ${FONT} font-size="15" font-weight="700" fill="${TEXT}">Sameko</text>
  <text x="140" y="43" text-anchor="end" ${FONT} font-size="10" font-weight="600" fill="${ACCENT}">Dev C++</text>
</svg>`;

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    await render(sidebar, 164, 314, { size: 84, left: 40, top: 62 }, 'sidebar.bmp');
    await render(header, 150, 57, { size: 38, left: 8, top: 10 }, 'header.bmp');
    console.log('installer/sidebar.bmp, installer/header.bmp written');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
