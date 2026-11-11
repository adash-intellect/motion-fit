import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const HORIZON = new THREE.Color(0x2a1650);
const ZENITH = new THREE.Color(0x050816);
const CYAN = 0x22d3ee;
const MAGENTA = 0xd946ef;

/**
 * "Neon arena": gradient sky with stars, reflective floor with grid, glowing player platform,
 * neon arches along the target lane, side pillars and floating shapes.
 * Returns an update function for ambient animation.
 */
export function buildArena(scene: THREE.Scene, renderer: THREE.WebGLRenderer): (dt: number) => void {
  // Image-based lighting gives the avatars' glossy materials something to reflect.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;
  pmrem.dispose();

  scene.background = ZENITH.clone();
  scene.fog = new THREE.Fog(HORIZON.clone().multiplyScalar(0.6), 14, 48);

  // --- Sky dome with vertical gradient (unaffected by fog)
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(90, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { horizon: { value: HORIZON }, zenith: { value: ZENITH } },
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 horizon; uniform vec3 zenith; varying vec3 vPos;
        void main() {
          float h = normalize(vPos).y;
          vec3 c = mix(horizon, zenith, smoothstep(-0.05, 0.45, h));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  scene.add(sky);

  // --- Stars (upper hemisphere)
  const starCount = 1400;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const y = 0.08 + Math.random() * 0.92;
    const r = Math.sqrt(1 - y * y);
    const d = 70 + Math.random() * 15;
    starPos.set([Math.cos(theta) * r * d, y * d, Math.sin(theta) * r * d], i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.25, fog: false, transparent: true, opacity: 0.85 });
  scene.add(new THREE.Points(starGeo, starMat));

  // --- Floor + grid
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(60, 64),
    new THREE.MeshStandardMaterial({ color: 0x0b0f24, roughness: 0.45, metalness: 0.6 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(100, 100, MAGENTA, 0x3b2a7a);
  const gridMat = grid.material as THREE.LineBasicMaterial;
  gridMat.transparent = true;
  gridMat.opacity = 0.35;
  grid.position.y = 0.002;
  scene.add(grid);

  // --- Player platform with glowing rim
  const platform = new THREE.Mesh(
    new THREE.CylinderGeometry(1.25, 1.35, 0.06, 64),
    new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.3, metalness: 0.9 }),
  );
  platform.position.y = -0.028; // top surface sits at floor level so feet don't sink
  platform.receiveShadow = true;
  scene.add(platform);

  const rimMat = new THREE.MeshStandardMaterial({ color: CYAN, emissive: CYAN, emissiveIntensity: 2.5 });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.28, 0.018, 8, 96), rimMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.005;
  scene.add(rim);

  const innerRing = new THREE.Mesh(
    new THREE.RingGeometry(0.62, 0.64, 64),
    new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.35 }),
  );
  innerRing.rotation.x = -Math.PI / 2;
  innerRing.position.y = 0.006;
  scene.add(innerRing);

  // --- Neon arches over the target lane (targets fly from -z toward the player)
  const arches: THREE.MeshStandardMaterial[] = [];
  const archGeo = new THREE.TorusGeometry(3, 0.045, 10, 80, Math.PI);
  for (let i = 0; i < 6; i++) {
    const color = i % 2 ? MAGENTA : CYAN;
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2 });
    const arch = new THREE.Mesh(archGeo, mat);
    arch.position.set(0, 0, -5 - i * 5);
    scene.add(arch);
    arches.push(mat);
  }

  // --- Pillars with glowing edges lining the lane
  const pillarGeo = new THREE.BoxGeometry(0.5, 7, 0.5);
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4, metalness: 0.8 });
  const stripGeo = new THREE.BoxGeometry(0.06, 7, 0.06);
  const stripMat = new THREE.MeshStandardMaterial({ color: MAGENTA, emissive: MAGENTA, emissiveIntensity: 1.8 });
  for (let i = 0; i < 5; i++) {
    for (const side of [-1, 1]) {
      const z = -3 - i * 7;
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.set(side * 6.5, 3.5, z);
      pillar.castShadow = true;
      const strip = new THREE.Mesh(stripGeo, stripMat);
      strip.position.set(side * 6.5 - side * 0.26, 3.5, z + 0.26);
      scene.add(pillar, strip);
    }
  }

  // --- Floating wireframe shapes in the distance
  const floaters: THREE.Mesh[] = [];
  const shapes = [new THREE.IcosahedronGeometry(1.6, 0), new THREE.OctahedronGeometry(1.4, 0), new THREE.TorusKnotGeometry(1, 0.25, 64, 8)];
  const floatMat = new THREE.MeshBasicMaterial({ color: 0x7c3aed, wireframe: true, transparent: true, opacity: 0.45 });
  [
    [-14, 9, -30], [16, 11, -26], [-22, 6, -10], [24, 7, -8], [0, 15, -40],
  ].forEach(([x, y, z], i) => {
    const m = new THREE.Mesh(shapes[i % shapes.length], floatMat);
    m.position.set(x, y, z);
    floaters.push(m);
    scene.add(m);
  });

  // --- Lights
  scene.add(new THREE.HemisphereLight(0x9db4ff, 0x1a1033, 0.9));

  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(2.5, 6, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  const sc = key.shadow.camera;
  sc.left = sc.bottom = -3;
  sc.right = sc.top = 3;
  sc.near = 1;
  sc.far = 15;
  scene.add(key);

  const rimCyan = new THREE.PointLight(CYAN, 6, 8, 2);
  rimCyan.position.set(-2.2, 2.2, -1.5);
  const rimMagenta = new THREE.PointLight(MAGENTA, 6, 8, 2);
  rimMagenta.position.set(2.2, 2.2, -1.5);
  scene.add(rimCyan, rimMagenta);

  // --- Ambient animation
  let time = 0;
  return (dt: number) => {
    time += dt;
    // A glow wave travels along the arches toward the player.
    arches.forEach((mat, i) => {
      mat.emissiveIntensity = 1.2 + 1.6 * Math.max(0, Math.sin(time * 2.2 + i * 0.9));
    });
    rimMat.emissiveIntensity = 2 + 0.6 * Math.sin(time * 1.5);
    floaters.forEach((m, i) => {
      m.rotation.x += dt * 0.1 * (i + 1);
      m.rotation.y += dt * 0.15;
      m.position.y += Math.sin(time * 0.5 + i) * dt * 0.2;
    });
    starMat.opacity = 0.75 + 0.15 * Math.sin(time * 0.8);
  };
}
