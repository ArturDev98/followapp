import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/** El proyecto es ESM ("type": "module"), asi que no hay __dirname. */
const root = import.meta.dirname;

/**
 * Build del content script, en IIFE autocontenido.
 *
 * Corre DESPUES del build principal y con emptyOutDir:false, para no borrar
 * lo que aquel dejo en dist/.
 */
export default defineConfig({
  root: 'src',
  publicDir: false,

  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: false,
    target: 'chrome114',
    minify: false,
    sourcemap: true,

    rollupOptions: {
      input: resolve(root, 'src/content/probe.ts'),
      output: {
        format: 'iife',
        entryFileNames: 'content.js',
        // Un IIFE no debe partirse en chunks: el manifest carga un solo fichero.
        inlineDynamicImports: true,
      },
    },
  },
});
