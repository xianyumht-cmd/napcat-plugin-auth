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
      // 这里的排除非常重要，防止 Vite 把 Node 原生代码打进包里
      external: ['fs', 'path', 'os', 'events', 'child_process', 'crypto', 'http', 'https'],
      output: {
        minifyInternalExports: false,
      },
    },
    outDir: 'dist',
    emptyOutDir: true,
    minify: false, // 暂时关掉压缩，报错时能看到具体哪一行
  },
});
