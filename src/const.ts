declare const __LC_VERSION__: string | undefined;

/** Card version, injected from package.json at build time (see vite.config.ts). */
export const VERSION: string = typeof __LC_VERSION__ === 'string' ? __LC_VERSION__ : 'dev';

/**
 * Docs base for the editor help links. Page scheme: `${DOCS_URL}/cards/<card>#<card>-<section>`,
 * with <card> one of dial, tile, badge, cluster.
 * The docs are a VitePress site (cleanUrls) on GitHub Pages.
 * Public docs site on GitHub Pages; must match the URLs in .github/ISSUE_TEMPLATE/config.yml
 */
export const DOCS_URL = 'https://decibel95.github.io/liquid-climate';
