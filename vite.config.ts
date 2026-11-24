import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import pkg from './package.json';

/**
 * The Inter font and its licence (fonts/, copied from liquid-core) go next to dist/liquid-climate.js, byte for byte.
 * src/index.ts loads the font from there at runtime; the release attaches all three files (OFL condition 2: the
 * licence travels with the font). On the dev server src/index.ts resolves the font to /src/liquid-inter.woff2.
 *
 * Contract with src/index.ts: the dev route below is '/src/' + the file name that index.ts resolves
 * ('./liquid-inter.woff2' next to src/index.ts), which must be a key of FONT_ASSETS. test/font-load.test.ts checks it.
 */
export const FONT_ASSETS = {
  'liquid-inter.woff2': 'fonts/liquid-inter.woff2',
  'liquid-inter-OFL.txt': 'fonts/OFL.txt',
} as const;

const fromRoot = (file: string) => readFileSync(new URL(`./${file}`, import.meta.url));

function fontAssets(): Plugin {
  return {
    name: 'lc-font-assets',
    configureServer(server) {
      server.middlewares.use('/src/liquid-inter.woff2', (_req, res) => {
        // Route name = index.ts's './liquid-inter.woff2' (see the contract at FONT_ASSETS).
        res.setHeader('Content-Type', 'font/woff2');
        res.end(fromRoot(FONT_ASSETS['liquid-inter.woff2']));
      });
    },
    generateBundle() {
      for (const [fileName, from] of Object.entries(FONT_ASSETS)) {
        this.emitFile({ type: 'asset', fileName, source: fromRoot(from) });
      }
    },
  };
}

export default defineConfig({
  define: { __LC_VERSION__: JSON.stringify(pkg.version) },
  plugins: [fontAssets()],
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
