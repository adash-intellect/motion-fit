import { defineConfig } from 'vite';

export default defineConfig({
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
