// Renders public/icon.svg into the app icons:
//   build/icon.ico   (Windows exe / installer; 16–256 px)
//   public/icon.png  (256 px; window/taskbar icon and web app icon)
//   public/icon-512.png (512 px; phone home-screen icon / splash, see public/manifest.webmanifest)
// Run with: npm run icon   (uses Electron's built-in Chromium, so no image tools are needed)
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SVG = path.join(ROOT, 'public', 'icon.svg');
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const EXTRA = 512; // web app manifest only, not in the .ico

/** ICO container holding PNG images (supported since Windows Vista). */
function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // 0 means 256
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palette colors
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // color planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  const svg = fs.readFileSync(SVG, 'utf8');
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  await win.loadURL('data:text/html,<html><body></body></html>');

  const dataUrls = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image();
    img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString('base64'))};
    await img.decode();
    return ${JSON.stringify([...SIZES, EXTRA])}.map((size) => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, size, size);
      return c.toDataURL('image/png');
    });
  })()`);

  const big = Buffer.from(dataUrls.pop().split(',')[1], 'base64');
  const pngs = dataUrls.map((url, i) => ({ size: SIZES[i], data: Buffer.from(url.split(',')[1], 'base64') }));
  fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.ico'), buildIco(pngs));
  fs.writeFileSync(path.join(ROOT, 'public', 'icon.png'), pngs[pngs.length - 1].data);
  fs.writeFileSync(path.join(ROOT, 'public', 'icon-512.png'), big);
  console.log(`icon: ${pngs.map((p) => `${p.size}px`).join(', ')} + 512px -> build/icon.ico, public/icon.png, public/icon-512.png`);
  app.quit();
});
