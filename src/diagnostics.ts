import {
  normalizeClusterConfig,
  normalizeConfig,
  parseSensor,
  roomDialConfig,
  type ClusterConfig,
  type LiquidClimateConfig,
} from './config';
import { VERSION } from './const';
import { clusterGroups } from './cards/cluster/grouping';
import { materializeConfig } from './detect/materialize';
import { windowOf } from './detect/resolve';
import { detectSensors, type RegistryInfo, type SensorRef } from './detect/roles';
import type { HomeAssistant } from './types';

/** Config keys whose name contains one of these (or the whole word pin) are dropped, in any case and at any depth. */
const SECRET = /token|pass(word|wd)?|pwd|key|secret|auth|bearer|credential|cookie|webhook|signature|jwt|(?:^|[^a-z])pin(?:[^a-z]|$)/i;

/** String values that look like a credential: a bearer header, a JWT, or a URL carrying a secret query parameter. */
const SECRET_VALUE = [/^Bearer\s+\S+/i, /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/, /^[a-z][\w+.-]*:\/\/\S*[?&][^=&#\s]*(?:token|key|auth|secret|password)[^=&#\s]*=/i];

/** The config as written, without anything that looks like a credential. */
export function stripSecrets(value: unknown): unknown {
  if (typeof value === 'string') return SECRET_VALUE.some((re) => re.test(value)) ? '[redacted]' : value;
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => !SECRET.test(k))
        .map(([k, v]) => [k, stripSecrets(v)]),
    );
  }
  return value;
}

type RoleSource = 'auto' | 'override' | 'hidden';
interface RoleInfo {
  source: RoleSource;
  entities: string[];
  /** Set when the card reads an attribute of the entity instead of a sensor. */
  via?: string;
}

type Role = keyof LiquidClimateConfig['sensors'];

/** The sensor roles each card type actually reads at runtime (the tile and badge only use health, the battery, the window and the room temperature). */
const ROLES_BY_CARD: Record<string, readonly Role[]> = {
  'liquid-climate-card': ['humidity', 'outdoor', 'energy', 'cloud_limit', 'health', 'battery', 'valve'],
  'liquid-climate-cluster': ['outdoor', 'energy', 'cloud_limit', 'health', 'battery', 'valve', 'window'],
  'liquid-climate-tile': ['health', 'battery'],
  'liquid-climate-badge': ['health', 'battery', 'window'],
};

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/** Sensor roles of one dial config: which entities, and whether detection, the user or a switch decided. */
function rolesOf(hass: HomeAssistant, config: LiquidClimateConfig, roles: readonly Role[], registry?: RegistryInfo): Record<string, RoleInfo> {
  const det = hass.states[config.entity] ? detectSensors(hass, config.entity, registry) : null;
  // Battery and window are settled by device_class at runtime, so the editor does not write them out: read them from detection.
  const ids = (...refs: (SensorRef | null)[]) => refs.filter((r): r is SensorRef => !!r).map((r) => r.entity_id);
  const made = det ? materializeConfig(config, det).sensors : null;
  const found = det && made ? { ...made, battery: ids(det.battery, det.batteryLow), window: ids(windowOf(det, made.valve)) } : config.sensors;
  const out: Record<string, RoleInfo> = {};
  for (const role of roles) {
    const set = parseSensor(config.sensors[role]);
    if (set.mode === 'off') out[role] = { source: 'hidden', entities: [] };
    else if (set.mode === 'set') out[role] = { source: 'override', entities: set.ids };
    else out[role] = { source: 'auto', entities: parseSensor(found[role]).ids };
  }
  out.room_temperature = config.temperature_sensor
    ? { source: 'override', entities: [config.temperature_sensor] }
    : { source: 'auto', entities: [config.entity], via: 'current_temperature' };
  return out;
}

/** Capabilities of the climate entity. Nothing about its state, temperatures or names. */
function climateOf(hass: HomeAssistant, entity: string) {
  const s = hass.states[entity];
  if (!s) return { exists: false };
  const a = s.attributes;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    exists: true,
    supported_features: num(a.supported_features),
    hvac_modes: strings(a.hvac_modes),
    fan_modes: strings(a.fan_modes),
    swing_modes: strings(a.swing_modes),
    swing_horizontal_modes: strings(a.swing_horizontal_modes),
    preset_modes: strings(a.preset_modes),
    min_temp: num(a.min_temp),
    max_temp: num(a.max_temp),
    target_temp_step: num(a.target_temp_step),
    temperature_unit: hass.config?.unit_system?.temperature ?? (typeof a.temperature_unit === 'string' ? a.temperature_unit : null),
  };
}

/** Domain and existence per configured status row; never a value. */
function statusOf(hass: HomeAssistant, config: LiquidClimateConfig) {
  return config.status_entities.map((s) => ({ domain: s.entity.split('.')[0], exists: !!hass.states[s.entity] }));
}

function entryOf(hass: HomeAssistant, type: string, config: LiquidClimateConfig, registry?: RegistryInfo) {
  const entry: Record<string, unknown> = {
    entity: config.entity,
    climate: climateOf(hass, config.entity),
    sensors: rolesOf(hass, config, ROLES_BY_CARD[type] ?? ROLES_BY_CARD['liquid-climate-card'], registry),
  };
  if (type === 'liquid-climate-card') entry.status_rows = statusOf(hass, config);
  return entry;
}

export interface DiagnosticsInput {
  /** The card type, for example `liquid-climate-card`; a leading `custom:` is dropped. */
  cardType: string;
  config: Record<string, unknown>;
  hass: HomeAssistant;
  /** Admin-only registry details, when the caller has them (the editors do). */
  registry?: RegistryInfo;
}

/**
 * What to paste into a bug report: versions, the config without secrets, how each sensor role was
 * resolved, and the capabilities of the climate entities. No states, history, names, users or location.
 */
export function buildDiagnostics({ cardType, config, hass, registry }: DiagnosticsInput): Record<string, unknown> {
  const type = cardType.replace(/^custom:/, '');
  let entities: Record<string, unknown>;
  if (type === 'liquid-climate-cluster') {
    const cluster = normalizeClusterConfig(config as Record<string, any>) as ClusterConfig;
    const rooms = clusterGroups(hass, cluster).flatMap((g) => g.rooms);
    entities = { rooms: rooms.map((r) => entryOf(hass, type, roomDialConfig(cluster, r.room), registry)) };
  } else {
    entities = { ...entryOf(hass, type, normalizeConfig({ ...config, entity: String(config.entity ?? '') }), registry) };
  }
  return {
    card_version: VERSION,
    card_type: type,
    ha_version: hass.config?.version ?? null,
    language: hass.locale?.language ?? hass.language ?? null,
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    dark_mode: (hass.themes as { darkMode?: boolean } | undefined)?.darkMode ?? null,
    config: stripSecrets(config),
    ...entities,
  };
}

export const diagnosticsText = (d: Record<string, unknown>): string => JSON.stringify(d, null, 2);

/** Copy text through the async clipboard, else a hidden textarea. Returns whether it worked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the textarea.
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  try {
    document.body.append(ta);
    ta.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    ta.remove();
  }
}
