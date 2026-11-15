export const CONFIG_VERSION = 1;

/** A sensor with an optional display name. `entity: auto` names the detected sensor. */
export interface SensorEntry {
  entity: string;
  name?: string;
}

/** An entity id or an entry with a name. */
export type SensorItem = string | SensorEntry;

/** auto, false (hidden), an entity id or entry, or (energy and health) a list of them. */
export type SensorSetting = 'auto' | false | SensorItem | SensorItem[];

export interface ParsedSensor {
  /** auto: use detection, off: hidden, set: use `ids`. */
  mode: 'auto' | 'off' | 'set';
  ids: string[];
  /** Display name per configured entity id. */
  names: Record<string, string>;
  /** First display name given, used as the role's label. */
  name?: string;
}

export function parseSensor(setting: SensorSetting | undefined): ParsedSensor {
  if (setting === false) return { mode: 'off', ids: [], names: {} };
  if (setting === undefined || setting === 'auto') return { mode: 'auto', ids: [], names: {} };
  const items = Array.isArray(setting) ? setting : [setting];
  const out: ParsedSensor = { mode: 'set', ids: [], names: {} };
  let auto = false;
  for (const item of items) {
    const entity = typeof item === 'string' ? item : item && typeof item.entity === 'string' ? item.entity : '';
    const name = typeof item === 'object' && item && typeof item.name === 'string' && item.name ? item.name : undefined;
    if (!entity) continue;
    if (name && !out.name) out.name = name;
    if (entity === 'auto') {
      auto = true;
      continue;
    }
    out.ids.push(entity);
    if (name) out.names[entity] = name;
  }
  if (auto && !out.ids.length) out.mode = 'auto';
  return out;
}

/** The same setting with a new display name (empty removes it). Hidden stays hidden. */
export function withSensorName(setting: SensorSetting, name: string): SensorSetting {
  if (setting === false) return setting;
  const plain = (i: SensorItem): string => (typeof i === 'string' ? i : i.entity);
  const items = Array.isArray(setting) ? setting : [setting];
  if (!items.length) return setting;
  const first = plain(items[0]);
  const rest = items.slice(1).map(plain);
  if (!name) return Array.isArray(setting) ? [first, ...rest] : first;
  const named: SensorEntry = { entity: first, name };
  return Array.isArray(setting) ? [named, ...rest] : named;
}

/** The same setting pointing at another entity id (empty means auto), keeping its name. */
export function withSensorEntity(setting: SensorSetting, id: string): SensorSetting {
  const name = parseSensor(setting).name;
  const entity = id || 'auto';
  return name ? { entity, name } : entity;
}

/** One status row under the dial. */
export interface StatusItem {
  entity: string;
  name?: string;
  icon?: string;
  /** Scripts and automations the row menu runs or switches (script.* and automation.*). */
  actions?: string[];
  /** Force the menu on or off. Default: on for a selectable domain or when actions are set. */
  menu?: boolean;
}

/** Row domains whose value the menu can change. */
export const MENU_DOMAINS = ['input_select', 'select', 'input_boolean', 'switch'];

/** Only script.* and automation.* ids, in order, without duplicates. */
export function cleanActions(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const v of list) {
    if (typeof v !== 'string') continue;
    const id = v.trim();
    if (/^(script|automation)\.[a-z0-9_]+$/.test(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/** The menu default for a row: on for a selectable domain or when it has actions. */
export function menuDefault(item: Pick<StatusItem, 'entity' | 'actions'>): boolean {
  return MENU_DOMAINS.includes(item.entity.split('.')[0]) || !!item.actions?.length;
}

/** Whether a row opens the menu (true) or more-info (false). */
export function hasMenu(item: StatusItem): boolean {
  return typeof item.menu === 'boolean' ? item.menu : menuDefault(item);
}

function normalizeStatus(raw: any): StatusItem {
  const { actions, menu, ...rest } = raw;
  const item: StatusItem = { ...rest };
  const clean = cleanActions(actions);
  if (clean.length) item.actions = clean;
  if (typeof menu === 'boolean') item.menu = menu;
  return item;
}

export interface LiquidClimateConfig {
  type: string;
  entity: string;
  name?: string;
  temperature_sensor?: string;
  sensors: {
    humidity: SensorSetting;
    outdoor: SensorSetting;
    energy: SensorSetting;
    cloud_limit: SensorSetting;
    health: SensorSetting;
  };
  controls: {
    modes: string[];
    fan: boolean;
    swing: boolean;
    swing_horizontal: boolean;
    presets: boolean;
  };
  write_delay: number;
  status_entities: StatusItem[];
  look: {
    glass: 'dark' | 'light' | 'theme';
    tint: number;
    blur: number;
    motion: 'rich' | 'subtle' | 'minimal';
  };
  config_version: number;
}

export const DEFAULT_MODES = ['off', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only'];

export function defaultConfig(entity: string): LiquidClimateConfig {
  return {
    type: 'custom:liquid-climate-card',
    entity,
    sensors: { humidity: 'auto', outdoor: 'auto', energy: 'auto', cloud_limit: 'auto', health: 'auto' },
    controls: { modes: [...DEFAULT_MODES], fan: true, swing: true, swing_horizontal: true, presets: true },
    write_delay: 1.5,
    status_entities: [],
    look: { glass: 'theme', tint: 0.09, blur: 30, motion: 'rich' },
    config_version: CONFIG_VERSION,
  };
}

const ALWAYS_KEEP = ['type', 'entity', 'config_version'];

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Drop every option equal to its default, recursively, so the saved YAML only holds what
 * the user changed. type, entity and config_version always stay. Undefined values go too.
 */
export function pruneDefaults<T extends object>(cfg: T, defaults: Record<string, unknown>): T {
  const strip = (obj: Record<string, unknown>, def: Record<string, unknown> | undefined, top: boolean) => {
    for (const key of Object.keys(obj)) {
      if (top && ALWAYS_KEEP.includes(key)) continue;
      const v = obj[key];
      const d = def?.[key];
      if (v === undefined || JSON.stringify(v) === JSON.stringify(d)) delete obj[key];
      else if (isObject(v) && isObject(d)) {
        strip(v, d, false);
        if (!Object.keys(v).length) delete obj[key];
      }
    }
  };
  const out = JSON.parse(JSON.stringify(cfg)) as Record<string, unknown>;
  strip(out, defaults, true);
  return out as T;
}

/** Fill every missing option with its default. Input must already be migrated. */
export function normalizeConfig(raw: Record<string, any>): LiquidClimateConfig {
  const d = defaultConfig(String(raw.entity));
  const cfg: LiquidClimateConfig = {
    ...d,
    type: raw.type ?? d.type,
    name: raw.name || undefined,
    temperature_sensor: raw.temperature_sensor || undefined,
    sensors: { ...d.sensors, ...(raw.sensors ?? {}) },
    controls: { ...d.controls, ...(raw.controls ?? {}) },
    write_delay: typeof raw.write_delay === 'number' && raw.write_delay >= 0 ? raw.write_delay : d.write_delay,
    status_entities: Array.isArray(raw.status_entities)
      ? raw.status_entities.filter((s: any) => s && typeof s.entity === 'string').map(normalizeStatus)
      : [],
    look: { ...d.look, ...(raw.look ?? {}) },
    config_version: raw.config_version ?? CONFIG_VERSION,
  };
  if (!Array.isArray(cfg.controls.modes)) cfg.controls.modes = [...DEFAULT_MODES];
  return cfg;
}

/** What a tap on a tile or badge does. */
export type TapAction = 'sheet' | 'more-info' | 'none';
const TAP_ACTIONS: TapAction[] = ['sheet', 'more-info', 'none'];

function tapAction(v: unknown, fallback: TapAction): TapAction {
  return TAP_ACTIONS.includes(v as TapAction) ? (v as TapAction) : fallback;
}

/** Tile: the dial options (used by its sheet) plus what a tap on the body does. */
export interface TileConfig extends LiquidClimateConfig {
  tap_action: TapAction;
}

/** Badge: the dial options (used by its sheet and for health) plus badge-only options. */
export interface BadgeConfig extends LiquidClimateConfig {
  tap_action: TapAction;
  /** Entity whose `on` state shows the badge as Paused, for example a window contact. */
  pause_entity?: string;
  icon_only: boolean;
}

export function normalizeTileConfig(raw: Record<string, any>): TileConfig {
  return {
    ...normalizeConfig({ type: 'custom:liquid-climate-tile', ...raw }),
    tap_action: tapAction(raw.tap_action, 'sheet'),
  };
}

export function normalizeBadgeConfig(raw: Record<string, any>): BadgeConfig {
  return {
    ...normalizeConfig({ type: 'custom:liquid-climate-badge', ...raw }),
    tap_action: tapAction(raw.tap_action, 'more-info'),
    pause_entity: typeof raw.pause_entity === 'string' && raw.pause_entity ? raw.pause_entity : undefined,
    icon_only: raw.icon_only === true,
  };
}

/** The dial config a tile or badge opens as a sheet: its dial options without its own keys. */
export function sheetConfig(cfg: TileConfig | BadgeConfig): LiquidClimateConfig {
  const { tap_action: _tap, ...rest } = cfg as BadgeConfig;
  const { pause_entity: _pause, icon_only: _icon, ...dial } = rest;
  return { ...dial, type: 'custom:liquid-climate-card' };
}

/** One room of a cluster: a climate entity plus the per-room overrides a dial accepts. */
export interface ClusterRoom {
  entity: string;
  name?: string;
  temperature_sensor?: string;
  /** Entity whose `on` state shows the room as Paused, for example a window contact. */
  pause_entity?: string;
  /** Same settings as the dial's `sensors`, over the cluster's own. */
  sensors?: Partial<LiquidClimateConfig['sensors']>;
}

/** auto: every climate entity, `floor` or `area`: only that one, list: the `entities` list. */
export type ClusterSource = 'auto' | 'floor' | 'area' | 'list';

/** Cluster: rooms from a list or from the area and floor registries, plus the dial options for all. */
export interface ClusterConfig {
  type: string;
  title?: string;
  /** Where the rooms come from. Without it, `entities`, `area` and `floor` decide (older configs). */
  source: ClusterSource;
  /** Explicit rooms in this order. When not empty, area, floor and exclude are ignored. */
  entities: ClusterRoom[];
  area?: string;
  floor?: string;
  /** Without a list or area: floor shows a heading per floor, area a single list by area name. */
  group_by: 'floor' | 'area';
  /** Auto modes: climate entities left out. */
  exclude: string[];
  /** Auto modes: per-room overrides, the same objects as in `entities`. */
  rooms: ClusterRoom[];
  sensors: LiquidClimateConfig['sensors'];
  controls: LiquidClimateConfig['controls'];
  write_delay: number;
  look: LiquidClimateConfig['look'];
  config_version: number;
}

/** The source the other options imply, for configs written without `source`. */
function impliedSource(cfg: Pick<ClusterConfig, 'entities' | 'area' | 'floor'>): ClusterSource {
  if (cfg.entities.length) return 'list';
  if (cfg.area) return 'area';
  if (cfg.floor) return 'floor';
  return 'auto';
}

export function clusterSource(cfg: Pick<ClusterConfig, 'entities' | 'area' | 'floor'> & { source?: ClusterSource }): ClusterSource {
  return cfg.source ?? impliedSource(cfg);
}

export function defaultClusterConfig(): ClusterConfig {
  const d = defaultConfig('');
  return {
    type: 'custom:liquid-climate-cluster',
    source: 'auto',
    entities: [],
    group_by: 'floor',
    exclude: [],
    rooms: [],
    sensors: d.sensors,
    controls: d.controls,
    write_delay: d.write_delay,
    look: d.look,
    config_version: CONFIG_VERSION,
  };
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** A room from YAML: an entity id or an object. Returns null for anything without an entity. */
export function parseClusterRoom(item: unknown): ClusterRoom | null {
  if (typeof item === 'string') return str(item) ? { entity: item.trim() } : null;
  if (!isObject(item) || !str(item.entity)) return null;
  const room: ClusterRoom = { entity: str(item.entity)! };
  for (const key of ['name', 'temperature_sensor', 'pause_entity'] as const) {
    const v = str(item[key]);
    if (v) room[key] = v;
  }
  const sensors = parseRoomSensors(item.sensors);
  if (sensors) room.sensors = sensors;
  return room;
}

const SENSOR_ROLES = ['humidity', 'outdoor', 'energy', 'cloud_limit', 'health'] as const;
const LIST_ROLES = ['energy', 'health'];

const validItem = (v: unknown): boolean =>
  (typeof v === 'string' && !!v.trim()) || (isObject(v) && typeof v.entity === 'string' && !!v.entity.trim());

/** Only known roles with a setting a dial accepts; anything else in a room's `sensors` is dropped. */
function parseRoomSensors(raw: unknown): ClusterRoom['sensors'] | undefined {
  if (!isObject(raw)) return undefined;
  const out: Record<string, unknown> = {};
  for (const role of SENSOR_ROLES) {
    const v = raw[role];
    const ok =
      v === 'auto' || v === false || validItem(v) || (LIST_ROLES.includes(role) && Array.isArray(v) && v.length > 0 && v.every(validItem));
    if (ok) out[role] = v;
  }
  return Object.keys(out).length ? (out as ClusterRoom['sensors']) : undefined;
}

/** Fill every missing option with its default. Input must already be migrated. */
export function normalizeClusterConfig(raw: Record<string, any>): ClusterConfig {
  const d = defaultClusterConfig();
  const rooms = (v: unknown) => (Array.isArray(v) ? v.map(parseClusterRoom).filter((r): r is ClusterRoom => !!r) : []);
  const dial = normalizeConfig({ ...raw, entity: '' });
  const entities = rooms(raw.entities);
  const area = str(raw.area);
  const floor = str(raw.floor);
  const explicit = ['auto', 'floor', 'area', 'list'].includes(raw.source) ? (raw.source as ClusterSource) : undefined;
  return {
    type: raw.type ?? d.type,
    title: str(raw.title),
    source: explicit ?? impliedSource({ entities, area, floor }),
    entities,
    area,
    floor,
    group_by: raw.group_by === 'area' ? 'area' : 'floor',
    exclude: Array.isArray(raw.exclude) ? raw.exclude.filter((x: unknown): x is string => typeof x === 'string') : [],
    rooms: rooms(raw.rooms),
    sensors: dial.sensors,
    controls: dial.controls,
    write_delay: dial.write_delay,
    look: dial.look,
    config_version: dial.config_version,
  };
}

/** The dial config of one room: the cluster's dial options with the room's overrides on top. */
export function roomDialConfig(cfg: ClusterConfig, room: ClusterRoom, name?: string): LiquidClimateConfig {
  return normalizeConfig({
    type: 'custom:liquid-climate-card',
    entity: room.entity,
    name: name ?? room.name,
    temperature_sensor: room.temperature_sensor,
    sensors: { ...cfg.sensors, ...(room.sensors ?? {}) },
    controls: cfg.controls,
    write_delay: cfg.write_delay,
    look: cfg.look,
    config_version: cfg.config_version,
  });
}

/** A room as it is written to YAML: just the id when it has no overrides. */
export function compactRoom(room: ClusterRoom): string | ClusterRoom {
  const out: ClusterRoom = { entity: room.entity };
  if (room.name) out.name = room.name;
  if (room.temperature_sensor) out.temperature_sensor = room.temperature_sensor;
  if (room.pause_entity) out.pause_entity = room.pause_entity;
  if (room.sensors && Object.keys(room.sensors).length) out.sensors = room.sensors;
  return Object.keys(out).length === 1 ? room.entity : out;
}

/** The cluster config as the editor saves it: defaults dropped, rooms compacted. */
export function pruneClusterConfig(cfg: ClusterConfig): Record<string, unknown> {
  // `source` is only written when the other options do not already say the same.
  const source = cfg.source === impliedSource(cfg) ? undefined : cfg.source;
  const out = pruneDefaults(
    {
      ...cfg,
      source,
      entities: cfg.entities.map(compactRoom),
      // Overrides without any override are noise.
      rooms: cfg.rooms.map(compactRoom).filter((r) => typeof r !== 'string'),
    },
    defaultClusterConfig() as unknown as Record<string, unknown>,
  ) as Record<string, unknown>;
  return out;
}
