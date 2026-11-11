import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { POSE_CONNECTIONS } from '../pose/poseTracker';

/** Draws the 2D skeleton on top of the webcam preview (picture-in-picture). */
export class Overlay2D {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly video: HTMLVideoElement,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas not supported');
    this.ctx = ctx;
  }

  draw(landmarks: NormalizedLandmark[] | null): void {
    const { canvas, ctx, video } = this;
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!landmarks) return;

    const w = canvas.width;
    const h = canvas.height;
    const visible = (lm: NormalizedLandmark) => (lm.visibility ?? 1) > 0.5;

    ctx.lineWidth = Math.max(2, w / 300);
    ctx.strokeStyle = '#e2e8f0';
    for (const { start, end } of POSE_CONNECTIONS) {
      const a = landmarks[start];
      const b = landmarks[end];
      if (!visible(a) || !visible(b)) continue;
      ctx.beginPath();
      ctx.moveTo(a.x * w, a.y * h);
      ctx.lineTo(b.x * w, b.y * h);
      ctx.stroke();
    }

    ctx.fillStyle = '#38bdf8';
    const r = Math.max(3, w / 200);
    for (const lm of landmarks) {
      if (!visible(lm)) continue;
      ctx.beginPath();
      ctx.arc(lm.x * w, lm.y * h, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
