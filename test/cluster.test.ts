// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/index';
import { compactRoom, normalizeClusterConfig, pruneClusterConfig, type ClusterConfig } from '../src/config';
import { migrateConfig } from '../src/migrate';
import { areaOf, clusterGroups } from '../src/cards/cluster/grouping';
import { clusterSummary, type RoomModel } from '../src/cards/cluster/model';
import { forgetModes } from '../src/cards/shared/writer';
import { hassNeedsRender } from '../src/cards/shared/render-gate';
import { LiquidClimateCluster } from '../src/cards/cluster/liquid-climate-cluster';
import type { LiquidClimateSheet } from '../src/cards/shared/sheet';
import type { HomeAssistant } from '../src/types';
import { AREAS, FLOORS, allFixtures, makeHass, mergeFixtures, type Fixture } from './fixtures';

const K = 'climate.keuken_airco';
const S = 'climate.slaapkamer_airco';
const N = 'climate.nagelsalon_airco';
type AnyEl = HTMLElement & Record<string, any>;

function home(tweak?: (f: Fixture) => void, callService?: HomeAssistant['callService']) {
  const f = mergeFixtures(allFixtures);
  tweak?.(f);
  const hass = makeHass(f, '°C', callService);
  hass.areas = structuredClone(AREAS);
  hass.floors = structuredClone(FLOORS);
  return { f, hass };
}

const cfg = (raw: Record<string, unknown> = {}): ClusterConfig => normalizeClusterConfig(migrateConfig(raw));
const names = (hass: HomeAssistant, raw: Record<string, unknown> = {}) =>
  clusterGroups(hass, cfg(raw)).map((g) => [g.title, g.rooms.map((r) => r.name)]);

/** Daikin energy and outdoor sensors per room (the fixtures carry no translation keys, so runtime detection leaves them). */
const daikinSensors = (slug: string) => ({
  outdoor: `sensor.${slug}_airco_buitentemperatuur`,
  energy: [`sensor.${slug}_airco_energie_verwarmen_dag`, `sensor.${slug}_airco_energie_koelen_dag`],
  cloud_limit: `sensor.${slug}_airco_gateway_ratelimit_remaining_day`,
});
const DAIKIN_ROOMS = [
  { entity: K, name: 'Living Room', sensors: daikinSensors('keuken') },
  { entity: S, sensors: daikinSensors('slaapkamer') },
  { entity: N, sensors: daikinSensors('nagelsalon') },
];

function setup(raw: Record<string, unknown> = {}, tweak?: (f: Fixture) => void) {
  const calls: { service: string; data: any }[] = [];
  const { f, hass } = home(tweak, (_d, service, data) => void calls.push({ service, data: data as any }));
  const card = document.createElement('liquid-climate-cluster') as unknown as AnyEl;
  card.setConfig({ type: 'custom:liquid-climate-cluster', ...raw });
  card.hass = hass;
  document.body.append(card);
  return { card, hass, calls, f };
}

const $ = (el: AnyEl, sel: string) => el.shadowRoot!.querySelector(sel) as HTMLElement | null;
const $$ = (el: AnyEl, sel: string) => [...el.shadowRoot!.querySelectorAll(sel)] as HTMLElement[];
const text = (el: HTMLElement | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const rooms = (c: AnyEl) => $$(c, 'button.room') as HTMLButtonElement[];
const room = (c: AnyEl, name: string) => rooms(c).find((b) => text(b.querySelector('.rname')) === name)!;
const modeButtons = (c: AnyEl) => $$(c, '.strip button.mode') as HTMLButtonElement[];
const shown = (el: Element, sel: string) => el.querySelector(sel)!.getAttribute('display') !== 'none';
const steps = (c: AnyEl) => $$(c, '.strip button.step') as HTMLButtonElement[];

beforeEach(() => {
  vi.useFakeTimers();
  forgetModes();
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('cluster grouping and order', () => {
  it('no entities: every climate entity by floor level, area name, entity name, with floor headings', () => {
    const { hass } = home();
    expect(names(hass)).toEqual([
      ['Begane grond', ['Keuken', 'Nagelsalon']],
      ['Eerste verdieping', ['Slaapkamer']],
      ['Other', ['dual_setpoint', 'fahrenheit', 'no_fan', 'no_swing', 'step_one']],
    ]);
  });

  it('names a room after its area only when it is the only unit there', () => {
    const { hass } = home();
    const refs = clusterGroups(hass, cfg()).flatMap((g) => g.rooms);
    expect(refs.find((r) => r.room.entity === K)!.name).toBe('Keuken');
    // Five units share the lab: they keep their entity names.
    expect(refs.find((r) => r.room.entity === 'climate.no_fan')!.name).toBe('no_fan');
  });

  it('floors with the same level and name are ordered by id', () => {
    const { hass } = home();
    hass.floors!.a_twin = { floor_id: 'a_twin', name: 'Begane grond', level: 0 };
    hass.areas!.slaapkamer = { ...hass.areas!.slaapkamer, floor_id: 'a_twin' };
    // Without the tie-break the twin floors compare equal and the order follows the states.
    expect(names(hass).map(([, list]) => list)).toEqual([['Slaapkamer'], ['Keuken', 'Nagelsalon'], expect.any(Array)]);
  });

  it('floors without a level follow the numbered ones; areas without a floor go last', () => {
    const { hass } = home();
    hass.floors!.zolder = { floor_id: 'zolder', name: 'Zolder', level: null };
    hass.areas!.lab = { ...hass.areas!.lab, floor_id: 'zolder' };
    hass.floors!.eerste = { ...hass.floors!.eerste, level: -1 };
    expect(names(hass).map(([t]) => t)).toEqual(['Eerste verdieping', 'Begane grond', 'Zolder']);
  });

  it('a change to the area or floor registry re-renders', () => {
    const { hass } = home();
    expect(hassNeedsRender(hass, { ...hass }, [K])).toBe(false);
    expect(hassNeedsRender(hass, { ...hass, areas: { ...hass.areas } }, [K])).toBe(true);
    expect(hassNeedsRender(hass, { ...hass, floors: { ...hass.floors } }, [K])).toBe(true);
  });

  it('translations arriving later (a new localize or format function) re-render', () => {
    const { hass } = home();
    expect(hassNeedsRender(hass, { ...hass, localize: () => 'x' }, [K])).toBe(true);
    expect(hassNeedsRender(hass, { ...hass, formatEntityState: () => 'x' }, [K])).toBe(true);
    expect(hassNeedsRender(hass, { ...hass, formatEntityAttributeValue: () => 'x' }, [K])).toBe(true);
  });

  it('the entity area wins over the device area, which is the fallback', () => {
    const { hass } = home();
    expect(areaOf(hass, K)).toBe('keuken');
    hass.entities[K] = { ...hass.entities[K], area_id: 'slaapkamer' };
    expect(areaOf(hass, K)).toBe('slaapkamer');
    expect(areaOf(hass, 'climate.missing')).toBeUndefined();
  });

  it('leaves out hidden, disabled and excluded entities', () => {
    const { hass } = home();
    hass.entities['climate.no_fan'] = { ...hass.entities['climate.no_fan'], hidden: true };
    hass.entities['climate.no_swing'] = { ...hass.entities['climate.no_swing'], hidden_by: 'user' };
    hass.entities['climate.step_one'] = { ...hass.entities['climate.step_one'], disabled_by: 'integration' };
    expect(names(hass, { exclude: ['climate.fahrenheit'] })).toEqual([
      ['Begane grond', ['Keuken', 'Nagelsalon']],
      ['Eerste verdieping', ['Slaapkamer']],
      ['Other', ['Lab']],
    ]);
  });

  it('area and floor pick one of them, without headings', () => {
    const { hass } = home();
    expect(names(hass, { area: 'slaapkamer' })).toEqual([[null, ['Slaapkamer']]]);
    expect(names(hass, { floor: 'begane_grond' })).toEqual([[null, ['Keuken', 'Nagelsalon']]]);
  });

  it('group_by area: one list by area name, units without an area last', () => {
    const { hass } = home();
    hass.entities['climate.step_one'] = { ...hass.entities['climate.step_one'], device_id: null };
    hass.devices.dev_step1 = { ...hass.devices.dev_step1, area_id: null };
    const [[title, list]] = names(hass, { group_by: 'area' });
    expect(title).toBeNull();
    expect(list).toEqual(['Keuken', 'dual_setpoint', 'fahrenheit', 'no_fan', 'no_swing', 'Nagelsalon', 'Slaapkamer', 'step_one']);
  });

  it('without floors in HA there is one group and no heading', () => {
    const { hass } = home();
    hass.floors = {};
    for (const a of Object.values(hass.areas!)) a.floor_id = null;
    const groups = clusterGroups(hass, cfg());
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBeNull();
  });

  it('an entities list keeps its order and its names, and ignores area and floor', () => {
    const { hass } = home();
    expect(names(hass, { entities: [N, { entity: K, name: 'Living Room' }, 'climate.no_fan'], area: 'lab' })).toEqual([
      [null, ['Nagelsalon', 'Living Room', 'Lab']],
    ]);
  });

  it('auto overrides in rooms rename a unit', () => {
    const { hass } = home();
    expect(names(hass, { area: 'keuken', rooms: [{ entity: K, name: 'Living Room' }] })).toEqual([[null, ['Living Room']]]);
  });
});

describe('cluster config', () => {
  it('parses ids and objects, drops bad items and stamps config_version 1', () => {
    const c = cfg({ entities: [K, { entity: S, name: ' Bed ', pause_entity: 'binary_sensor.w', sensors: { health: false } }, 7, {}] });
    expect(c.entities).toEqual([{ entity: K }, { entity: S, name: 'Bed', pause_entity: 'binary_sensor.w', sensors: { health: false } }]);
    expect(c.config_version).toBe(1);
    expect(c.group_by).toBe('floor');
    expect(c.write_delay).toBe(1.5);
  });

  it('prunes defaults and writes rooms without overrides as plain ids', () => {
    expect(pruneClusterConfig(cfg({ type: 'custom:liquid-climate-cluster' }))).toEqual({ type: 'custom:liquid-climate-cluster', config_version: 1 });
    const out = pruneClusterConfig(cfg({ entities: [K, { entity: S, name: 'Bed' }], rooms: [{ entity: N }], look: { glass: 'dark' } }));
    expect(out).toEqual({
      type: 'custom:liquid-climate-cluster',
      entities: [K, { entity: S, name: 'Bed' }],
      look: { glass: 'dark' },
      config_version: 1,
    });
    expect(compactRoom({ entity: K, sensors: {} })).toBe(K);
  });

  it('rejects a non-climate entity in the list', () => {
    const card = document.createElement('liquid-climate-cluster') as unknown as AnyEl;
    expect(() => card.setConfig({ entities: ['sensor.x'] })).toThrow(/not a climate entity/);
  });

  it('is in the card picker with an auto stub, a config element and a full-width grid size', async () => {
    expect(window.customCards!.some((c) => c.type === 'liquid-climate-cluster')).toBe(true);
    expect(LiquidClimateCluster.getStubConfig()).toEqual({ type: 'custom:liquid-climate-cluster', config_version: 1 });
    expect((await LiquidClimateCluster.getConfigElement()).tagName.toLowerCase()).toBe('liquid-climate-cluster-editor');
    // Full width of the section, so a column_span 2 section is filled, never half of it.
    expect(new LiquidClimateCluster().getGridOptions()).toEqual({ columns: 'full', rows: 'auto', min_columns: 12 });
  });
});

describe('cluster card', () => {
  it('renders the title, floor headings and one room per unit; the first room is selected', async () => {
    const { card } = setup({ title: 'House' });
    await card.updateComplete;
    expect(text($(card, 'h2'))).toBe('House');
    expect($$(card, 'h3.floor').map(text)).toEqual(['Begane grond', 'Eerste verdieping', 'Other']);
    expect(rooms(card)).toHaveLength(8);
    expect(rooms(card).map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', ...Array(7).fill('false')]);
    expect(text($(card, '.strip .sname'))).toBe('Keuken');
  });

  it('a room shows its target, the inside temperature and a footer; its label says it all', async () => {
    const { card } = setup({ entities: [K] });
    await card.updateComplete;
    const r = room(card, 'Keuken');
    expect(text(r.querySelector('.tline'))).toBe('19.5°');
    expect(text(r.querySelector('.inside'))).toBe('Inside 21.0°');
    expect(text(r.querySelector('.foot'))).toBe('Heating, fan 2');
    expect(r.getAttribute('aria-label')).toBe('Keuken, Heating, target 19.5 °C, inside 21.0 °C');
    // Target arc and knob in the heat colour, room temperature dot, lit fan segments.
    expect(r.querySelector('path.prog')!.getAttribute('stroke')).toBe('#ff9447');
    expect(shown(r, 'path.prog')).toBe(true);
    expect(shown(r, 'circle.knob')).toBe(true);
    expect(shown(r, 'circle.dot')).toBe(true);
    // Fan "2" of auto, quiet, 1, 2, ...: auto stays dark, quiet up to 2 light up.
    expect(r.querySelector('path.fan-lit')!.getAttribute('d')!.match(/M /g)).toHaveLength(3);
  });

  it('tapping a room selects it and moves the strip there', async () => {
    const { card } = setup({ entities: [K, S] });
    await card.updateComplete;
    room(card, 'Slaapkamer').click();
    await card.updateComplete;
    expect(room(card, 'Slaapkamer').getAttribute('aria-pressed')).toBe('true');
    expect(room(card, 'Keuken').getAttribute('aria-pressed')).toBe('false');
    expect(text($(card, '.strip .sname'))).toBe('Slaapkamer');
    expect(text($(card, '.strip .sverb'))).toBe('Cooling');
  });

  it('the mode strip shows only modes the entity supports, in config order', async () => {
    const { card } = setup({ entities: ['climate.no_swing', K], controls: { modes: ['off', 'heat', 'cool', 'dry', 'fan_only'] } });
    await card.updateComplete;
    expect(modeButtons(card).map((b) => b.getAttribute('aria-label'))).toEqual(['Off', 'Cool', 'Dry', 'Fan only']);
    expect(modeButtons(card).find((b) => b.getAttribute('aria-pressed') === 'true')!.getAttribute('aria-label')).toBe('Cool');
    rooms(card)[1].click();
    await card.updateComplete;
    expect(modeButtons(card).map((b) => b.getAttribute('aria-label'))).toEqual(['Off', 'Heat', 'Cool', 'Dry', 'Fan only']);
  });

  it('mode buttons write through the shared writer after write_delay', async () => {
    const { card, calls } = setup({ entities: [K], write_delay: 1 });
    await card.updateComplete;
    modeButtons(card).find((b) => b.getAttribute('aria-label') === 'Cool')!.click();
    await vi.advanceTimersByTimeAsync(900);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(calls).toEqual([{ service: 'set_hvac_mode', data: { entity_id: K, hvac_mode: 'cool' } }]);
  });

  it('steppers coalesce with a tile on the same entity into one write', async () => {
    const { card, hass, calls } = setup({ entities: [K] });
    const tile = document.createElement('liquid-climate-tile') as unknown as AnyEl;
    tile.setConfig({ entity: K });
    tile.hass = hass;
    document.body.append(tile);
    await card.updateComplete;
    await tile.updateComplete;
    steps(card)[1].click(); // 19.5 -> 20.0
    await card.updateComplete;
    (tile.shadowRoot!.querySelectorAll('button.step')[1] as HTMLButtonElement).click(); // 20.0 -> 20.5, same queue
    await vi.advanceTimersByTimeAsync(0);
    await card.updateComplete;
    await tile.updateComplete;
    // Both show the pending value before anything is sent.
    expect(text($(card, '.strip .target .tval'))).toBe('20.5°');
    expect(text(tile.shadowRoot!.querySelector('.target'))).toBe('20.5°');
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toEqual([{ service: 'set_temperature', data: { entity_id: K, temperature: 20.5 } }]);
  });

  it('steppers stop at the limits and are aria-disabled while off, keeping focus and ignoring clicks', async () => {
    const { card, calls } = setup({ entities: [N, K] }, (f) => (f.states[K].attributes.temperature = 30));
    await card.updateComplete;
    const dis = () => steps(card).map((b) => b.getAttribute('aria-disabled'));
    expect(dis()).toEqual(['true', 'true']);
    expect(steps(card).some((b) => b.disabled)).toBe(false);
    expect(text($(card, '.strip .target .tval'))).toBe('--');
    expect(text(room(card, 'Nagelsalon').querySelector('.tline'))).toBe('Off');
    room(card, 'Keuken').click();
    await card.updateComplete;
    expect(dis()).toEqual(['false', 'true']);
    steps(card)[1].click();
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toEqual([]);
  });

  it('the target is announced atomically with a Target prefix', async () => {
    const { card } = setup({ entities: [K] });
    await card.updateComplete;
    const t = $(card, '.strip .target')!;
    expect(t.getAttribute('aria-live')).toBe('polite');
    expect(t.getAttribute('aria-atomic')).toBe('true');
    expect(text(t)).toBe('Target 19.5°');
  });

  it('a dual setpoint shows its range, hides the steppers and opens the dial to edit it', async () => {
    const { card } = setup({ entities: ['climate.dual_setpoint'] });
    await card.updateComplete;
    expect(text(rooms(card)[0].querySelector('.tline'))).toBe('19.0–24.0°');
    expect(rooms(card)[0].getAttribute('aria-label')).toContain('target 19.0 to 24.0');
    expect(steps(card)).toHaveLength(0);
    const range = $(card, '.strip button.range') as HTMLButtonElement;
    expect(text(range)).toBe('19.0–24.0°');
    range.click();
    await vi.advanceTimersByTimeAsync(0);
    const sheet = $(card, 'liquid-climate-sheet') as unknown as LiquidClimateSheet;
    expect(sheet.isOpen).toBe(true);
  });

  it('the name in the strip opens the room in the dial sheet, with the room name and overrides', async () => {
    const { card } = setup({ entities: [{ entity: K, name: 'Living Room', temperature_sensor: 'sensor.keuken_airco_temperatuur' }], look: { glass: 'dark' } });
    await card.updateComplete;
    ($(card, '.strip button.who') as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(0);
    const dial = $(card, 'liquid-climate-sheet')!.shadowRoot!.querySelector('liquid-climate-card') as AnyEl;
    expect(dial).not.toBeNull();
    expect(dial._config).toMatchObject({ entity: K, name: 'Living Room', temperature_sensor: 'sensor.keuken_airco_temperatuur', look: { glass: 'dark' } });
  });

  it('error, paused and unavailable rooms', async () => {
    const health = ['binary_sensor.keuken_airco_is_in_error_state', { entity: 'sensor.keuken_airco_error_code', name: 'Controller' }];
    const { card } = setup(
      {
        entities: [
          { entity: K, sensors: { health } },
          { entity: S, pause_entity: 'input_boolean.window' },
          N,
        ],
      },
      (f) => {
        f.states['binary_sensor.keuken_airco_is_in_error_state'].state = 'on';
        f.states['sensor.keuken_airco_error_code'].state = 'A6-01';
        f.states['input_boolean.window'] = { entity_id: 'input_boolean.window', state: 'on', attributes: {} };
        f.states[N] = { ...f.states[N], state: 'unavailable' };
      },
    );
    await card.updateComplete;
    const k = room(card, 'Keuken');
    expect(text(k.querySelector('.foot'))).toBe('Error, Controller: A6-01');
    expect(k.querySelector('.foot')!.classList.contains('warn')).toBe(true);
    expect(k.getAttribute('aria-label')).toContain('Error, Controller: A6-01');
    expect(text(room(card, 'Slaapkamer').querySelector('.foot'))).toBe('Paused');
    const n = room(card, 'Nagelsalon');
    expect(text(n.querySelector('.foot'))).toBe('Unavailable');
    expect(text(n.querySelector('.tline'))).toBe('--');
    expect(text($(card, '.sum'))).toBe('2 of 3 on, 1 error, 1 paused, 1 unavailable');
    n.click();
    await card.updateComplete;
    expect(modeButtons(card)).toHaveLength(0);
    expect(steps(card).every((b) => b.getAttribute('aria-disabled') === 'true')).toBe(true);
  });

  it('the spin ring runs only while the fan runs and motion allows it', async () => {
    const { card } = setup({ entities: [K, N] });
    await card.updateComplete;
    expect(shown(room(card, 'Keuken'), 'circle.spin')).toBe(true);
    expect(shown(room(card, 'Nagelsalon'), 'circle.spin')).toBe(false);
    expect(shown(room(card, 'Nagelsalon'), 'path.fan-lit')).toBe(false);
    card.setConfig({ entities: [K, N], look: { motion: 'minimal' } });
    await card.updateComplete;
    expect(shown(room(card, 'Keuken'), 'circle.spin')).toBe(false);
  });

  it('the room icon carries the mode colour only while the unit is doing its job', async () => {
    const { card, hass } = setup({ entities: [K] });
    await card.updateComplete;
    expect((room(card, 'Keuken').querySelector('.ricon') as HTMLElement).style.color).toBe('#ff9447');
    card.hass = { ...hass, states: { ...hass.states, [K]: { ...hass.states[K], attributes: { ...hass.states[K].attributes, hvac_action: 'idle' } } } };
    await card.updateComplete;
    expect((room(card, 'Keuken').querySelector('.ricon') as HTMLElement).style.color).toBe('var(--lc-fg3)');
    expect(text(room(card, 'Keuken').querySelector('.foot'))).toBe('Idle, fan 2');
  });

  it('glass follows look.glass and the HA theme', async () => {
    const { card, hass } = setup({ entities: [K] });
    await card.updateComplete;
    expect($(card, 'section.cluster')!.classList.contains('g-light')).toBe(true);
    card.hass = { ...hass, themes: { darkMode: true } };
    await card.updateComplete;
    expect($(card, 'section.cluster')!.classList.contains('g-dark')).toBe(true);
    card.setConfig({ entities: [K], look: { glass: 'light' } });
    await card.updateComplete;
    expect($(card, 'section.cluster')!.classList.contains('g-light')).toBe(true);
  });

  it('releases the writers of rooms that leave and of the whole card on disconnect, sending what is pending', async () => {
    const { card, calls } = setup({ entities: [K] });
    await card.updateComplete;
    steps(card)[1].click();
    card.remove();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([{ service: 'set_temperature', data: { entity_id: K, temperature: 20 } }]);
  });
});

describe('cluster card fixes', () => {
  it('pins the selection: a reorder keeps it, a room that leaves falls back to the first', async () => {
    const { card } = setup({ entities: [K, S] });
    await card.updateComplete;
    card.setConfig({ entities: [S, K] });
    await card.updateComplete;
    expect(text($(card, '.strip .sname'))).toBe('Keuken');
    room(card, 'Slaapkamer').click();
    await card.updateComplete;
    card.setConfig({ entities: [N, K] });
    await card.updateComplete;
    expect(text($(card, '.strip .sname'))).toBe('Nagelsalon');
    expect(room(card, 'Nagelsalon').getAttribute('aria-pressed')).toBe('true');
  });

  it('re-acquires its writers after a reconnect, and acquires none while detached', async () => {
    const { card, hass } = setup({ entities: [K] });
    await card.updateComplete;
    expect(card._leases.size).toBe(1);
    card.remove();
    card.hass = { ...hass };
    await card.updateComplete;
    expect(card._leases.size).toBe(0);
    document.body.append(card);
    await card.updateComplete;
    expect(card._leases.size).toBe(1);
  });

  it('an open dial sheet follows setConfig', async () => {
    const { card } = setup({ entities: [{ entity: K, name: 'Living Room' }] });
    await card.updateComplete;
    ($(card, '.strip button.who') as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(0);
    card.setConfig({ entities: [{ entity: K, name: 'Kitchen' }] });
    await vi.advanceTimersByTimeAsync(0);
    const dial = $(card, 'liquid-climate-sheet')!.shadowRoot!.querySelector('liquid-climate-card') as AnyEl;
    expect(dial._config).toMatchObject({ entity: K, name: 'Kitchen' });
  });

  it('auto mode re-renders when a climate unit appears or goes, not on other new entities', async () => {
    const { card, hass } = setup();
    await card.updateComplete;
    const spy = vi.spyOn(card as any, 'render');
    card.hass = { ...hass, states: { ...hass.states, 'sensor.new_thing': { entity_id: 'sensor.new_thing', state: '1', attributes: {} } } };
    await card.updateComplete;
    expect(spy).not.toHaveBeenCalled();
    const { [S]: _gone, ...rest } = hass.states;
    card.hass = { ...hass, states: rest };
    await card.updateComplete;
    expect(spy).toHaveBeenCalled();
    expect(rooms(card)).toHaveLength(7);
  });

  it('an off room that is paused says Off, not --', async () => {
    const { card } = setup({ entities: [{ entity: N, pause_entity: 'input_boolean.window' }] }, (f) => {
      f.states['input_boolean.window'] = { entity_id: 'input_boolean.window', state: 'on', attributes: {} };
    });
    await card.updateComplete;
    expect(text(room(card, 'Nagelsalon').querySelector('.tline'))).toBe('Off');
    expect(text(room(card, 'Nagelsalon').querySelector('.foot'))).toBe('Paused');
  });

  it('sets its write delay on the shared writer only right before a write', async () => {
    const { card, calls } = setup({ entities: [K], write_delay: 3 });
    await card.updateComplete;
    const w = card._leases.get(K).current;
    w.delay = 0;
    card.requestUpdate();
    await card.updateComplete;
    expect(w.delay).toBe(0);
    steps(card)[1].click();
    await vi.advanceTimersByTimeAsync(2900);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(calls).toHaveLength(1);
  });

  it('labels the strip, its mode group and the dial opener for the room', async () => {
    const { card } = setup({ entities: [K] });
    await card.updateComplete;
    expect($(card, '.strip')!.getAttribute('role')).toBe('group');
    expect($(card, '.strip')!.getAttribute('aria-label')).toBe('Controls for Keuken');
    expect($(card, '.strip .modes')!.getAttribute('aria-label')).toBe('Mode, Keuken');
    const who = $(card, '.strip button.who')!;
    expect(who.getAttribute('aria-label')).toBe('Keuken, Heating, open dial');
    expect(who.querySelector('.chev svg')).not.toBeNull();
  });

  it('write errors go to an alert region', async () => {
    const { card } = setup({ entities: [K] });
    await card.updateComplete;
    expect($(card, '.sr[role=alert]')).not.toBeNull();
  });

  it('a warning footer has no title and wraps; other footers carry the full text as title', async () => {
    const { card } = setup({ entities: [K, { entity: S, pause_entity: 'input_boolean.window' }] }, (f) => {
      f.states['input_boolean.window'] = { entity_id: 'input_boolean.window', state: 'on', attributes: {} };
    });
    await card.updateComplete;
    expect(room(card, 'Keuken').querySelector('.foot')!.getAttribute('title')).toBe('Heating, fan 2');
    expect(room(card, 'Slaapkamer').querySelector('.foot.warn')!.hasAttribute('title')).toBe(false);
  });

  it('with no rooms it says so and how to fix it, without a summary', async () => {
    const { card } = setup({ area: 'achtertuin' });
    await card.updateComplete;
    expect(text($(card, '.empty'))).toBe('No climate entities found. Choose rooms in the card editor.');
    expect($(card, '.sum')).toBeNull();
    expect($(card, '.strip')).toBeNull();
  });
});

describe('cluster summary and figures', () => {
  const model = (mode: string, kind: RoomModel['kind'] = mode === 'off' ? 'off' : 'on', active = true) =>
    ({ mode, kind, available: kind !== 'unavailable', on: mode !== 'off' && kind !== 'unavailable', active }) as RoomModel;

  it('says what runs in plain words', () => {
    expect(clusterSummary([model('heat'), model('heat'), model('off')])).toBe('2 of 3 heating');
    expect(clusterSummary([model('cool'), model('off')])).toBe('1 of 2 cooling');
    expect(clusterSummary([model('heat'), model('cool'), model('off')])).toBe('2 of 3 on');
    expect(clusterSummary([model('heat_cool')])).toBe('1 of 1 on');
    expect(clusterSummary([model('off'), model('off')])).toBe('All off');
    expect(clusterSummary([model('off', 'unavailable')])).toBe('Unavailable');
    expect(clusterSummary([])).toBe('No climate entities');
  });

  it('says heating only when every running room is actually heating, not idle', () => {
    expect(clusterSummary([model('heat'), model('heat', 'on', false)])).toBe('2 of 2 on');
    expect(clusterSummary([model('cool', 'on', false)])).toBe('1 of 1 on');
  });

  it('says Unavailable, not All off, when no room is available, also with error or paused rooms', () => {
    const gone = (kind: RoomModel['kind']) => ({ ...model('off', kind), available: false }) as RoomModel;
    expect(clusterSummary([gone('error'), gone('unavailable')])).toBe('Unavailable, 1 error');
    expect(clusterSummary([gone('paused'), model('off')])).toBe('All off, 1 paused');
  });

  it('leaves the energy figure out while one of the configured sensors does not resolve', async () => {
    const { card } = setup({ entities: DAIKIN_ROOMS }, (f) => {
      const id = 'sensor.slaapkamer_airco_energie_koelen_dag';
      f.states[id] = { ...f.states[id], state: 'unavailable' };
    });
    await card.updateComplete;
    expect($$(card, '.figs .fig').map(text)).toEqual(['14° outside', '145 cloud calls left']);
  });

  it('shows outside, energy today over every unit and cloud calls left when they resolve', async () => {
    const { card } = setup({ entities: DAIKIN_ROOMS });
    await card.updateComplete;
    expect($$(card, '.figs .fig').map(text)).toEqual(['14° outside', '4.9 kWh today', '145 cloud calls left']);
    expect(text($(card, '.sum'))).toBe('2 of 3 on');
    expect(text(room(card, 'Living Room').querySelector('.foot'))).toBe('Heating, fan 2, 2.9 kWh today');
    expect(text(room(card, 'Nagelsalon').querySelector('.foot'))).toBe('Off, 0.6 kWh today');
  });

  it('normalises energy units and counts a shared sensor once', async () => {
    const rooms = DAIKIN_ROOMS.map((r) => (r.entity === N ? { ...r, sensors: { ...r.sensors, energy: daikinSensors('keuken').energy } } : r));
    const { card } = setup({ entities: rooms }, (f) => {
      const id = 'sensor.slaapkamer_airco_energie_koelen_dag';
      f.states[id] = { ...f.states[id], state: '1400', attributes: { ...f.states[id].attributes, unit_of_measurement: 'Wh' } };
    });
    await card.updateComplete;
    // 2.9 (keuken, also used by the nagelsalon room) + 1.4 (1400 Wh).
    expect(text($$(card, '.figs .fig')[1])).toBe('4.3 kWh today');
  });

  it('omits figures that do not resolve, and the whole row when none does', async () => {
    const { card } = setup({ entities: [K, 'climate.no_fan'] });
    await card.updateComplete;
    expect($(card, '.figs')).toBeNull();
    card.setConfig({ entities: [{ entity: K, sensors: { outdoor: 'sensor.keuken_airco_buitentemperatuur' } }] });
    await card.updateComplete;
    expect($$(card, '.figs .fig').map(text)).toEqual(['14° outside']);
  });

  it('takes the lowest cloud call count', async () => {
    const { card } = setup({ entities: DAIKIN_ROOMS }, (f) => (f.states['sensor.slaapkamer_airco_gateway_ratelimit_remaining_day'].state = '12'));
    await card.updateComplete;
    expect(text($$(card, '.figs .fig')[2])).toBe('12 cloud calls left');
  });
});

describe('cluster editor', () => {
  function editor(raw: Record<string, unknown> = {}) {
    const { hass } = home();
    const ed = document.createElement('liquid-climate-cluster-editor') as unknown as AnyEl;
    ed.setConfig({ type: 'custom:liquid-climate-cluster', ...raw });
    ed.hass = hass;
    const out: Record<string, unknown>[] = [];
    ed.addEventListener('config-changed', (e: Event) => out.push((e as CustomEvent).detail.config));
    document.body.append(ed);
    return { ed, out, last: () => out[out.length - 1] };
  }
  const radio = (ed: AnyEl, label: string) => $$(ed, '[role=radio]').find((b) => text(b) === label) as HTMLButtonElement;
  const switchFor = (ed: AnyEl, name: string) => $(ed, `button[aria-label="Show ${name}"]`) as HTMLButtonElement;

  it('lists every unit with its area; switching one off writes only exclude', async () => {
    const { ed, last } = editor();
    await ed.updateComplete;
    expect($$(ed, '.roomrow .name').map(text).slice(0, 3)).toEqual(['Keuken', 'Nagelsalon', 'Slaapkamer']);
    expect(text($(ed, '.roomrow .hint'))).toBe('Area Keuken. Keuken Airco');
    switchFor(ed, 'Nagelsalon').click();
    await ed.updateComplete;
    expect(last()).toEqual({ type: 'custom:liquid-climate-cluster', exclude: [N], config_version: 1 });
    expect(switchFor(ed, 'Nagelsalon').getAttribute('aria-checked')).toBe('false');
  });

  it('group by area and the title are saved; defaults are not', async () => {
    const { ed, last } = editor();
    await ed.updateComplete;
    radio(ed, 'Area').click();
    await ed.updateComplete;
    expect(last()).toEqual({ type: 'custom:liquid-climate-cluster', group_by: 'area', config_version: 1 });
    radio(ed, 'Floor').click();
    const title = $(ed, 'input[placeholder="Climate"]') as HTMLInputElement;
    title.value = 'House';
    title.dispatchEvent(new Event('change'));
    expect(last()).toEqual({ type: 'custom:liquid-climate-cluster', title: 'House', config_version: 1 });
  });

  it('one area or one floor writes its id', async () => {
    const { ed, last } = editor();
    await ed.updateComplete;
    radio(ed, 'One floor').click();
    await ed.updateComplete;
    expect(last()).toEqual({ type: 'custom:liquid-climate-cluster', floor: 'begane_grond', config_version: 1 });
    radio(ed, 'One area').click();
    await ed.updateComplete;
    expect(last()).toEqual({ type: 'custom:liquid-climate-cluster', area: 'achtertuin', config_version: 1 });
  });

  it('pick turns the shown rooms into a list that can be reordered and renamed', async () => {
    const { ed, last } = editor({ area: 'lab', exclude: ['climate.fahrenheit'], rooms: [{ entity: 'climate.no_fan', name: 'Hall' }] });
    await ed.updateComplete;
    radio(ed, 'Choose').click();
    await ed.updateComplete;
    expect(last()).toEqual({
      type: 'custom:liquid-climate-cluster',
      entities: ['climate.dual_setpoint', { entity: 'climate.no_fan', name: 'Hall' }, 'climate.no_swing', 'climate.step_one'],
      config_version: 1,
    });
    ($(ed, 'button[aria-label="Move Hall up"]') as HTMLButtonElement).click();
    await ed.updateComplete;
    expect((last().entities as unknown[])[0]).toEqual({ entity: 'climate.no_fan', name: 'Hall' });

    const edit = $$(ed, '.roomrow').find((r) => text(r.querySelector('.name')) === 'no_swing')!.querySelector('button[aria-expanded]') as HTMLButtonElement;
    edit.click();
    await ed.updateComplete;
    const name = $(ed, '.override input') as HTMLInputElement;
    name.value = 'Office';
    name.dispatchEvent(new Event('change'));
    expect((last().entities as unknown[])[2]).toEqual({ entity: 'climate.no_swing', name: 'Office' });
    name.value = '';
    name.dispatchEvent(new Event('change'));
    expect((last().entities as unknown[])[2]).toBe('climate.no_swing');
  });

  it('back to auto keeps the overrides as rooms', async () => {
    const { ed, last } = editor({ entities: [K, { entity: S, pause_entity: 'binary_sensor.w' }] });
    await ed.updateComplete;
    radio(ed, 'All').click();
    await ed.updateComplete;
    expect(last()).toEqual({ type: 'custom:liquid-climate-cluster', rooms: [{ entity: S, pause_entity: 'binary_sensor.w' }], config_version: 1 });
  });

  it('look and write delay use the shared sections and prune like the other editors', async () => {
    const { ed, last } = editor();
    await ed.updateComplete;
    radio(ed, 'Dark').click();
    expect(last()).toEqual({ type: 'custom:liquid-climate-cluster', look: { glass: 'dark' }, config_version: 1 });
    radio(ed, 'Instant').click();
    expect(last()).toEqual({ type: 'custom:liquid-climate-cluster', look: { glass: 'dark' }, write_delay: 0, config_version: 1 });
  });
});
