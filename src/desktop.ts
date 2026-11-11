/** API exposed by the Electron preload script (electron/preload.cjs). Absent in a normal browser. */
export interface DesktopApi {
  isDesktop: true;
  setFullscreen(on: boolean): void;
  isFullscreen(): Promise<boolean>;
  quit(): void;
}

declare global {
  interface Window {
    motionfit?: DesktopApi;
  }
}

export const desktop: DesktopApi | null = typeof window !== 'undefined' ? (window.motionfit ?? null) : null;
