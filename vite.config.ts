import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/** El proyecto es ESM ("type": "module"), asi que no hay __dirname. */
const root = import.meta.dirname;

/**
 * Build del popup. Es el unico que vacia dist/, asi que corre primero.
 *
 * Los otros dos entry points van en configuraciones aparte porque cada uno
 * necesita una forma distinta de bundle:
 *   - vite.sw.config.ts       service worker, modulo ES autocontenido
 *   - vite.content.config.ts  content script, IIFE (el plan B, fuera del
 *                             manifest desde la S1)
 */
export default defineConfig({
  root: 'src',
  publicDir: resolve(root, 'public'),

  // Rutas relativas: el popup se sirve desde chrome-extension://<id>/ y no
  // conviene depender de que la raiz del origen sea la de la extension.
  base: './',

  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: true,
    target: 'chrome114',
    minify: false,        // la Web Store revisa el codigo; legible ayuda
    sourcemap: true,

    rollupOptions: {
      input: { popup: resolve(root, 'src/popup.html') },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
