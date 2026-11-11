import { startCamera } from './pose/camera';
import { PoseTracker, type ModelVariant, type PoseFrame } from './pose/poseTracker';
import { LandmarkSmoother } from './pose/oneEuro';
import { Stage } from './scene/stage';
import { Overlay2D } from './ui/overlay';
import { FpsCounter } from './ui/stats';
import { MotionEngine } from './motion/motionEngine';
import { ActivityPanel } from './ui/activityPanel';
import { HandCursor } from './ui/handCursor';
import { Sfx } from './game/sfx';
import { App } from './app';
import { RemoteNav } from './ui/remoteNav';
import { applySettings, loadSettings, saveSettings } from './ui/settings';
import { desktop } from './desktop';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const video = $<HTMLVideoElement>('webcam');
const sceneCanvas = $<HTMLCanvasElement>('scene');
const overlayCanvas = $<HTMLCanvasElement>('overlay');
const startScreen = $('start-screen');
const startBtn = $<HTMLButtonElement>('start-btn');
const startError = $('start-error');
const modelSelect = $<HTMLSelectElement>('model-select');
const hudRender = $('fps-render');
const hudPose = $('fps-pose');
const hudLatency = $('latency');
const hudStatus = $('tracking-status');

const scene3d = new Stage(sceneCanvas);
const overlay = new Overlay2D(overlayCanvas, video);
const worldSmoother = new LandmarkSmoother(1.0, 0.02);
const imageSmoother = new LandmarkSmoother(1.0, 0.02);
const renderFps = new FpsCounter();
const poseFps = new FpsCounter();
const motion = new MotionEngine();
const PULSE_COLORS = { squat: 0x4ade80, jump: 0xf97316, jumpingJack: 0x38bdf8, highKnee: 0xe879f9 } as const;
const panel = new ActivityPanel(motion, (kind) => scene3d.pulse(PULSE_COLORS[kind]));
const sfx = new Sfx();
const cursor = new HandCursor(() => sfx.select());
const settings = loadSettings();
applySettings(settings);
modelSelect.value = settings.model;
const app = new App(scene3d, motion, panel, cursor, sfx, settings);
const nav = new RemoteNav({
  back: () => tracker && motion.profile && app.back(),
  pause: () => tracker && motion.profile && app.togglePause(),
  moved: () => sfx.select(),
});
app.onScreenChange = () => nav.clear();

let tracker: PoseTracker | null = null;
let latestPose: PoseFrame | null = null;
let lastVideoTime = -1;

// Idle render so the empty stage shows behind the start screen.
function renderLoop(): void {
  requestAnimationFrame(renderLoop);
  if (tracker) detectIfNewFrame();
  nav.pollGamepad();
  scene3d.render();
  hudRender.textContent = String(renderFps.tick());
}

function detectIfNewFrame(): void {
  // Only run inference when the camera has produced a new frame.
  if (!tracker || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  const now = performance.now();
  const frame = tracker.detect(video, now);
  hudPose.textContent = String(poseFps.tick(now));

  if (frame) {
    const t = now / 1000;
    latestPose = {
      ...frame,
      world: worldSmoother.smooth(frame.world, t),
      image: imageSmoother.smooth(frame.image, t),
    };
    hudLatency.textContent = frame.inferenceMs.toFixed(1);
  } else {
    latestPose = null;
    worldSmoother.reset();
    imageSmoother.reset();
  }

  scene3d.updatePose(latestPose?.world ?? null);
  overlay.draw(latestPose?.image ?? null);
  updateStatus(latestPose);
  motion.update(
    latestPose ? { world: latestPose.world, image: latestPose.image, t: now } : null,
    now,
  );
  panel.tick();
  cursor.update(latestPose?.world ?? null, now);
  app.onPose(now);
}

window.addEventListener('keydown', (e) => {
  if (nav.handleKey(e)) {
    e.preventDefault();
    return;
  }
  if (!tracker) return;
  const key = e.key.toLowerCase();
  switch (key) {
    case 'c':
      app.recalibrate();
      break;
    case 'r':
      motion.resetCounts();
      panel.refreshCounts();
      break;
    case 'd':
      document.body.classList.toggle('no-debug');
      break;
    default:
      if (motion.profile) app.handleKey(key);
  }
});

function updateStatus(pose: PoseFrame | null): void {
  if (!pose) {
    hudStatus.textContent = 'No body detected';
    hudStatus.className = 'warn';
    return;
  }
  // Ankles (27, 28) and nose (0) visible → full body in frame.
  const vis = (i: number) => (pose.image[i].visibility ?? 0) > 0.5;
  const fullBody = vis(0) && vis(27) && vis(28);
  hudStatus.textContent = fullBody ? 'Full body tracked' : 'Step back – show your whole body';
  hudStatus.className = fullBody ? 'ok' : 'warn';
}

// ---------------------------------------------------------------- TV conveniences

// Hide the mouse pointer when it hasn't moved for a few seconds.
let mouseTimer = 0;
window.addEventListener('mousemove', () => {
  document.body.classList.remove('hide-mouse');
  clearTimeout(mouseTimer);
  mouseTimer = window.setTimeout(() => document.body.classList.add('hide-mouse'), 3000);
});
document.body.classList.add('hide-mouse');

// Keep the TV / monitor from sleeping while MotionFit is running.
let wakeLock: WakeLockSentinel | null = null;
async function keepAwake(): Promise<void> {
  try {
    if (document.visibilityState === 'visible' && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    }
  } catch {
    /* not supported or refused: the screen may sleep */
  }
}
document.addEventListener('visibilitychange', () => {
  if (tracker) void keepAwake();
});

// Browsers only allow sound after a user gesture; resume it on the first key or click.
for (const type of ['keydown', 'pointerdown']) {
  window.addEventListener(type, () => sfx.unlock(), { once: true });
}

/** Desktop app: always. Browser: only once camera permission has been granted before. */
async function canAutoStart(): Promise<boolean> {
  if (!settings.autoStart) return false;
  if (desktop) return true;
  try {
    const status = await navigator.permissions.query({ name: 'camera' as PermissionName });
    return status.state === 'granted';
  } catch {
    return false;
  }
}

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  startError.textContent = '';
  sfx.unlock(); // audio must be started from a user gesture
  try {
    startBtn.textContent = 'Opening camera…';
    await startCamera(video);
    startBtn.textContent = 'Loading pose model…';
    tracker = await PoseTracker.create(modelSelect.value as ModelVariant);
    settings.model = modelSelect.value as ModelVariant;
    saveSettings(settings);
    void keepAwake();
    startScreen.classList.add('hidden');
    document.body.classList.add('running');
    panel.showCalibration();
    app.begin();
  } catch (err) {
    console.error(err);
    startError.textContent = err instanceof Error ? err.message : String(err);
    startBtn.textContent = 'Retry';
    startBtn.disabled = false;
  }
});

renderLoop();
void canAutoStart().then((ok) => {
  if (ok) startBtn.click();
});
