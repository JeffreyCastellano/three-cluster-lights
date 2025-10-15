import { defineConfig } from 'vite'
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { resolve } from 'path';

// Plugin to exclude C source files from being bundled as assets
const excludeCSourcePlugin = {
  name: 'exclude-c-source',
  enforce: 'pre',
  load(id) {
    // Skip loading C/H files entirely
    if (id.endsWith('.c') || id.endsWith('.h')) {
      return '';  // Return empty string to prevent bundling
    }
  },
  generateBundle(_options, bundle) {
    // Remove any C/H files that made it into the bundle
    for (const fileName in bundle) {
      if (fileName.endsWith('.c') || fileName.endsWith('.h')) {
        delete bundle[fileName];
      }
    }
  }
};

// Vite config
export default defineConfig({
  plugins: [
    wasm(),
    topLevelAwait(),
    excludeCSourcePlugin
  ],
  assetsInclude: ['**/*.wasm'],
  root: '.',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html')
      },
      output: {
        assetFileNames: (assetInfo) => {
          const fileName = assetInfo.names?.[0] || '';

          // Keep WASM files at root level (not in assets) for consistent /lib/wasm/ path
          if (fileName.endsWith('.wasm')) {
            return 'lib/wasm/[name][extname]';
          }
          // Keep other assets organized by type
          if (fileName.endsWith('.css')) {
            return 'assets/css/[name]-[hash][extname]';
          }
          if (fileName.match(/\.(glb|gltf)$/)) {
            return 'assets/models/[name]-[hash][extname]';
          }
          // Default for other assets
          return 'assets/[name]-[hash][extname]';
        },
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js'
      }
    }
  },
  server: {
    port: 3005,
    open: '/index.html'
  }
})
