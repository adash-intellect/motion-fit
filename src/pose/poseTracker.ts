import {
  FilesetResolver,
  PoseLandmarker,
  type NormalizedLandmark,
  type Landmark,
} from '@mediapipe/tasks-vision';

export type ModelVariant = 'lite' | 'full';

export interface PoseFrame {
  /** Normalized image-space landmarks (x,y in 0..1, z relative depth). */
  image: NormalizedLandmark[];
  /** Metric world landmarks in meters, origin at the hip center. */
  world: Landmark[];
  timestamp: number;
  inferenceMs: number;
}

/**
 * Thin wrapper around MediaPipe PoseLandmarker.
 * Assets are served locally from /public (see scripts/setup-assets.mjs).
 */
export class PoseTracker {
  private constructor(private readonly landmarker: PoseLandmarker) {}

  static async create(variant: ModelVariant = 'full'): Promise<PoseTracker> {
    const base = new URL(import.meta.env.BASE_URL, window.location.href);
    const vision = await FilesetResolver.forVisionTasks(new URL('mediapipe/wasm', base).href);
    const modelAssetPath = new URL(`models/pose_landmarker_${variant}.task`, base).href;

    const make = (delegate: 'GPU' | 'CPU') =>
      PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

    try {
      return new PoseTracker(await make('GPU'));
    } catch (err) {
      console.warn('GPU delegate failed, falling back to CPU', err);
      return new PoseTracker(await make('CPU'));
    }
  }

  /** Runs detection on the current video frame. Returns null when no body is found. */
  detect(video: HTMLVideoElement, timestamp: number): PoseFrame | null {
    const start = performance.now();
    const result = this.landmarker.detectForVideo(video, timestamp);
    const inferenceMs = performance.now() - start;

    const image = result.landmarks[0];
    const world = result.worldLandmarks[0];
    if (!image || !world) return null;
    return { image, world, timestamp, inferenceMs };
  }

  close(): void {
    this.landmarker.close();
  }
}

/** Pairs of landmark indices forming the skeleton's bones. */
export const POSE_CONNECTIONS: ReadonlyArray<{ start: number; end: number }> =
  PoseLandmarker.POSE_CONNECTIONS;
