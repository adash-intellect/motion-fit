// MotionFit desktop shell: a full-screen window that serves the built web app from the package.
//   npm run desktop         build, then run
//   npm run desktop:dev     run against the Vite dev server (npm run dev must be running; or set MOTIONFIT_DEV_URL)
//   MotionFit.exe --kiosk   locked full screen (no way out except the in-app Quit button or Alt+F4)
const { app, BrowserWindow, protocol, session, ipcMain, globalShortcut } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

const SCHEME = 'app';
const HOST = 'motionfit';
const DIST = path.join(__dirname, '..', 'dist');
const DEV_URL = process.env.MOTIONFIT_DEV_URL ?? (process.argv.includes('--dev') ? 'http://localhost:5173' : undefined);
const KIOSK = process.argv.includes('--kiosk');
const WINDOWED = process.argv.includes('--windowed');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// A "secure" standard scheme: camera access, fetch() of the wasm/models and localStorage all work,
// which they would not from file://.
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// Sound effects and the voice coach may start without a click first.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) app.quit();

async function serveFile(request) {
  const { pathname } = new URL(request.url);
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(DIST, rel));
  if (!file.startsWith(DIST)) return new Response('Forbidden', { status: 403 });
  try {
    const body = await fs.readFile(file);
    const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    return new Response(body, { headers: { 'content-type': type } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

const isOwnOrigin = (url) => {
  try {
    const u = new URL(url);
    return DEV_URL ? u.origin === new URL(DEV_URL).origin : u.protocol === `${SCHEME}:` && u.host === HOST;
  } catch {
    return false;
  }
};

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    fullscreen: !WINDOWED,
    kiosk: KIOSK,
    autoHideMenuBar: true,
    backgroundColor: '#0b1020',
    title: 'MotionFit',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.removeMenu();

  // Keep navigation inside the app.
  win.webContents.on('will-navigate', (e, url) => {
    if (!isOwnOrigin(url)) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.loadURL(DEV_URL ?? `${SCHEME}://${HOST}/index.html`);
  return win;
}

app.whenReady().then(() => {
  protocol.handle(SCHEME, serveFile);

  // Camera only, and only for the app itself. Everything else is refused.
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const videoOnly = !details.mediaTypes || details.mediaTypes.every((t) => t === 'video');
    callback(permission === 'media' && videoOnly && isOwnOrigin(details.requestingUrl ?? wc.getURL()));
  });
  ses.setPermissionCheckHandler((wc, permission, origin) => permission === 'media' && isOwnOrigin(origin));

  ipcMain.on('fullscreen:set', (e, on) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win && !KIOSK) win.setFullScreen(!!on);
  });
  ipcMain.handle('fullscreen:get', (e) => BrowserWindow.fromWebContents(e.sender)?.isFullScreen() ?? false);
  ipcMain.on('app:quit', () => app.quit());

  const win = createWindow();
  const smoke = process.argv.find((a) => a.startsWith('--smoke='));
  if (smoke) runSmokeTest(win, smoke.slice('--smoke='.length));
  globalShortcut.register('CommandOrControl+Q', () => app.quit());
  app.on('second-instance', () => {
    if (win.isMinimized()) win.restore();
    win.focus();
  });
});

/**
 * `--smoke=<file.png>`: load the app, check the packaged assets are served, save a screenshot, print a
 * JSON report and quit. Used to verify a build without a camera.
 */
function runSmokeTest(win, pngPath) {
  const errors = [];
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error') errors.push(e.message);
  });
  win.webContents.once('did-finish-load', async () => {
    await new Promise((r) => setTimeout(r, 2500));
    const report = await win.webContents.executeJavaScript(`(async () => {
      const get = async (p) => {
        const r = await fetch(p);
        return { path: p, status: r.status, type: r.headers.get('content-type'), bytes: (await r.arrayBuffer()).byteLength };
      };
      const files = await Promise.all([
        '/models/character.glb', '/models/pose_landmarker_full.task', '/models/pose_landmarker_lite.task',
        '/mediapipe/wasm/vision_wasm_internal.wasm', '/mediapipe/wasm/vision_wasm_internal.js',
      ].map(get));
      return {
        title: document.title,
        desktop: !!window.motionfit,
        secureContext: isSecureContext,
        cameraApi: !!navigator.mediaDevices?.getUserMedia,
        quitShown: !document.getElementById('set-quit').classList.contains('hidden') || 'hidden-until-settings-open',
        files,
      };
    })()`);
    const img = await win.webContents.capturePage();
    await fs.writeFile(pngPath, img.toPNG());
    console.log('SMOKE ' + JSON.stringify({ ...report, errors }, null, 2));
    app.quit();
  });
}

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
