import type { Page } from 'playwright/test';

/** Everything that would show up as an error in the browser console of a page. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.name}: ${e.message}`));
  return errors;
}

/** The dev server has no favicon; answer it so a 404 does not count as a console error. */
export async function stubFavicon(page: Page): Promise<void> {
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
}

export interface DefineRecord {
  name: string;
  ok: boolean;
  error?: string;
}

/** Init script: records every customElements.define call (name and whether it threw). Read window.__defines. */
export function recordDefines(): void {
  const w = window as unknown as { __defines: { name: string; ok: boolean; error?: string }[] };
  w.__defines = [];
  const original = customElements.define.bind(customElements);
  customElements.define = function (name: string, ctor: CustomElementConstructor, options?: ElementDefinitionOptions) {
    try {
      original(name, ctor, options);
      w.__defines.push({ name, ok: true });
    } catch (err) {
      w.__defines.push({ name, ok: false, error: `${(err as Error)?.name}: ${(err as Error)?.message}` });
      throw err;
    }
  };
}

/** The defines of the page, without the dev server's own `vite-error-overlay` element. */
export async function definesOf(page: Page): Promise<DefineRecord[]> {
  const all = await page.evaluate(() => (window as unknown as { __defines: DefineRecord[] }).__defines.slice());
  return all.filter((d) => !d.name.startsWith('vite-'));
}

export interface GlassInfo {
  /** Number of elements in the card's shadow tree (and nested shadow trees) with a backdrop-filter. */
  count: number;
  /** Computed backdrop-filter of the outermost glass element. */
  backdropFilter: string;
  borderRadius: string;
}

/**
 * Looks for the glass of a card: the outermost element in the card's open shadow tree with a computed backdrop-filter.
 * Evaluated in the page, so it takes a CSS selector for the host.
 */
export async function glassOf(page: Page, hostSelector: string): Promise<GlassInfo | null> {
  return page.evaluate((selector) => {
    const host = document.querySelector(selector);
    if (!host) return null;
    const found: Element[] = [];
    const visit = (root: ParentNode) => {
      for (const child of Array.from(root.children)) {
        const filter = getComputedStyle(child).backdropFilter;
        if (filter && filter !== 'none') found.push(child);
        if (child.shadowRoot) visit(child.shadowRoot);
        visit(child);
      }
    };
    if (host.shadowRoot) visit(host.shadowRoot);
    const first = found[0];
    if (!first) return { count: 0, backdropFilter: 'none', borderRadius: '' };
    const cs = getComputedStyle(first);
    return { count: found.length, backdropFilter: cs.backdropFilter, borderRadius: cs.borderTopLeftRadius };
  }, hostSelector);
}
