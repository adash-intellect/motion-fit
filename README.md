# MotionFit

Webcam-based, motion-controlled 3D exercise game. Runs in the browser on a PC or a TV-connected PC.
No special sensors are needed: MediaPipe Pose runs on the device, and the video never leaves the machine.

## Stack
TypeScript · Vite · Three.js · MediaPipe Pose Landmarker (`@mediapipe/tasks-vision`)

## Run
```bash
npm install        # also copies the MediaPipe wasm and downloads the pose models into public/
npm run dev        # http://localhost:5173
```
Browsers only allow camera access on `localhost` or HTTPS.

## Layout
```
src/pose/    camera, PoseTracker (MediaPipe wrapper), One Euro smoothing
src/motion/  MotionEngine: calibration, exercise detectors (squat, jump, jumping jack, high knee), squat form checks, typed events
src/game/    Target Smash (targetSmash.ts), tunable rules (smashRules.ts), particles, sfx, storage
src/workout/ guided programs, WorkoutRunner, calorie estimates (MET), session history and streaks
src/app.ts   screen/mode controller: calibrate → menu → game / guided workout / free workout → results, progress
src/scene/   Stage (renderer, bloom, views), neon arena (environment.ts), avatars/ (robot, rigged character, skeleton)
src/ui/      2D webcam overlay, FPS counter, hand cursor, screens, voice coach
scripts/     setup-assets.mjs (offline wasm + models)
electron/    desktop shell (main.cjs serves dist/ over app://, camera-only permissions) and preload bridge
```

## Roadmap
- [x] Phase 0: webcam → pose → mirrored 3D avatar, FPS/inference HUD
- [x] Phase 1: calibration, squat / jump / jumping-jack detectors with form feedback, cross-arms pause gesture, unit tests (`npm test`)
- [x] Phase 2: Target Smash (3D, over-the-shoulder), hand-cursor menus, synthesized SFX, personal best
- [x] Phase 2.5: neon arena, switchable avatars (robot / rigged Mixamo character / skeleton), bloom with auto quality
- [x] Phase 3: guided workouts with voice coach, squat form tips, high knees, calorie estimates, history and streaks
- [x] Phase 4: TV UI (remote / gamepad navigation, settings, text size, TV edge margin) + Electron desktop app

## Changing the character
`public/models/character.glb` is the Mixamo "X Bot" from the three.js examples. Replace it with any
**Mixamo-rigged** GLB (bone names like `mixamorig:LeftArm`) and it will be retargeted automatically.

## Workouts and progress
- **Workouts** (menu key 2): Warm-Up, Quick Burn and Leg Day. Programs are plain data in `src/workout/programs.ts`.
  A rep step moves on once the target is reached, or after a time cap. A squat hold only counts while the knees are bent below 125°.
- **Form tips** for squats: knees caving in, leaning too far forward, rushing the rep.
- **Calories** are an estimate: MET × body weight × time. Set your weight on the Progress screen.
- **History** is stored in the browser (localStorage, key `motionfit.history`) on this machine only.
- Keys: N skip a workout step · V voice coach on/off · H progress · - / + weight on the Progress screen.

## TV and remote control
- Arrow keys, a TV remote or a gamepad (d-pad / stick) move a highlight over the buttons; Enter or A presses; Backspace, Back or B goes back; Start pauses.
- **Settings** (menu, key S): full screen, text size, TV edge margin (for TVs that crop the picture), voice coach, graphics, tracking model, automatic camera start.
- The mouse pointer hides itself, and the screen is kept awake while MotionFit runs.

## Desktop app (Windows)
```bash
npm run desktop       # build and run in a window
npm run desktop:dev   # run against `npm run dev` with hot reload
npm run dist          # release/MotionFit Setup 0.1.0.exe (installer) and MotionFit-0.1.0-portable.exe
```
The app opens full screen and starts the camera by itself. Run `MotionFit.exe --kiosk` to lock it full screen;
quit with Settings → Quit, Ctrl+Q or Alt+F4. `MotionFit.exe --smoke=out.png` checks a build without playing:
it loads the app, verifies the bundled models and prints a JSON report.
The build is not code-signed, so Windows SmartScreen will warn on first run ("More info" → "Run anyway").
