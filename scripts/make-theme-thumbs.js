// Builds the still wallpaper thumbnails that the theme cards in Settings and the Marketplace
// show for builtin themes: one frame of each src/assets/backgrounds/<name>.webm, saved as
// src/assets/backgrounds/thumbs/<name>.webp. Run it again after adding or replacing a video:
//   npx electron scripts/make-theme-thumbs.js [seconds=1]
'use strict';
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const DIR = path.join(__dirname, '..', 'src', 'assets', 'backgrounds');
const OUT = path.join(DIR, 'thumbs');
const WIDTH = 480;
const AT = Number(process.argv.find((a, i) => i > 1 && /^\d+(\.\d+)?$/.test(a)) || 1);

app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
    await win.loadURL('about:blank');
    fs.mkdirSync(OUT, { recursive: true });
    const videos = fs.readdirSync(DIR).filter(f => /\.(webm|mp4)$/i.test(f));
    for (const file of videos) {
        const b64 = fs.readFileSync(path.join(DIR, file)).toString('base64');
        const type = /\.mp4$/i.test(file) ? 'video/mp4' : 'video/webm';
        // A blob URL keeps the frame same-origin, so the canvas is not tainted.
        const result = await win.webContents.executeJavaScript(`(async () => {
            const bytes = Uint8Array.from(atob(${JSON.stringify(b64)}), c => c.charCodeAt(0));
            const video = document.createElement('video');
            video.muted = true;
            video.src = URL.createObjectURL(new Blob([bytes], { type: ${JSON.stringify(type)} }));
            await new Promise((ok, fail) => { video.onloadedmetadata = ok; video.onerror = () => fail(new Error('decode')); });
            video.currentTime = Math.min(${AT}, video.duration / 2 || 0);
            await new Promise(ok => { video.onseeked = ok; });
            const canvas = document.createElement('canvas');
            canvas.width = ${WIDTH};
            canvas.height = Math.round(${WIDTH} * video.videoHeight / video.videoWidth);
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            return { url: canvas.toDataURL('image/webp', 0.8), w: video.videoWidth, h: video.videoHeight, d: video.duration };
        })()`);
        const name = file.replace(/\.(webm|mp4)$/i, '.webp');
        const data = Buffer.from(result.url.split(',')[1], 'base64');
        fs.writeFileSync(path.join(OUT, name), data);
        console.log(`${name}  ${result.w}x${result.h}  ${result.d.toFixed(1)}s  ${(data.length / 1024).toFixed(1)} KB`);
    }
    app.quit();
}).catch(err => { console.error(err); app.exit(1); });
