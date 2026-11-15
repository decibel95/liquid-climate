import { parseSensor, type LiquidClimateConfig, type ParsedSensor, type SensorSetting } from '../config';
import { num, numAuto, t } from '../i18n';
import type { HomeAssistant } from '../types';
import { deviceName } from './family';
import { NO_ERROR_CODES, type Detection, type SensorRef } from './roles';

export interface InfoItem {
  key: 'humidity' | 'outdoor' | 'energy' | 'cloud_limit' | 'valve' | 'battery';
  label: string;
  value: string;
  unit: string;
  warn?: boolean;
}

export interface HealthProblem {
  entity_id: string;
  source: string;
  /** Error codes reported while a problem flag is on, e.g. "Outdoor unit: U0-00". */
  detail?: string;
}

/** Battery below this many percent counts as low. */
export const BATTERY_LOW = 20;

export interface BatteryState {
  /** Level below the limit, or the low flag is on. Unavailable and unknown never count. */
  low: boolean;
  /** The level, when a percentage sensor reports a number. */
  percent: number | null;
}

export interface ResolvedSensors {
  roomTemperature: number | null;
  /** Null when no battery sensor is configured or detected. */
  battery: BatteryState | null;
  /** The window contact reports open (`on`). */
  windowOpen: boolean;
  info: InfoItem[];
  problems: HealthProblem[];
  /** Every entity id this resolution reads, for change detection. */
  watched: string[];
  /** The entity ids behind the outdoor, energy and cloud limit figures, so a cluster can share them. */
  figures: { outdoor?: string; energy: string[]; cloud_limit?: string };
}

/** Numeric state, or null when missing, empty, unavailable or not a number. */
export function numericState(hass: HomeAssistant, id?: string | null): number | null {
  if (!id) return null;
  const st = hass.states[id]?.state;
  if (st === undefined || st === null || st.trim() === '') return null;
  const n = Number(st);
  return Number.isFinite(n) ? n : null;
}

/** Valve opening in percent: a sensor's state, or the current_position of a `valve` entity. */
function valvePercent(hass: HomeAssistant, id?: string): number | null {
  if (!id) return null;
  return id.startsWith('valve.') ? numOrNull(hass.states[id]?.attributes.current_position) : numericState(hass, id);
}

/** Whether the room is paused: the explicit pause entity decides when set, else the window contact. */
export function isPaused(hass: HomeAssistant, pauseEntity: string | undefined, windowOpen: boolean): boolean {
  return pauseEntity ? hass.states[pauseEntity]?.state === 'on' : windowOpen;
}

/** Room temperature: the temperature_sensor override when it has a number, else the entity's current_temperature. */
export function roomTemperatureOf(hass: HomeAssistant, config: { entity: string; temperature_sensor?: string }): number | null {
  const raw = hass.states[config.entity]?.attributes.current_temperature;
  return numericState(hass, config.temperature_sensor) ?? (typeof raw === 'number' && Number.isFinite(raw) ? raw : null);
}

const TO_KWH: Record<string, number> = { kWh: 1, Wh: 0.001, MWh: 1000 };

/** State converted to kWh. Sensors with another or no unit are rejected, not summed blindly. */
export function energyKWh(hass: HomeAssistant, id: string): number | null {
  const n = numericState(hass, id);
  const factor = TO_KWH[String(hass.states[id]?.attributes.unit_of_measurement)];
  return n == null || factor === undefined ? null : n * factor;
}

/** auto -> detected ids, false -> none, id, entry or list -> as configured; plus the names. */
function pick(setting: SensorSetting | undefined, detected: string[]): { ids: string[]; p: ParsedSensor } {
  const p = parseSensor(setting);
  return { ids: p.mode === 'off' ? [] : p.mode === 'auto' ? detected : p.ids, p };
}

/**
 * The window contact the cards use for an auto setting. A window-class contact is authoritative; an `opening`
 * contact (could be a door) only counts when the valve resolves to an entity: auto-detected, explicit or
 * written out by the editor. `valve: false` therefore disables it too.
 */
export function windowOf(detection: Detection, valve: SensorSetting | undefined): SensorRef | null {
  if (detection.window) return detection.window;
  if (!detection.opening) return null;
  return pick(valve, detection.valve ? [detection.valve.entity_id] : []).ids.length ? detection.opening : null;
}

export function resolveSensors(
  hass: HomeAssistant,
  config: LiquidClimateConfig,
  detection: Detection,
  precision = 1,
): ResolvedSensors {
  const stateObj = hass.states[config.entity];
  const s = config.sensors;
  const watched: string[] = [];
  const seen = (list: string[]) => {
    watched.push(...list);
    return list;
  };

  if (config.temperature_sensor) watched.push(config.temperature_sensor);
  const roomTemperature = roomTemperatureOf(hass, config);

  const info: InfoItem[] = [];

  const humPick = pick(s.humidity, detection.humidity ? [detection.humidity.entity_id] : []);
  const humId = seen(humPick.ids)[0];
  const hum = numericState(hass, humId) ?? (humPick.p.mode === 'auto' ? numOrNull(stateObj?.attributes.current_humidity) : null);
  if (hum != null) info.push({ key: 'humidity', label: humPick.p.name ?? t(hass, 'detect.humidity'), value: numAuto(hass, hum, 0), unit: '%' });

  const outPick = pick(s.outdoor, detection.outdoor ? [detection.outdoor.entity_id] : []);
  const outId = seen(outPick.ids)[0];
  const out = numericState(hass, outId);
  if (out != null) info.push({ key: 'outdoor', label: outPick.p.name ?? t(hass, 'detect.outdoor'), value: numAuto(hass, out, precision), unit: '°' });

  const today = detection.energy.filter((e) => e.period === 'day' && e.kind).map((e) => e.entity_id);
  const energyPick = pick(s.energy, today);
  const values = seen(energyPick.ids).map((id) => energyKWh(hass, id)).filter((v): v is number => v != null);
  if (values.length) {
    info.push({ key: 'energy', label: energyPick.p.name ?? t(hass, 'detect.energy'), value: num(hass, values.reduce((a, b) => a + b, 0), 1), unit: 'kWh' });
  }

  const cloudPick = pick(s.cloud_limit, detection.cloudLimit ? [detection.cloudLimit.entity_id] : []);
  const cloudId = seen(cloudPick.ids)[0];
  const cloud = numericState(hass, cloudId);
  if (cloud != null) {
    info.push({ key: 'cloud_limit', label: cloudPick.p.name ?? t(hass, 'detect.cloud'), value: num(hass, Math.round(cloud), 0), unit: '', warn: cloud < 30 });
  }

  const valvePick = pick(s.valve, detection.valve ? [detection.valve.entity_id] : []);
  const valveId = seen(valvePick.ids)[0];
  const valve = valvePercent(hass, valveId);
  if (valve != null) info.push({ key: 'valve', label: valvePick.p.name ?? t(hass, 'detect.valve'), value: num(hass, Math.round(valve), 0), unit: '%' });

  // Battery: the percentage sensor and the low flag both count. The figure is opt-in (an explicit entity).
  const batPick = pick(s.battery, [detection.battery, detection.batteryLow].filter((r) => !!r).map((r) => r!.entity_id));
  const batIds = seen(batPick.ids);
  const level = numericState(hass, batIds.find((id) => !id.startsWith('binary_sensor.')));
  const flag = batIds.find((id) => id.startsWith('binary_sensor.'));
  const battery: BatteryState | null = batIds.length
    ? { low: (level != null && level < BATTERY_LOW) || (!!flag && hass.states[flag]?.state === 'on'), percent: level }
    : null;
  if (batPick.p.mode === 'set' && level != null) {
    info.push({ key: 'battery', label: batPick.p.name ?? t(hass, 'detect.battery'), value: num(hass, Math.round(level), 0), unit: '%', warn: battery!.low });
  }

  const winPick = pick(s.window, [windowOf(detection, s.valve)].filter((r) => !!r).map((r) => r!.entity_id));
  const winId = seen(winPick.ids)[0];
  const windowOpen = !!winId && hass.states[winId]?.state === 'on';

  // Problem flags decide. Error codes are only the trigger when the family has no flags,
  // because some units report a non-zero code (U0-00) while healthy.
  const healthPick = pick(s.health, detection.health.map((h) => h.entity_id));
  const healthIds = seen(healthPick.ids).filter((id) => hass.states[id]);
  const flags = healthIds.filter((id) => id.startsWith('binary_sensor.'));
  const codes = healthIds.filter((id) => !id.startsWith('binary_sensor.'));
  const sourceOf = (id: string) => {
    const named = healthPick.p.names[id] ?? healthPick.p.name;
    if (named) return named;
    const dev = hass.entities?.[id]?.device_id;
    return deviceName(dev ? hass.devices?.[dev] : undefined);
  };
  const activeCode = (id: string) => !NO_ERROR_CODES.includes(hass.states[id].state.toLowerCase());
  const problems: HealthProblem[] = [];
  const raised = flags.filter((id) => hass.states[id].state === 'on');
  if (flags.length) {
    if (raised.length) {
      const detail = codes
        .filter(activeCode)
        .map((id) => `${sourceOf(id) || id}: ${hass.states[id].state}`)
        .join(', ');
      for (const id of raised) problems.push({ entity_id: id, source: sourceOf(id), detail: detail || undefined });
    }
  } else {
    for (const id of codes.filter(activeCode)) {
      problems.push({ entity_id: id, source: sourceOf(id), detail: hass.states[id].state });
    }
  }

  return { roomTemperature, battery, windowOpen, info, problems, watched, figures: { outdoor: outId, energy: energyPick.ids, cloud_limit: cloudId } };
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
