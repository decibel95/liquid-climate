import { defineConfig } from 'vite';
import pkg from './package.json';

export default defineConfig({
  define: { __LC_VERSION__: JSON.stringify(pkg.version) },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'liquid-climate.js',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
