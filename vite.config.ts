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
      // 必须排除原生模块
      external: ['fs', 'path', 'os', 'events', 'child_process', 'crypto', 'http', 'https'],
      output: { format: 'es', exports: 'named' },
    },
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
  },
});
