// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import '../src/index';
import { allFixtures, makeHass, mergeFixtures } from './fixtures';
import { TRV, trvFixtures } from './fixtures/trv';
import type { HomeAssistant } from '../src/types';

type AnyEl = HTMLElement & Record<string, any>;

const f = mergeFixtures(allFixtures, trvFixtures);
const hassWithRegistry = (): HomeAssistant => {
  const hass = makeHass(f);
  hass.callWS = (async (msg: Record<string, unknown>) => {
    if (msg.type === 'config/entity_registry/list') return Object.entries(f.registry).map(([entity_id, x]) => ({ entity_id, ...x }));
    throw new Error('unsupported');
  }) as HomeAssistant['callWS'];
  return hass;
};

const flush = async (ed: AnyEl) => {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await ed.updateComplete;
  }
};

async function editor(tag: string, config: Record<string, unknown>) {
  const out: Record<string, any>[] = [];
  const ed = document.createElement(tag) as unknown as AnyEl;
  ed.setConfig(config);
  ed.hass = hassWithRegistry();
  ed.addEventListener('config-changed', (e) => out.push((e as CustomEvent).detail.config));
  document.body.append(ed);
  await flush(ed);
  return { ed, last: () => out[out.length - 1], out };
}

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const tab = (ed: AnyEl, name: string) => [...ed.shadowRoot!.querySelectorAll<HTMLElement>('[role=tab]')].find((t) => text(t) === name)!;
const radio = (ed: AnyEl, group: string, label: string) =>
  [...ed.shadowRoot!.querySelectorAll<HTMLElement>(`[role=radiogroup][aria-label="${group}"] [role=radio]`)].find((r) => text(r) === label)!;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('editors: write_hold', () => {
  it('dial: the Controls tab offers 10, 30 and 60 s; 10 is the default and is not saved', async () => {
    const { ed, last } = await editor('liquid-climate-card-editor', { type: 'custom:liquid-climate-card', entity: TRV.sonoff });
    tab(ed, 'Controls').click();
    await flush(ed);
    const labels = [...ed.shadowRoot!.querySelectorAll('[role=radiogroup][aria-label="Show sent value for"] [role=radio]')].map(text);
    expect(labels).toEqual(['10 s', '30 s', '60 s']);
    expect(radio(ed, 'Show sent value for', '10 s').getAttribute('aria-checked')).toBe('true');
    radio(ed, 'Show sent value for', '30 s').click();
    expect(last().write_hold).toBe(30);
    await flush(ed);
    expect(radio(ed, 'Show sent value for', '30 s').getAttribute('aria-checked')).toBe('true');
    radio(ed, 'Show sent value for', '10 s').click();
    expect(last()).not.toHaveProperty('write_hold');
  });

  it('tile: has it next to the write delay', async () => {
    const { ed, last } = await editor('liquid-climate-tile-editor', { type: 'custom:liquid-climate-tile', entity: TRV.sonoff });
    radio(ed, 'Show sent value for', '60 s').click();
    expect(last().write_hold).toBe(60);
  });

  it('cluster: has it next to the write delay', async () => {
    const { ed, last } = await editor('liquid-climate-cluster-editor', { type: 'custom:liquid-climate-cluster', entities: [TRV.sonoff] });
    radio(ed, 'Show sent value for', '30 s').click();
    expect(last().write_hold).toBe(30);
  });
});

describe('dial editor: sensors of a radiator valve', () => {
  const rows = (ed: AnyEl) => [...ed.shadowRoot!.querySelectorAll('.row .name')].map(text);

  it('lists the battery, the valve position and the window contact once found, and writes the valve out', async () => {
    const { ed, last } = await editor('liquid-climate-card-editor', { type: 'custom:liquid-climate-card', entity: TRV.sonoff });
    tab(ed, 'Sensors').click();
    await flush(ed);
    expect(rows(ed)).toEqual(expect.arrayContaining(['Battery', 'Valve position']));
    // The dial does not read the window contact, so its editor has no row for it.
    expect(rows(ed)).not.toContain('Window contact');
    const sw = ed.shadowRoot!.querySelector<HTMLElement>('button[aria-label="Show Valve position"]')!;
    sw.click();
    // The registry resolved the valve, so it is written as an entity id; battery stays auto.
    expect(last().sensors).toMatchObject({ valve: false });
    expect(last().sensors).not.toHaveProperty('battery');
  });

  it('shows none of the three rows for a unit that has none', async () => {
    const { ed } = await editor('liquid-climate-card-editor', { type: 'custom:liquid-climate-card', entity: 'climate.keuken_airco' });
    tab(ed, 'Sensors').click();
    await flush(ed);
    expect(rows(ed)).not.toEqual(expect.arrayContaining(['Battery']));
    expect(rows(ed).some((n) => /Valve position|Window contact|^Battery$/.test(n))).toBe(false);
  });

  it('a row set to false stays visible so it can be switched on again', async () => {
    const { ed } = await editor('liquid-climate-card-editor', { type: 'custom:liquid-climate-card', entity: 'climate.keuken_airco', sensors: { battery: false } });
    tab(ed, 'Sensors').click();
    await flush(ed);
    expect(rows(ed)).toContain('Battery');
  });
});
