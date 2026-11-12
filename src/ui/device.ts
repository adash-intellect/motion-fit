/**
 * Phone / tablet detection. Touch devices get the lighter tracking model and graphics by default,
 * a compact layout, on-screen buttons for things a keyboard would do, and no keyboard hints.
 */
const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
// iPadOS reports itself as a Mac, so also check for touch points.
const iPad = /Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1;

export const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || iPad || (coarse && !/Windows/.test(ua));
export const isIOS = /iPhone|iPad|iPod/.test(ua) || iPad;
/** Running as an installed home-screen app. */
export const isStandalone =
  typeof matchMedia !== 'undefined' &&
  (matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: standalone)').matches);
