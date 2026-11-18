// @vitest-environment happy-dom
/// <reference types="vite/client" />
/// <reference path="../docs/.vitepress/env.d.ts" />
import { describe, expect, it, vi } from 'vitest';
import '../src/index';
import anchorMap from '../docs/anchors.json';
import docsConfig from '../docs/.vitepress/config.ts?raw';
import docsWorkflow from '../.github/workflows/docs.yml?raw';
import liveCard from '../docs/.vitepress/theme/LiveCard.vue?raw';
import { DOCS_URL } from '../src/const';
import { createDemo } from '../src/demo/service';
import { englishFixture } from '../src/demo/english';
import { allFixtures, makeHass } from './fixtures';

// The markdown sources of the docs site (node_modules, the build output and public are not in these globs).
const pages = import.meta.glob(['../docs/*.md', '../docs/cards/*.md'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const media = Object.keys(import.meta.glob('../docs/public/media/*')).map((f) => f.slice('../docs/public'.length));

/** The page path ("/cards/dial") of a markdown source. */
const pagePath = (file: string) => file.replace('../docs', '').replace(/\.md$/, '').replace(/\/index$/, '') || '/';

/** Heading ids outside code fences: the explicit `{#id}`. Headings without one are listed by line. */
function headingIds(markdown: string): { ids: Set<string>; missing: number[] } {
  const ids = new Set<string>();
  const missing: number[] = [];
  let fence = false;
  markdown.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) return;
    const m = /^#{1,6}\s+(.*?)\s*$/.exec(line);
    if (!m) return;
    const explicit = /\s\{#([^}\s]+)\}$/.exec(m[1]);
    if (explicit) ids.add(explicit[1]);
    else missing.push(i + 1);
  });
  return { ids, missing };
}

const headings = new Map<string, Set<string>>();
const ids = new Map<string, Set<string>>();
for (const [file, md] of Object.entries(pages)) {
  const h = headingIds(md);
  headings.set(file, h.ids);
  ids.set(pagePath(file), h.ids);
}

const split = (target: string): [string, string] => {
  const [path, hash = ''] = target.split('#');
  return [path, hash];
};

describe('docs anchors', () => {
  it('finds the docs pages', () => {
    expect([...ids.keys()]).toEqual(expect.arrayContaining(['/', '/cards/dial', '/cards/tile', '/cards/badge', '/cards/cluster', '/troubleshooting']));
  });

  it('every heading has an explicit {#id}, so the anchors do not depend on a slug rule', () => {
    for (const [file, md] of Object.entries(pages)) {
      expect(headingIds(md).missing.map((line) => `${file}:${line}`), `headings without {#id} in ${file}`).toEqual([]);
    }
  });

  it('every anchor in anchors.json is a heading id on its page', () => {
    for (const [name, target] of Object.entries(anchorMap.anchors)) {
      const [path, hash] = split(target);
      expect(ids.has(path), `${name}: no page ${path}`).toBe(true);
      expect(ids.get(path)!.has(hash), `${name}: no heading id ${hash} on ${path}`).toBe(true);
    }
  });

  it('every internal link in the docs points at an existing page and heading', () => {
    for (const [file, md] of Object.entries(pages)) {
      for (const m of md.matchAll(/\]\(#([^)\s]+)\)/g)) {
        expect(headings.get(file)!.has(m[1]), `${file}: link to missing heading on the same page #${m[1]}`).toBe(true);
      }
      for (const m of md.matchAll(/\]\((\/[^)\s]*)\)/g)) {
        const [path, hash] = split(m[1]);
        if (path.startsWith('/media/')) continue;
        expect(ids.has(path), `${file}: link to missing page ${m[1]}`).toBe(true);
        if (hash) expect(ids.get(path)!.has(hash), `${file}: link to missing heading ${m[1]}`).toBe(true);
      }
    }
  });
});

describe.each([
  ['dial', 'liquid-climate-card-editor', 'custom:liquid-climate-card'],
  ['tile', 'liquid-climate-tile-editor', 'custom:liquid-climate-tile'],
  ['badge', 'liquid-climate-badge-editor', 'custom:liquid-climate-badge'],
  ['cluster', 'liquid-climate-cluster-editor', 'custom:liquid-climate-cluster'],
])('%s editor help links', (card, tag, type) => {
  it('all resolve to a documented anchor', async () => {
    const known = new Set(Object.values(anchorMap.anchors));
    const hass = makeHass(allFixtures, '°C');
    const ed = document.createElement(tag) as HTMLElement & Record<string, any>;
    ed.setConfig({ type, entity: card === 'cluster' ? undefined : 'climate.keuken_airco' });
    ed.hass = hass;
    document.body.append(ed);
    await ed.updateComplete;
    // The dial shows one tab at a time: visit all of them.
    const hrefs = new Set<string>();
    const tabs = [...ed.shadowRoot!.querySelectorAll<HTMLElement>('[role=tab]')];
    for (let i = 0; i < Math.max(1, tabs.length); i++) {
      if (tabs.length) tabs[i].click();
      for (let n = 0; n < 4; n++) {
        await new Promise((r) => setTimeout(r, 0));
        await ed.updateComplete;
      }
      for (const a of ed.shadowRoot!.querySelectorAll<HTMLAnchorElement>('a.help')) hrefs.add(a.getAttribute('href')!);
    }
    ed.remove();
    expect(hrefs.size).toBeGreaterThan(2);
    for (const href of hrefs) {
      expect(href.startsWith(`${DOCS_URL}/`), href).toBe(true);
      const target = href.slice(DOCS_URL.length);
      expect(known.has(target), `${href} is not in docs/anchors.json`).toBe(true);
      const [path, hash] = split(target);
      expect(ids.get(path)?.has(hash), `${href} has no heading in the docs`).toBe(true);
    }
  });
});

describe('docs base path', () => {
  it('DOCS_URL has no trailing slash and a one-segment path', () => {
    expect(DOCS_URL.endsWith('/')).toBe(false);
    expect(new URL(DOCS_URL).pathname).toMatch(/^\/[^/]+$/);
  });

  it('the VitePress base is the path of DOCS_URL with a trailing slash, and the Pages workflow does not override it', async () => {
    vi.stubEnv('DOCS_BASE', '');
    vi.resetModules();
    const { default: config } = await import('../docs/.vitepress/config');
    vi.unstubAllEnvs();
    expect(config.base).toBe(`${new URL(DOCS_URL).pathname}/`);
    expect(docsWorkflow).not.toContain('DOCS_BASE');
    expect(docsWorkflow).not.toContain('base_path');
  });
});

describe('docs media', () => {
  it('finds the media folder', () => {
    expect(media).toEqual(expect.arrayContaining(['/media/hero-light.png', '/media/demo.mp4']));
  });

  it('every /media/ reference in the pages and the theme is a file in docs/public/media', () => {
    const sources: Record<string, string> = { ...pages, 'LiveCard.vue': liveCard };
    let seen = 0;
    for (const [file, text] of Object.entries(sources)) {
      for (const m of text.matchAll(/\/media\/[\w.-]+/g)) {
        seen++;
        expect(media, `${file} references ${m[0]}`).toContain(m[0]);
      }
    }
    expect(seen).toBeGreaterThan(10);
  });

  it('the config no longer needs a plugin for media that is not there yet', () => {
    expect(docsConfig).not.toContain('pending-public');
  });
});

describe('docs demo names', () => {
  const NEUTRAL = ['climate.living_room', 'climate.bedroom', 'climate.office', 'climate.studio'];

  it('the English fixtures hold no Dutch ids and the four rooms', () => {
    const { fixture, areas, floors } = englishFixture();
    for (const id of NEUTRAL) expect(fixture.states[id], id).toBeDefined();
    expect(Object.keys(fixture.states).filter((id) => /keuken|slaap|nagel|buiten|binnen|energie|verwarm|koel|luchtvocht|temperatuur|regeling/.test(id))).toEqual([]);
    expect(Object.values(areas).map((a) => a.name)).toEqual(expect.arrayContaining(['Living Room', 'Bedroom', 'Office', 'Studio']));
    expect(Object.keys(floors).sort()).toEqual(['first_floor', 'ground_floor']);
    for (const d of Object.values(fixture.devices)) if (d.area_id) expect(areas[d.area_id], `${d.name} area ${d.area_id}`).toBeDefined();
  });

  it('the English fixtures hold no Dutch names for entities, devices, areas and floors', () => {
    const { fixture, areas, floors } = englishFixture();
    const dutch = /airco|regeling|buitenunit|binnenunit|keuken|slaapkamer|nagelsalon|woonkamer|verwarming|achtertuin|dual_setpoint|begane|verdieping/i;
    const names = [
      ...Object.values(fixture.states).map((s) => s.attributes.friendly_name),
      ...Object.values(fixture.devices).map((d) => d.name),
      ...Object.values(areas).map((a) => a.name),
      ...Object.values(floors).map((f) => f.name),
    ].filter((n): n is string => typeof n === 'string');
    expect(names.length).toBeGreaterThan(20);
    expect(names.filter((n) => dutch.test(n))).toEqual([]);
    const devices = Object.values(fixture.devices).map((d) => d.name);
    expect(devices).toEqual(expect.arrayContaining(['Living Room AC', 'Living Room AC control', 'Living Room AC outdoor unit', 'Living Room AC indoor unit', 'Living Room AC gateway', 'Studio AC']));
  });

  it('the Daikin fixtures stay as they are', () => {
    expect(allFixtures.states['climate.keuken_airco']).toBeDefined();
    expect(allFixtures.states['climate.living_room']).toBeUndefined();
  });

  it('the docs demo is English, the default demo is not', () => {
    const english = createDemo({ english: true });
    const daikin = createDemo();
    expect(english.hass.states['climate.living_room']).toBeDefined();
    expect(daikin.hass.states['climate.keuken_airco']).toBeDefined();
    english.dispose();
    daikin.dispose();
  });

  it('every entity the live cards and the docs examples use exists in the docs demo', () => {
    const demo = createDemo({ english: true });
    const lines = Object.values(pages)
      .flatMap((md) => md.split(/\r?\n/))
      .filter((l) => l.includes('<LiveCard'))
      .join('\n');
    const used = `${lines}\n${liveCard}`.match(/\b(?:climate|water_heater|humidifier|input_select|input_boolean|script|automation)\.[a-z0-9_]+/g) ?? [];
    expect(used.length).toBeGreaterThan(5);
    for (const id of used) expect(demo.hass.states[id], `${id} is not in the docs demo`).toBeDefined();
    demo.dispose();
  });

  it('no docs page or the theme names a Daikin fixture', () => {
    for (const [file, text] of Object.entries({ ...pages, 'LiveCard.vue': liveCard })) {
      expect(text, file).not.toMatch(/keuken|slaapkamer|nagelsalon|dual_setpoint|begane_grond/i);
    }
  });
});
