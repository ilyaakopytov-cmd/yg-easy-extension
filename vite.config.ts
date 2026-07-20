import react from '@vitejs/plugin-react';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const projectRoot = dirname(fileURLToPath(import.meta.url));

function copyManifestPlugin() {
  return {
    name: 'copy-extension-manifest',
    closeBundle() {
      const target = resolve('dist/manifest.json');
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(resolve('manifest.json'), target);
    },
  };
}

export default defineConfig({
  plugins: [react(), copyManifestPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(projectRoot, 'index.html'),
        popup: resolve(projectRoot, 'src/popup/popup.html'),
        fullpage: resolve(projectRoot, 'src/fullpage/fullpage.html'),
        options: resolve(projectRoot, 'src/options/options.html'),
        'background/serviceWorker': resolve(projectRoot, 'src/background/serviceWorker.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
