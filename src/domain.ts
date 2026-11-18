import type { HassEntity } from './types';

/**
 * The entity domains the cards control. Climate is the reference; a water heater and a
 * humidifier map onto the same dial model (setpoint, current figure, modes, power) through
 * getCapabilities and buildView, and onto their own services through buildCalls.
 */
export const DOMAINS = ['climate', 'water_heater', 'humidifier'] as const;
export type Domain = (typeof DOMAINS)[number];

/** WaterHeaterEntityFeature bit flags from Home Assistant core (water_heater/const.py). */
export const WATER_HEATER_FEATURE = {
  TARGET_TEMPERATURE: 1,
  OPERATION_MODE: 2,
  AWAY_MODE: 4,
  ON_OFF: 8,
} as const;

/** HumidifierEntityFeature bit flags from Home Assistant core (humidifier/const.py). */
export const HUMIDIFIER_FEATURE = {
  MODES: 1,
} as const;

/** The domain of an entity id; anything unknown is treated as climate. */
export function domainOf(entityId: string): Domain {
  const d = entityId.split('.')[0];
  return (DOMAINS as readonly string[]).includes(d) ? (d as Domain) : 'climate';
}

/** A climate, water_heater or humidifier entity id. */
export function isSupportedEntity(id: unknown): id is string {
  return typeof id === 'string' && DOMAINS.some((d) => id.startsWith(`${d}.`));
}

/** The error a card throws for an entity it cannot show. Keeps "climate entity" for older checks. */
export const ENTITY_ERROR = 'Liquid Climate: "entity" must be a climate entity id (climate, water_heater or humidifier)';

/**
 * Sensor roles that mean nothing for a domain: a water heater has no room humidity, valve or window; a
 * humidifier's humidity is its main figure, and it has no outdoor temperature or valve. Auto detection
 * skips them; an explicit entity still shows.
 */
const NO_ROLES: Record<Domain, string[]> = {
  climate: [],
  water_heater: ['humidity', 'valve', 'window'],
  humidifier: ['humidity', 'outdoor', 'valve'],
};

/** Whether a sensor role applies to the entity's domain. */
export function roleApplies(domain: Domain, role: string): boolean {
  return !NO_ROLES[domain].includes(role);
}

/**
 * The override of the figure the card shows (`temperature_sensor`): its label key and the device_class
 * of the sensors it suggests. A room temperature for climate, the water temperature for a water heater,
 * the humidity for a humidifier.
 */
export function currentSensor(domain: Domain): { label: string; deviceClass: 'temperature' | 'humidity'; list: string } {
  if (domain === 'water_heater') return { label: 'editor.waterSensor', ...SENSOR_LISTS.temperature };
  if (domain === 'humidifier') return { label: 'editor.humiditySensor', ...SENSOR_LISTS.humidity };
  return { label: 'editor.roomSensor', ...SENSOR_LISTS.temperature };
}

/** The datalist of suggested sensors per device_class, as the cluster editor renders them. */
export const SENSOR_LISTS = {
  temperature: { deviceClass: 'temperature', list: 'lc-temperature_sensor' },
  humidity: { deviceClass: 'humidity', list: 'lc-humidity_sensor' },
} as const;

/** The attribute that holds the setpoint: humidity for a humidifier, temperature otherwise. */
export function targetKey(domain: Domain): 'temperature' | 'humidity' {
  return domain === 'humidifier' ? 'humidity' : 'temperature';
}

const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** What the entity measures now: current_humidity for a humidifier, current_temperature otherwise. */
export function currentFigure(stateObj: HassEntity | undefined): number | null {
  if (!stateObj) return null;
  const a = stateObj.attributes;
  return finite(domainOf(stateObj.entity_id) === 'humidifier' ? a.current_humidity : a.current_temperature);
}

/** What the unit is doing right now: hvac_action for climate, action for a humidifier. Water heaters report none. */
export function actionOf(stateObj: HassEntity): string | undefined {
  const domain = domainOf(stateObj.entity_id);
  const v = domain === 'humidifier' ? stateObj.attributes.action : domain === 'climate' ? stateObj.attributes.hvac_action : undefined;
  return typeof v === 'string' && v ? v : undefined;
}

const has = (features: number, flag: number) => (features & flag) === flag;

/** A feature flag of the entity is set. */
export function supports(stateObj: HassEntity | undefined, flag: number): boolean {
  return has(Number(stateObj?.attributes.supported_features ?? 0), flag);
}

/** A water heater's operation modes, as strings. */
export function operationList(stateObj: HassEntity | undefined): string[] {
  const v = stateObj?.attributes.operation_list;
  return Array.isArray(v) ? v.map(String) : [];
}
