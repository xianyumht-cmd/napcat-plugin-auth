import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'NapCatPluginAuth',
      fileName: () => 'index.mjs',
      formats: ['es'],
    },
    rollupOptions: {
      external: ['fs', 'path', 'os', 'events', 'child_process'],
      output: {
        minifyInternalExports: false,
      },
    },
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
  },
});
