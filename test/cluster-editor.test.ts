// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import '../src/index';
import { clusterSource, normalizeClusterConfig, parseClusterRoom, pruneClusterConfig } from '../src/config';
import { migrateConfig } from '../src/migrate';
import { AREAS, FLOORS, allFixtures, makeHass, mergeFixtures } from './fixtures';
import { TRV, trvFixtures } from './fixtures/trv';
import type { HassEntity } from '../src/types';

const K = 'climate.keuken_airco';
type AnyEl = HTMLElement & Record<string, any>;

function editor(raw: Record<string, unknown> = {}, opts: { registry?: boolean; areas?: boolean } = {}) {
  const f = mergeFixtures(allFixtures);
  const hass = makeHass(f, '°C');
  hass.areas = opts.areas === false ? {} : structuredClone(AREAS);
  hass.floors = opts.areas === false ? {} : structuredClone(FLOORS);
  if (opts.registry) {
    (hass as any).callWS = async (m: { type: string }) =>
      m.type === 'config/entity_registry/list' ? Object.entries(f.registry).map(([entity_id, x]) => ({ entity_id, ...(x as object) })) : [];
  }
  const ed = document.createElement('liquid-climate-cluster-editor') as unknown as AnyEl;
  ed.setConfig({ type: 'custom:liquid-climate-cluster', ...raw });
  ed.hass = hass;
  const out: Record<string, unknown>[] = [];
  ed.addEventListener('config-changed', (e: Event) => out.push((e as CustomEvent).detail.config));
  document.body.append(ed);
  return { ed, out, last: () => out[out.length - 1] };
}
const $ = (el: AnyEl, sel: string) => el.shadowRoot!.querySelector(sel) as HTMLElement | null;
const $$ = (el: AnyEl, sel: string) => [...el.shadowRoot!.querySelectorAll(sel)] as HTMLElement[];
const text = (el: HTMLElement | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const radio = (ed: AnyEl, label: string) => $$(ed, '[role=radio]').find((b) => text(b) === label) as HTMLButtonElement;
const settle = async (ed: AnyEl) => {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await ed.updateComplete;
  }
};

describe('cluster source (E1)', () => {
  it('an emptied list stays a list', async () => {
    const { ed, last } = editor({ entities: [K] });
    await ed.updateComplete;
    ($(ed, `button[aria-label="Show Living Room"], button[aria-label="Show Keuken"]`) as HTMLButtonElement).click();
    await ed.updateComplete;
    expect(last()).toEqual({ type: 'custom:liquid-climate-cluster', source: 'list', config_version: 1 });
    expect(radio(ed, 'Choose').getAttribute('aria-checked')).toBe('true');
    expect(radio(ed, 'All').getAttribute('aria-checked')).toBe('false');
  });

  it('choosing the list with no rooms shown still switches the segment', async () => {
    const { ed, last } = editor({ source: 'floor', floor: 'nowhere' });
    await ed.updateComplete;
    radio(ed, 'Choose').click();
    await ed.updateComplete;
    expect(last().source).toBe('list');
    expect(radio(ed, 'Choose').getAttribute('aria-checked')).toBe('true');
  });

  it('old configs keep their implied source and do not write it', () => {
    expect(clusterSource(normalizeClusterConfig({ entities: [K] }))).toBe('list');
    expect(clusterSource(normalizeClusterConfig({ area: 'x' }))).toBe('area');
    expect(clusterSource(normalizeClusterConfig({ floor: 'x' }))).toBe('floor');
    expect(clusterSource(normalizeClusterConfig({}))).toBe('auto');
    expect(pruneClusterConfig(normalizeClusterConfig({ type: 't', area: 'x' }))).toEqual({ type: 't', area: 'x', config_version: 1 });
  });

  it('an explicit source wins over the other options', () => {
    expect(clusterSource(normalizeClusterConfig({ source: 'list', area: 'x' }))).toBe('list');
    expect(clusterSource(normalizeClusterConfig({ source: 'bogus', area: 'x' }))).toBe('area');
  });
});

describe('cluster editor detection (E2)', () => {
  it('writes the registry-detected sensors as room overrides, only where they differ from auto', async () => {
    const { ed, last } = editor({}, { registry: true });
    await settle(ed);
    const rooms = last().rooms as { entity: string; sensors: Record<string, unknown> }[];
    const keuken = rooms.find((r) => r.entity === K)!;
    expect(keuken.sensors.outdoor).toBe('sensor.keuken_airco_buitentemperatuur');
    expect(keuken.sensors.cloud_limit).toBe('sensor.keuken_airco_gateway_ratelimit_remaining_day');
    expect(keuken.sensors.energy).toBeDefined();
    // Roles the card finds by itself are not written, and rooms without a Daikin unit stay out.
    expect(keuken.sensors.humidity).toBeUndefined();
    expect(rooms.some((r) => r.entity === 'climate.dual_setpoint')).toBe(false);
  });

  it('does nothing without registry access', async () => {
    const { ed, out } = editor({}, { registry: false });
    await settle(ed);
    expect(out).toEqual([]);
  });

  it('keeps a sensor the room already sets', async () => {
    const { ed, last } = editor({ rooms: [{ entity: K, sensors: { outdoor: 'sensor.mine' } }] }, { registry: true });
    await settle(ed);
    const keuken = (last().rooms as { entity: string; sensors: Record<string, unknown> }[]).find((r) => r.entity === K)!;
    expect(keuken.sensors.outdoor).toBe('sensor.mine');
    expect(keuken.sensors.cloud_limit).toBe('sensor.keuken_airco_gateway_ratelimit_remaining_day');
  });
});

describe('cluster editor writes the valve (Z2M radiator valve with only an opening contact)', () => {
  const VALVE = 'sensor.trv_sonoff_pi_heating_demand';
  const OPENING = 'binary_sensor.trv_sonoff_opening';

  /** Edit a cluster of the Sonoff unit, then mount a cluster card on the saved config. */
  async function run(room: Record<string, unknown>) {
    const f = mergeFixtures(allFixtures, trvFixtures);
    delete f.states['binary_sensor.trv_sonoff_window_open'];
    f.states[OPENING] = { entity_id: OPENING, state: 'on', attributes: { device_class: 'opening' } } as HassEntity;
    f.entities[OPENING] = { entity_id: OPENING, platform: 'mqtt', device_id: 'dev_trv_sonoff', translation_key: null };
    const hass = makeHass(f, '°C');
    (hass as any).callWS = async (m: { type: string }) =>
      m.type === 'config/entity_registry/list' ? Object.entries(f.registry).map(([entity_id, x]) => ({ entity_id, ...(x as object) })) : [];
    const ed = document.createElement('liquid-climate-cluster-editor') as unknown as AnyEl;
    ed.setConfig({ type: 'custom:liquid-climate-cluster', entities: [{ entity: TRV.sonoff, ...room }] });
    ed.hass = hass;
    const out: Record<string, any>[] = [];
    ed.addEventListener('config-changed', (e: Event) => out.push((e as CustomEvent).detail.config));
    document.body.append(ed);
    await settle(ed);
    const saved = out[out.length - 1] ?? { type: 'custom:liquid-climate-cluster', entities: [{ entity: TRV.sonoff, ...room }] };
    const card = document.createElement('liquid-climate-cluster') as unknown as AnyEl;
    card.setConfig(saved);
    card.hass = hass;
    document.body.append(card);
    await card.updateComplete;
    return { saved, foot: text($(card, '.room .foot')) };
  }

  it('writes the valve found through the registry, so the opening contact pauses the room', async () => {
    const { saved, foot } = await run({});
    expect(saved.entities[0].sensors.valve).toBe(VALVE);
    expect(foot).toBe('Paused');
  });

  it('valve: false is kept, and the opening contact does not pause the room', async () => {
    const { saved, foot } = await run({ sensors: { valve: false } });
    expect(saved.entities[0].sensors.valve).toBe(false);
    expect(foot).not.toBe('Paused');
  });

  it('keeps a valve the room already sets', async () => {
    const { saved } = await run({ sensors: { valve: 'sensor.mine' } });
    expect(saved.entities[0].sensors.valve).toBe('sensor.mine');
  });
});

describe('cluster editor selects (E3)', () => {
  it('a stale area id shows a disabled placeholder', async () => {
    const { ed } = editor({ area: 'gone' });
    await ed.updateComplete;
    const placeholder = $(ed, 'select option[value=""]') as HTMLOptionElement;
    expect(placeholder.disabled).toBe(true);
    expect(placeholder.hasAttribute('selected')).toBe(true);
  });

  it('a known area does not select the placeholder', async () => {
    const { ed } = editor({ area: 'achtertuin' });
    await ed.updateComplete;
    expect(($(ed, 'select option[value=""]') as HTMLOptionElement).hasAttribute('selected')).toBe(false);
  });

  it('without areas and floors the one-area and one-floor options are disabled', async () => {
    const { ed } = editor({}, { areas: false });
    await ed.updateComplete;
    expect((radio(ed, 'One area') as HTMLButtonElement).disabled).toBe(true);
    expect((radio(ed, 'One floor') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the hint under the control when the source has no areas', async () => {
    const { ed } = editor({ source: 'area' }, { areas: false });
    await ed.updateComplete;
    expect(text(ed.shadowRoot!.querySelector('.body'))).toContain('No areas set in Home Assistant.');
    const f = editor({ source: 'floor' }, { areas: false });
    await f.ed.updateComplete;
    expect(text(f.ed.shadowRoot!.querySelector('.body'))).toContain('No floors set in Home Assistant.');
  });
});

describe('cluster editor a11y and copy (E4)', () => {
  it('the edit button names the room and controls the panel', async () => {
    const { ed } = editor();
    await ed.updateComplete;
    const btn = $(ed, 'button[aria-label="Edit Keuken"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    await ed.updateComplete;
    const panel = $(ed, '.override')!;
    expect(btn.getAttribute('aria-controls')).toBe(panel.id);
    expect(text(panel)).toContain('Shows the room as Paused while this entity is on, for example a window contact.');
  });

  it('the rooms list is a labelled group and the copy uses one noun', async () => {
    const { ed } = editor();
    await ed.updateComplete;
    const group = $(ed, '.rooms[role=group]')!;
    expect(text($(ed, `#${group.getAttribute('aria-labelledby')}`))).toBe('Rooms');
    const body = text($(ed, '.body'));
    expect(body).toContain('Sensor and control options are set in YAML and apply to every room.');
    expect(body).not.toContain('Units');
    expect(body).not.toContain('Pick');
    expect(radio(ed, 'Choose')).toBeTruthy();
  });
});

describe('cluster config (E5)', () => {
  it('keeps only known roles with valid sensor settings', () => {
    const room = parseClusterRoom({
      entity: K,
      sensors: {
        outdoor: 'sensor.o',
        humidity: false,
        energy: ['sensor.a', { entity: 'sensor.b', name: 'B' }],
        health: [],
        cloud_limit: 5,
        bogus: 'sensor.x',
        outdoor2: 'sensor.y',
      },
    });
    expect(room?.sensors).toEqual({ outdoor: 'sensor.o', humidity: false, energy: ['sensor.a', { entity: 'sensor.b', name: 'B' }] });
    expect(parseClusterRoom({ entity: K, sensors: { bogus: 'x' } })).toEqual({ entity: K });
    expect(parseClusterRoom({ entity: K, sensors: { outdoor: ['a', 'b'] } })).toEqual({ entity: K });
  });

  it('stamps cluster configs through their own step table', () => {
    expect(migrateConfig({ type: 'custom:liquid-climate-cluster' }).config_version).toBe(1);
    expect(migrateConfig({ type: 'custom:liquid-climate-cluster', config_version: 1 })).toEqual({ type: 'custom:liquid-climate-cluster', config_version: 1 });
  });
});
