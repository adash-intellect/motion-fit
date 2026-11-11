// Copies MediaPipe WASM runtime into public/ and downloads the pose models,
// so the app runs fully offline after install (important for TV / kiosk setups).
import { copyFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmDst = join(root, 'public', 'mediapipe', 'wasm');
const modelDst = join(root, 'public', 'models');

const MODELS = {
  'pose_landmarker_lite.task':
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
  'pose_landmarker_full.task':
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
  // Rigged character (Mixamo "X Bot", as distributed in the three.js examples).
  // Replace public/models/character.glb with any Mixamo-rigged GLB to change the character.
  'character.glb':
    'https://raw.githubusercontent.com/mrdoob/three.js/r170/examples/models/gltf/Xbot.glb',
};

await mkdir(wasmDst, { recursive: true });
for (const file of await readdir(wasmSrc)) {
  await copyFile(join(wasmSrc, file), join(wasmDst, file));
}
console.log(`[setup-assets] copied MediaPipe wasm -> public/mediapipe/wasm`);

await mkdir(modelDst, { recursive: true });
for (const [name, url] of Object.entries(MODELS)) {
  const target = join(modelDst, name);
  if (existsSync(target) && (await stat(target)).size > 0) continue;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await writeFile(target, Buffer.from(await res.arrayBuffer()));
    console.log(`[setup-assets] downloaded ${name}`);
  } catch (err) {
    console.warn(`[setup-assets] could not download ${name} (${err.message}). ` +
      `Run "npm run setup-assets" when online.`);
  }
}
