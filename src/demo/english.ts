import type { HassArea, HassEntity, HassEntityRegistryEntry, HassFloor } from '../types';
import { AREAS, FLOORS, allFixtures, type Fixture } from './fixtures';

/**
 * The fixtures with neutral English names and ids, for the docs site and the media. The Daikin fixtures
 * mirror a real (Dutch) install and stay as they are for the tests; this module renames a copy:
 * Living Room, Bedroom, Office and Studio, with English sensor ids, areas and floors.
 */

/** Entity id: Dutch to English. */
const rid = (id: string) =>
  id
    .replace('keuken_airco', 'living_room')
    .replace('slaapkamer_airco', 'bedroom')
    .replace('nagelsalon_airco', 'office')
    .replace('dual_setpoint', 'studio')
    .replace('_buitentemperatuur', '_outdoor_temperature')
    .replace('_luchtvochtigheid', '_humidity')
    .replace(/_temperatuur$/, '_room_temperature')
    .replace('_energie_verwarmen_', '_energy_heating_')
    .replace('_energie_koelen_', '_energy_cooling_')
    .replace(/_dag$/, '_daily')
    .replace(/_week$/, '_weekly')
    .replace(/_maand$/, '_monthly')
    .replace(/_jaar$/, '_yearly')
    .replace('_buitenunit', '_outdoor_unit')
    .replace('_binnenunit', '_indoor_unit');

const NAMES: Record<string, string> = { Keuken: 'Living Room', Slaapkamer: 'Bedroom', Nagelsalon: 'Office' };
/** Device name suffixes, most specific first. */
const SUFFIXES: [string, string][] = [
  [' Airco regeling', ' AC control'],
  [' Airco buitenunit', ' AC outdoor unit'],
  [' Airco binnenunit', ' AC indoor unit'],
  [' Airco gateway', ' AC gateway'],
  [' Airco', ' AC'],
];
const rename = (s: string) => {
  const room = Object.entries(NAMES).reduce((acc, [nl, en]) => acc.replaceAll(nl, en), s);
  const [nl, en] = SUFFIXES.find(([suffix]) => room.endsWith(suffix)) ?? [];
  return nl ? room.slice(0, -nl.length) + en : room;
};

/** Area and floor ids: Dutch to English. */
const AREA_IDS: Record<string, string> = {
  keuken: 'living_room',
  slaapkamer: 'bedroom',
  nagelsalon: 'office',
  achtertuin: 'garden',
};
const FLOOR_IDS: Record<string, string> = { begane_grond: 'ground_floor', eerste: 'first_floor' };

/** Climate entities, by their English id. The generic fixtures are named after what they exercise. */
const CLIMATE_NAMES: Record<string, string> = {
  'climate.living_room': 'Living Room AC',
  'climate.bedroom': 'Bedroom AC',
  'climate.office': 'Office AC',
  'climate.studio': 'Studio AC',
  'climate.no_fan': 'No fan',
  'climate.no_swing': 'No swing',
  'climate.fahrenheit': 'Fahrenheit',
  'climate.step_one': 'Step one',
};

const DUTCH = /keuken|slaap|nagel|buiten|binnen|energie|verwarm|koel|luchtvocht|temperatuur|regeling|achtertuin|begane|eerste|airco|woonkamer|dual_setpoint/i;

export interface EnglishFixture {
  fixture: Fixture;
  areas: Record<string, HassArea>;
  floors: Record<string, HassFloor>;
}

/** A fresh copy on every call: callers may change it. Throws when a Dutch id is left over. */
export function englishFixture(): EnglishFixture {
  const source = structuredClone(allFixtures);
  const states: Record<string, HassEntity> = {};
  for (const [id, s] of Object.entries(source.states)) states[rid(id)] = { ...s, entity_id: rid(id) };
  const entities: Record<string, HassEntityRegistryEntry> = {};
  for (const [id, e] of Object.entries(source.entities)) entities[rid(id)] = { ...e, entity_id: rid(id) };
  const registry: Fixture['registry'] = {};
  for (const [id, r] of Object.entries(source.registry)) registry[rid(id)] = r;
  const devices = source.devices;

  for (const s of Object.values(states)) {
    const name = CLIMATE_NAMES[s.entity_id];
    if (name) (s.attributes as Record<string, unknown>).friendly_name = name;
  }
  for (const d of Object.values(devices)) {
    if (d.name) d.name = CLIMATE_NAMES[`climate.${rid(d.name)}`] ?? rename(d.name);
    if (d.area_id) d.area_id = AREA_IDS[d.area_id] ?? d.area_id;
  }
  devices['dev_dual'].area_id = 'studio';

  const areas: Record<string, HassArea> = {};
  for (const a of Object.values(AREAS)) {
    const id = AREA_IDS[a.area_id] ?? a.area_id;
    areas[id] = { ...a, area_id: id, floor_id: a.floor_id ? (FLOOR_IDS[a.floor_id] ?? a.floor_id) : null };
  }
  areas.living_room.name = 'Living Room';
  areas.bedroom.name = 'Bedroom';
  areas.office.name = 'Office';
  areas.garden.name = 'Garden';
  areas.studio = { area_id: 'studio', name: 'Studio', floor_id: 'first_floor' };
  const floors: Record<string, HassFloor> = {};
  for (const f of Object.values(FLOORS)) {
    const id = FLOOR_IDS[f.floor_id] ?? f.floor_id;
    floors[id] = { ...f, floor_id: id };
  }
  floors.ground_floor.name = 'Ground floor';
  floors.first_floor.name = 'First floor';

  const names = [
    ...Object.values(states).map((s) => s.attributes.friendly_name),
    ...Object.values(entities).map((e) => e.name),
    ...Object.values(devices).flatMap((d) => [d.name, d.name_by_user]),
    ...Object.values(areas).map((a) => a.name),
    ...Object.values(floors).map((f) => f.name),
  ].filter((n): n is string => typeof n === 'string');
  for (const text of [...Object.keys(states), ...Object.keys(entities), ...Object.keys(registry), ...Object.keys(areas), ...Object.keys(floors), ...names]) {
    if (DUTCH.test(text)) throw new Error(`Dutch text left in the English fixtures: ${text}`);
  }
  return { fixture: { states, entities, devices, registry }, areas, floors };
}
