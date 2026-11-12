import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths: the same build works at a sub-path (GitHub Pages: /motion-fit/),
  // in the desktop app (app://motionfit/) and locally.
  base: './',
  server: {
    // Allow access from another device on the LAN (e.g. the PC hooked to the TV).
    // Note: browsers only grant camera access on localhost or HTTPS.
    host: true,
    port: 5173,
    strictPort: true, // launch.json opens this exact port
  },
  build: {
    target: 'es2022',
  },
});
