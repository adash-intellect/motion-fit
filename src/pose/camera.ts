export interface CameraOptions {
  width?: number;
  height?: number;
  frameRate?: number;
}

/** Opens the user-facing webcam and attaches it to the given <video> element. */
export async function startCamera(
  video: HTMLVideoElement,
  { width = 1280, height = 720, frameRate = 30 }: CameraOptions = {},
): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera API unavailable. Use localhost or HTTPS in a modern browser.');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: 'user',
      width: { ideal: width },
      height: { ideal: height },
      frameRate: { ideal: frameRate },
    },
  });

  video.srcObject = stream;
  await new Promise<void>((resolve) => {
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) resolve();
    else video.addEventListener('loadedmetadata', () => resolve(), { once: true });
  });
  await video.play();
  return stream;
}
