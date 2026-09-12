import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/** El proyecto es ESM ("type": "module"), asi que no hay __dirname. */
const root = import.meta.dirname;

/**
 * Build del service worker, AUTOCONTENIDO.
 *
 * Va aparte para que no comparta chunks con el popup. Los imports estaticos si
 * funcionan en un service worker MV3 de tipo modulo, pero si alguna vez
 * fallara el registro la extension se romperia entera y en silencio: sin
 * alarmas, sin capturas y sin ningun error visible. Duplicar tres kilobytes de
 * codigo compartido es un precio ridiculo por quitar de en medio esa clase de
 * fallo.
 *
 * Corre DESPUES del build del popup y con emptyOutDir:false.
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
      input: resolve(root, 'src/background/sw.ts'),
      output: {
        format: 'es',
        entryFileNames: 'service-worker.js',
        // Sin trocear: el service worker se basta a si mismo.
        inlineDynamicImports: true,
      },
    },
  },
});
