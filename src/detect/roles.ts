import type { HassEntityRegistryEntry, HomeAssistant } from '../types';
import { deviceName, getDeviceFamily } from './family';

/**
 * Sensor role detection.
 *
 * Two tiers:
 *  - Runtime (card, no registry argument): device_class and unit from the state, plus
 *    translation_key and platform from the display registry. Anything these cannot
 *    settle is left empty. Entity ids and names are never read.
 *  - Editor (registry argument from `config/entity_registry/*`): additionally matches
 *    unique_id suffixes and the English original_name, with a table for Daikin Onecta.
 *    The editor writes the resolved ids into the config so the card never needs this.
 */

/** Extra registry fields that only the full (admin) registry exposes. */
export interface RegistryExtra {
  unique_id?: string | null;
  original_name?: string | null;
}
export type RegistryInfo = Record<string, RegistryExtra>;

export interface SensorRef {
  entity_id: string;
  device_id: string | null;
  /** Device name for the editor, e.g. "Keuken Airco gateway". */
  source: string;
}

export interface UnitTemperatureRef extends SensorRef {
  /** The unit only reports whole degrees, so it is a poor room temperature. */
  wholeDegrees: boolean;
}

export type EnergyKind = 'heating' | 'cooling';
export type EnergyPeriod = 'day' | 'week' | 'month' | 'year';

export interface EnergyRef extends SensorRef {
  kind: EnergyKind | null;
  period: EnergyPeriod | null;
}

export interface HealthRef extends SensorRef {
  type: 'problem' | 'error_code';
}

export interface Detection {
  humidity: SensorRef | null;
  outdoor: SensorRef | null;
  unitTemperature: UnitTemperatureRef | null;
  energy: EnergyRef[];
  cloudLimit: SensorRef | null;
  health: HealthRef[];
  /** Number of devices searched, climate device included. */
  deviceCount: number;
  /** True when unique_id and original_name were available. */
  usedRegistry: boolean;
}

const ENERGY_UNITS = ['kWh', 'Wh', 'MWh'];
const ONECTA = 'daikin_onecta';

export const NO_ERROR_CODES = ['', '00-00', '0', '00', 'none', 'ok', 'unknown', 'unavailable'];

/** Strings that carry meaning: the translation key, and with the registry unique_id and original_name. */
function markers(e: HassEntityRegistryEntry, x?: RegistryExtra): string[] {
  return [e.translation_key, x?.unique_id, x?.original_name].filter((v): v is string => !!v);
}
const anyMatch = (list: string[], re: RegExp) => list.some((v) => re.test(v));

function energyKind(m: string[]): EnergyKind | null {
  if (anyMatch(m, /heating/i)) return 'heating';
  if (anyMatch(m, /cooling/i)) return 'cooling';
  return null;
}

function energyPeriod(m: string[]): EnergyPeriod | null {
  if (anyMatch(m, /daily|_day\b/i)) return 'day';
  if (anyMatch(m, /weekly|_week\b/i)) return 'week';
  if (anyMatch(m, /monthly|_month\b/i)) return 'month';
  if (anyMatch(m, /yearly|_year\b/i)) return 'year';
  return null;
}

/** The single candidate, or null when there are none or several (never guess). */
const only = <T>(list: T[]): T | null => (list.length === 1 ? list[0] : null);

export function detectSensors(hass: HomeAssistant, climateId: string, registry?: RegistryInfo): Detection {
  const family = getDeviceFamily(hass, climateId);
  const states = hass.states ?? {};
  const devices = hass.devices ?? {};
  const entities = hass.entities ?? {};
  const climate = entities[climateId];

  const ref = (e: HassEntityRegistryEntry): SensorRef => ({
    entity_id: e.entity_id,
    device_id: e.device_id ?? null,
    source: deviceName(e.device_id ? devices[e.device_id] : undefined),
  });
  // Stable order; entities on the climate device itself first.
  const rank = (e: HassEntityRegistryEntry) => (e.device_id === climate?.device_id ? 0 : 1);
  const ordered = [...family.entities]
    .filter((e) => !e.hidden && states[e.entity_id])
    .sort((a, b) => rank(a) - rank(b) || a.entity_id.localeCompare(b.entity_id));

  const attr = (e: HassEntityRegistryEntry) => states[e.entity_id].attributes;
  const mk = (e: HassEntityRegistryEntry) => markers(e, registry?.[e.entity_id]);
  const sensors = ordered.filter((e) => e.entity_id.startsWith('sensor.'));

  const humidity = only(sensors.filter((e) => attr(e).device_class === 'humidity'));

  const temps = sensors.filter((e) => attr(e).device_class === 'temperature');
  const outdoor = only(temps.filter((e) => anyMatch(mk(e), /outdoor|outside/i)));
  const unitTemp = only(temps.filter((e) => e !== outdoor && anyMatch(mk(e), /room.?temperature|indoor/i)));

  const energy: EnergyRef[] = sensors
    .filter((e) => attr(e).device_class === 'energy' || ENERGY_UNITS.includes(attr(e).unit_of_measurement))
    .map((e) => ({ ...ref(e), kind: energyKind(mk(e)), period: energyPeriod(mk(e)) }));

  const cloud = only(
    sensors.filter((e) => e.platform === ONECTA && anyMatch(mk(e), /rate_?limit.?remaining.?day/i)),
  );

  const health: HealthRef[] = [];
  for (const e of ordered) {
    if (e.entity_id.startsWith('binary_sensor.')) {
      if (attr(e).device_class !== 'problem') continue;
      // Onecta also flags a mode conflict as a problem; only its error, warning and caution count.
      const uid = registry?.[e.entity_id]?.unique_id;
      if (e.platform === ONECTA && uid && !/isIn(Error|Warning|Caution)State$/.test(uid)) continue;
      health.push({ ...ref(e), type: 'problem' });
    } else if (e.entity_id.startsWith('sensor.') && anyMatch(mk(e), /error_?code/i)) {
      health.push({ ...ref(e), type: 'error_code' });
    }
  }

  return {
    humidity: humidity ? ref(humidity) : null,
    outdoor: outdoor ? ref(outdoor) : null,
    unitTemperature: unitTemp
      ? {
          ...ref(unitTemp),
          wholeDegrees: isWholeDegrees(states[unitTemp.entity_id].state, entities[unitTemp.entity_id]?.display_precision),
        }
      : null,
    energy,
    cloudLimit: cloud ? ref(cloud) : null,
    health,
    deviceCount: family.deviceIds.size,
    usedRegistry: !!registry && Object.keys(registry).length > 0,
  };
}

export function isWholeDegrees(state: string, displayPrecision?: number | null): boolean {
  if (displayPrecision === 0) return true;
  const n = Number(state);
  return state !== '' && Number.isFinite(n) && Number.isInteger(n);
}

/** Temperature sensors in the same area as the climate entity, as room sensor suggestions. */
export function suggestRoomSensors(hass: HomeAssistant, climateId: string): string[] {
  const entities = hass.entities ?? {};
  const devices = hass.devices ?? {};
  const climate = entities[climateId];
  const area = climate?.area_id ?? (climate?.device_id ? devices[climate.device_id]?.area_id : undefined) ?? null;
  if (!area) return [];
  const family = getDeviceFamily(hass, climateId);
  return Object.values(entities)
    .filter((e) => {
      if (!e.entity_id.startsWith('sensor.') || e.hidden) return false;
      if (hass.states[e.entity_id]?.attributes.device_class !== 'temperature') return false;
      if (e.device_id && family.deviceIds.has(e.device_id)) return false;
      const a = e.area_id ?? (e.device_id ? devices[e.device_id]?.area_id : undefined);
      return a === area;
    })
    .map((e) => e.entity_id)
    .sort();
}
