import * as THREE from 'three';

interface Burst {
  points: THREE.Points;
  velocities: Float32Array;
  age: number;
}

const LIFETIME = 0.6;
const GRAVITY = -6;

/** Lightweight particle bursts for hits and explosions. */
export class Particles {
  private bursts: Burst[] = [];

  constructor(private readonly parent: THREE.Object3D) {}

  burst(at: THREE.Vector3, color: THREE.ColorRepresentation, count = 24, speed = 3): void {
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions.set([at.x, at.y, at.z], i * 3);
      // Random direction on a sphere
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const v = speed * (0.4 + Math.random() * 0.6);
      velocities.set([s * Math.cos(a) * v, u * v + 1.5, s * Math.sin(a) * v], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color,
      size: 0.07,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geometry, material);
    this.parent.add(points);
    this.bursts.push({ points, velocities, age: 0 });
  }

  update(dt: number): void {
    for (let b = this.bursts.length - 1; b >= 0; b--) {
      const burst = this.bursts[b];
      burst.age += dt;
      const material = burst.points.material as THREE.PointsMaterial;
      if (burst.age >= LIFETIME) {
        this.parent.remove(burst.points);
        burst.points.geometry.dispose();
        material.dispose();
        this.bursts.splice(b, 1);
        continue;
      }
      const attr = burst.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const pos = attr.array as Float32Array;
      const v = burst.velocities;
      for (let i = 0; i < pos.length; i += 3) {
        v[i + 1] += GRAVITY * dt;
        pos[i] += v[i] * dt;
        pos[i + 1] += v[i + 1] * dt;
        pos[i + 2] += v[i + 2] * dt;
      }
      attr.needsUpdate = true;
      material.opacity = 1 - burst.age / LIFETIME;
    }
  }
}
