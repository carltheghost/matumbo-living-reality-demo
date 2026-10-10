import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Development only. GitHub Pages still publishes the unbundled static app.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^three$/, replacement: fileURLToPath(new URL('./vendor/three-r179.1/build/three.module.js', import.meta.url)) },
      { find: 'three/addons', replacement: fileURLToPath(new URL('./vendor/three-r179.1/examples/jsm', import.meta.url)) },
    ],
  },
  server: { host: '0.0.0.0', allowedHosts: ['terminal.local'] },
});
