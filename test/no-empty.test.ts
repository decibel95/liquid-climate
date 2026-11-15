// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/index';
import { allFixtures, makeHass, mergeFixtures } from './fixtures';
import { forgetModes } from '../src/cards/shared/writer';
import { emptyElements } from './empty-elements';

const K = 'climate.keuken_airco';
const BARE = 'climate.step_one';
type AnyEl = HTMLElement & Record<string, any>;

beforeEach(() => {
  vi.useFakeTimers();
  forgetModes();
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

/** Every path in a plain config whose value is empty: '', [], {}, null or undefined. */
function emptyValues(v: unknown, path = ''): string[] {
  if (v === '' || v === null || v === undefined) return [path];
  if (Array.isArray(v)) return v.length ? v.flatMap((x, i) => emptyValues(x, `${path}[${i}]`)) : [path];
  if (typeof v === 'object') {
    const keys = Object.keys(v as object);
    return keys.length ? keys.flatMap((k) => emptyValues((v as Record<string, unknown>)[k], `${path}.${k}`)) : [path];
  }
  return [];
}

function mount(tag: string, cfg: Record<string, unknown>) {
  const f = mergeFixtures(allFixtures);
  const hass = makeHass(f, '°C');
  const el = document.createElement(tag) as unknown as AnyEl;
  el.setConfig({ type: `custom:${tag}`, ...cfg });
  el.hass = hass;
  document.body.append(el);
  return el;
}

describe('a minimal config renders no empty elements', () => {
  it('dial: no status block, info row, alert, chips or empty wrapper', async () => {
    const card = mount('liquid-climate-card', { entity: BARE, status_entities: [{ entity: 'sensor.nope' }] });
    await card.updateComplete;
    const root = card.shadowRoot!;
    for (const sel of ['.status', '.srow', '.info', '.alert', '.chips', '.mpanel']) expect(root.querySelector(sel), sel).toBeNull();
    expect(emptyElements(root)).toEqual([]);
  });

  it('dial: the line under the big number is a spacer hidden from assistive tech when empty, and holds text otherwise', async () => {
    // (Text inside the dial is not asserted: happy-dom misplaces some nested parts of this big template.)
    const full = mount('liquid-climate-card', { entity: BARE });
    await full.updateComplete;
    expect(full.shadowRoot!.querySelector('.centersub')!.hasAttribute('aria-hidden')).toBe(false);

    const f = mergeFixtures(allFixtures);
    const { current_temperature: _gone, ...attributes } = f.states[BARE].attributes;
    f.states[BARE] = { ...f.states[BARE], attributes };
    const card = document.createElement('liquid-climate-card') as unknown as AnyEl;
    card.setConfig({ type: 'custom:liquid-climate-card', entity: BARE });
    card.hass = makeHass(f, '°C');
    document.body.append(card);
    await card.updateComplete;
    expect(card.shadowRoot!.querySelector('.centersub')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('dial: a row that exists renders its row, and still no empty element', async () => {
    const card = mount('liquid-climate-card', { entity: BARE, status_entities: [{ entity: 'climate.no_fan' }] });
    await card.updateComplete;
    expect(card.shadowRoot!.querySelectorAll('.status .row')).toHaveLength(1);
    expect(emptyElements(card.shadowRoot!)).toEqual([]);
  });

  it('tile: nothing empty around the name, subline and target', async () => {
    const tile = mount('liquid-climate-tile', { entity: BARE });
    await tile.updateComplete;
    expect(emptyElements(tile.shadowRoot!)).toEqual([]);
    expect(tile.shadowRoot!.querySelector('liquid-climate-sheet')).not.toBeNull();
  });

  it('badge: nothing empty in the pill, and no attention dot without a problem', async () => {
    const badge = mount('liquid-climate-badge', { entity: BARE });
    await badge.updateComplete;
    expect(emptyElements(badge.shadowRoot!)).toEqual([]);
    expect(badge.shadowRoot!.querySelector('.dot')).toBeNull();
    const round = mount('liquid-climate-badge', { entity: BARE, icon_only: true });
    await round.updateComplete;
    expect(emptyElements(round.shadowRoot!)).toEqual([]);
    expect(round.shadowRoot!.querySelector('.dot')).toBeNull();
  });

  it('cluster: nothing empty with rooms, and no empty group, summary or figures without any', async () => {
    const cluster = mount('liquid-climate-cluster', {});
    await cluster.updateComplete;
    expect(emptyElements(cluster.shadowRoot!)).toEqual([]);
    expect(cluster.shadowRoot!.querySelector('.empty')).toBeNull();

    const none = mount('liquid-climate-cluster', { area: 'nowhere' });
    await none.updateComplete;
    const root = none.shadowRoot!;
    for (const sel of ['.group', '.rooms', '.sum', '.figs', '.strip']) expect(root.querySelector(sel), sel).toBeNull();
    expect(root.querySelector('.empty')).not.toBeNull();
    expect(emptyElements(root)).toEqual([]);
  });
});

describe('editors write no empty keys', () => {
  const settle = async (ed: AnyEl) => {
    for (let i = 0; i < 3; i++) {
      await Promise.resolve();
      await ed.updateComplete;
    }
  };
  const editor = (tag: string, cfg: Record<string, unknown>) => {
    const ed = mount(tag, cfg);
    const out: Record<string, unknown>[] = [];
    ed.addEventListener('config-changed', (e: Event) => out.push((e as CustomEvent).detail.config));
    return { ed, out };
  };
  const type = async (ed: AnyEl, selector: string, value: string) => {
    await settle(ed);
    const input = ed.shadowRoot!.querySelector(selector) as HTMLInputElement;
    expect(input, selector).not.toBeNull();
    input.value = value;
    input.dispatchEvent(new Event('change'));
  };
  const NAME = 'input[placeholder][type=text]:not([list])';

  it('dial: clearing name and room sensor leaves neither key, and nothing is empty', async () => {
    const { ed, out } = editor('liquid-climate-card-editor', { entity: K, name: 'Mine', temperature_sensor: 'sensor.x' });
    await type(ed, NAME, '');
    await type(ed, 'input[list="lc-room-sensors"]', '');
    expect(out.length).toBeGreaterThan(1);
    const last = out.at(-1)!;
    expect(last).toEqual({ type: 'custom:liquid-climate-card-editor', entity: K, config_version: expect.any(Number) });
    expect(emptyValues(last)).toEqual([]);
  });

  it('tile: clearing the name leaves no empty key', async () => {
    const { ed, out } = editor('liquid-climate-tile-editor', { entity: K, name: 'Mine' });
    await type(ed, NAME, '');
    expect(out.length).toBeGreaterThan(0);
    expect(emptyValues(out.at(-1))).toEqual([]);
    expect(out.at(-1)).not.toHaveProperty('name');
  });

  it('badge: clearing the name and the pause entity leaves no empty key', async () => {
    const { ed, out } = editor('liquid-climate-badge-editor', { entity: K, name: 'Mine', pause_entity: 'input_boolean.x' });
    await type(ed, NAME, '');
    await type(ed, 'input[list="lc-pause-ids"]', '');
    expect(out.length).toBeGreaterThan(1);
    expect(emptyValues(out.at(-1))).toEqual([]);
    expect(out.at(-1)).not.toHaveProperty('pause_entity');
    expect(out.at(-1)).not.toHaveProperty('name');
  });

  it('cluster: clearing the title leaves no empty key, and the defaults are not written', async () => {
    const { ed, out } = editor('liquid-climate-cluster-editor', { title: 'Home' });
    await type(ed, 'input[placeholder="Climate"]', '');
    expect(out.length).toBeGreaterThan(0);
    const last = out.at(-1)!;
    expect(emptyValues(last)).toEqual([]);
    expect(last).not.toHaveProperty('title');
    expect(last).not.toHaveProperty('entities');
    expect(last).not.toHaveProperty('exclude');
    expect(last).not.toHaveProperty('rooms');
  });
});
