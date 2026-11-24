/**
 * Pixel baseline stage: one card (or one open sheet, or one editor) per page load, in a fixed state, on one
 * of four page grounds, with dark or light glass. Driven by scripts/pixel (Playwright). Nothing here moves.
 *
 *   ?list=1                                         only publish the case list (window.__pixelCases)
 *   ?case=<id>&glass=dark|light&ground=ha-light|ha-dark|white|black
 *
 * Window API for the capture script: __pixelCases (the matrix), __pixelReady (true once the case has
 * rendered, fonts are loaded and every animation is parked) and __pixelInfo (what was parked, for the log).
 */
import { FREEZE_CSS } from './pixel-freeze';
import '../src/index';
import { normalizeTileConfig, sheetConfig } from '../src/config';
import { migrateConfig } from '../src/migrate';
import { englishFixture } from '../src/demo/english';
import { APPLIANCE_IDS, appliances, makeHass, mergeFixtures } from '../src/demo/fixtures';
import { addHelperEntities } from '../src/demo/service';
import { TRV, trvFixtures } from '../test/fixtures/trv';
import type { HassEntity, HomeAssistant } from '../src/types';

type States = Record<string, HassEntity>;
type Cfg = Record<string, unknown>;
type El = HTMLElement & { hass: HomeAssistant; setConfig(c: Cfg): void; updateComplete: Promise<unknown> };

// ---- Matrix definition -----------------------------------------------------------------------

export const GLASSES = ['dark', 'light'] as const;
/** Page ground: the colour behind the card, and which Home Assistant theme variables go with it. */
export const GROUNDS = {
  'ha-light': { dark: false },
  'ha-dark': { dark: true },
  white: { dark: false },
  black: { dark: true },
} as const;
type Ground = keyof typeof GROUNDS;

const LIVING = 'climate.living_room';
const STUDIO = 'climate.studio';
const WATER = APPLIANCE_IDS.waterHeater;
const HUMID = APPLIANCE_IDS.humidifier;
const DEHUM = APPLIANCE_IDS.dehumidifier;
const HYGRO = APPLIANCE_IDS.hygrostat;
const TRV_ID = TRV.sonoff;

/** Change one entity: its state and some attributes. */
const set = (id: string, state: string, attrs: Record<string, unknown> = {}) => (s: States) => {
  s[id] = { ...s[id], state, attributes: { ...s[id].attributes, ...attrs } };
};
/** Change the state of a sensor-like entity only. */
const setState = (id: string, state: string) => (s: States) => {
  s[id] = { ...s[id], state };
};
const all = (...fns: ((s: States) => void)[]) => (s: States) => fns.forEach((f) => f(s));

/** A state of one entity that the dial, the tile and the badge all show. */
interface Variant {
  id: string;
  entity: string;
  apply: (s: States) => void;
  /** Extra config for the dial only (the status row). */
  dial?: Cfg;
  /** Extra config for the badge only. */
  badge?: Cfg;
  /** The icon-only badge is captured too. */
  iconOnly?: boolean;
  /** The badge only: tile and dial show the same state as another variant. */
  badgeOnly?: boolean;
  /** The dial only: the tile and the badge would repeat another variant. */
  dialOnly?: boolean;
}

const ERROR_FLAG = 'binary_sensor.living_room_is_in_error_state';
const heating = { hvac_action: 'heating' };
const cooling = { hvac_action: 'cooling' };
const idle = { hvac_action: 'idle' };

const VARIANTS: Variant[] = [
  // Climate: every hvac mode, with the actions it can report.
  { id: 'off', entity: LIVING, iconOnly: true, apply: set(LIVING, 'off', { hvac_action: 'off', current_temperature: 22, temperature: 21 }) },
  { id: 'heat-heating', entity: LIVING, iconOnly: true, apply: set(LIVING, 'heat', { ...heating, current_temperature: 19, temperature: 21 }) },
  { id: 'heat-idle', entity: LIVING, apply: set(LIVING, 'heat', { ...idle, current_temperature: 21, temperature: 21 }) },
  { id: 'cool-cooling', entity: LIVING, iconOnly: true, apply: set(LIVING, 'cool', { ...cooling, current_temperature: 26, temperature: 23 }) },
  { id: 'cool-idle', entity: LIVING, apply: set(LIVING, 'cool', { ...idle, current_temperature: 23, temperature: 23 }) },
  { id: 'heat_cool-heating', entity: STUDIO, apply: set(STUDIO, 'heat_cool', { ...heating, current_temperature: 18.4 }) },
  { id: 'heat_cool-cooling', entity: STUDIO, apply: set(STUDIO, 'heat_cool', { ...cooling, current_temperature: 25.2 }) },
  { id: 'heat_cool-idle', entity: STUDIO, iconOnly: true, apply: set(STUDIO, 'heat_cool', { ...idle, current_temperature: 21.4 }) },
  {
    id: 'auto-idle',
    entity: LIVING,
    iconOnly: true,
    apply: set(LIVING, 'auto', { ...idle, hvac_modes: ['off', 'fan_only', 'heat', 'cool', 'heat_cool', 'dry', 'auto'], current_temperature: 22, temperature: 22 }),
  },
  { id: 'dry-drying', entity: LIVING, iconOnly: true, apply: set(LIVING, 'dry', { hvac_action: 'drying', current_temperature: 24 }) },
  { id: 'fan_only-fan', entity: LIVING, iconOnly: true, apply: set(LIVING, 'fan_only', { hvac_action: 'fan', current_temperature: 24 }) },
  {
    id: 'unavailable',
    entity: LIVING,
    iconOnly: true,
    apply: (s) => {
      const a = s[LIVING].attributes;
      s[LIVING] = { ...s[LIVING], state: 'unavailable', attributes: { friendly_name: a.friendly_name, supported_features: a.supported_features } };
    },
  },
  // Health and pause. The dial and the tile show the flag too; the badge turns into Error or Paused.
  { id: 'error', entity: LIVING, iconOnly: true, apply: all(set(LIVING, 'heat', { ...heating, current_temperature: 19, temperature: 21 }), setState(ERROR_FLAG, 'on')) },
  {
    id: 'paused-pause-entity',
    entity: LIVING,
    iconOnly: true,
    badgeOnly: true,
    badge: { pause_entity: 'input_boolean.window' },
    apply: all(set(LIVING, 'heat', { ...heating, current_temperature: 19, temperature: 21 }), setState('input_boolean.window', 'on')),
  },
  // The dial's status row (helpers next to the unit).
  {
    id: 'heat-heating-status-row',
    entity: LIVING,
    dialOnly: true,
    apply: set(LIVING, 'heat', { ...heating, current_temperature: 19, temperature: 21 }),
    dial: {
      status_entities: [
        { entity: 'input_select.heating_mode', name: 'Heating mode', actions: ['script.apply_heating', 'automation.heating_schedule'] },
        { entity: 'input_boolean.window', name: 'Window pause' },
      ],
    },
  },
  // Radiator valve (Zigbee2MQTT style): idle, heating with the valve opening, off, window open, low battery.
  { id: 'trv-idle', entity: TRV_ID, apply: set(TRV_ID, 'heat', { ...idle, current_temperature: 20.6, temperature: 20 }) },
  { id: 'trv-heating', entity: TRV_ID, apply: all(set(TRV_ID, 'heat', { ...heating, current_temperature: 17.8, temperature: 20.5 }), setState('sensor.trv_sonoff_pi_heating_demand', '65')) },
  { id: 'trv-off', entity: TRV_ID, iconOnly: true, apply: set(TRV_ID, 'off', { hvac_action: 'off', current_temperature: 20.6, temperature: 20 }) },
  { id: 'trv-window-open', entity: TRV_ID, iconOnly: true, apply: all(set(TRV_ID, 'heat', { ...idle, current_temperature: 17.1, temperature: 20 }), setState('binary_sensor.trv_sonoff_window_open', 'on')) },
  { id: 'trv-battery-low', entity: TRV_ID, iconOnly: true, apply: all(set(TRV_ID, 'heat', { ...heating, current_temperature: 18.2, temperature: 20.5 }), setState('sensor.trv_sonoff_battery', '12')) },
  // Water heater: operation modes.
  { id: 'water-eco', entity: WATER, apply: set(WATER, 'eco', { operation_mode: 'eco', temperature: 52, current_temperature: 47 }) },
  { id: 'water-performance', entity: WATER, apply: set(WATER, 'performance', { operation_mode: 'performance', temperature: 58, current_temperature: 41 }) },
  { id: 'water-heat_pump', entity: WATER, apply: set(WATER, 'heat_pump', { operation_mode: 'heat_pump', temperature: 50, current_temperature: 50 }) },
  { id: 'water-off', entity: WATER, apply: set(WATER, 'off', { operation_mode: 'off', temperature: 52, current_temperature: 38 }) },
  // Humidifier, dehumidifier and hygrostat.
  { id: 'humidifier-humidifying', entity: HUMID, apply: set(HUMID, 'on', { action: 'humidifying', humidity: 55, current_humidity: 42 }) },
  { id: 'humidifier-off', entity: HUMID, apply: set(HUMID, 'off', { action: 'off', humidity: 55, current_humidity: 42 }) },
  { id: 'dehumidifier-drying', entity: DEHUM, apply: set(DEHUM, 'on', { action: 'drying', humidity: 50, current_humidity: 61 }) },
  { id: 'hygrostat-mode-home', entity: HYGRO, apply: set(HYGRO, 'on', { mode: 'home', humidity: 50, current_humidity: 48 }) },
  { id: 'hygrostat-mode-eco', entity: HYGRO, apply: set(HYGRO, 'on', { mode: 'eco', humidity: 45, current_humidity: 48 }) },
];

/** Sheet: the dial in the modal dialog, opened from a tile. One per mode of the main unit, and the appliances. */
const SHEET_VARIANTS = ['off', 'heat-heating', 'cool-cooling', 'heat_cool-heating', 'auto-idle', 'dry-drying', 'fan_only-fan', 'water-eco', 'humidifier-humidifying', 'trv-heating'];

const ROOM_CLUSTER: Cfg = {
  type: 'custom:liquid-climate-cluster',
  entities: [
    { entity: LIVING, name: 'Living Room', pause_entity: 'input_boolean.window' },
    { entity: 'climate.bedroom', name: 'Bedroom' },
    { entity: 'climate.office', name: 'Office' },
    { entity: STUDIO, name: 'Studio' },
  ],
};

interface Scene {
  id: string;
  kind: 'dial' | 'tile' | 'badge' | 'cluster' | 'sheet' | 'editor';
  /** Does the glass setting change what is drawn? Editors do not use the glass. */
  glass: boolean;
  apply: (s: States) => void;
  build: (ctx: BuildContext) => void;
  /** Viewport the capture uses, when not the default. The sheet is a modal dialog and fills it. */
  viewport?: { width: number; height: number };
}

interface BuildContext {
  host: HTMLElement;
  glass: 'dark' | 'light';
  card: (tag: string, cfg: Cfg, parent?: HTMLElement) => El;
  box: (cls: string, parent?: HTMLElement) => HTMLElement;
}

const variant = (id: string) => VARIANTS.find((v) => v.id === id)!;
const none = () => undefined;

function scenes(): Scene[] {
  const out: Scene[] = [];
  const look = (g: 'dark' | 'light') => ({ glass: g });
  for (const v of VARIANTS) {
    if (!v.badgeOnly) {
      out.push({
        id: `dial-${v.id}`, kind: 'dial', glass: true, apply: v.apply,
        build: (c) => c.card('liquid-climate-card', { entity: v.entity, look: look(c.glass), ...v.dial }, c.box('w-dial')),
      });
    }
    if (v.dialOnly) continue;
    if (!v.badgeOnly) {
      out.push({
        id: `tile-${v.id}`, kind: 'tile', glass: true, apply: v.apply,
        build: (c) => c.card('liquid-climate-tile', { entity: v.entity, look: look(c.glass) }, c.box('w-tile')),
      });
    }
    out.push({
      id: `badge-${v.id}`, kind: 'badge', glass: true, apply: v.apply,
      build: (c) => c.card('liquid-climate-badge', { entity: v.entity, look: look(c.glass), ...v.badge }),
    });
    if (v.iconOnly) {
      out.push({
        id: `badge-icon-${v.id}`, kind: 'badge', glass: true, apply: v.apply,
        build: (c) => c.card('liquid-climate-badge', { entity: v.entity, look: look(c.glass), icon_only: true, ...v.badge }),
      });
    }
  }
  // Cluster: a mix of modes and a pause; the auto cluster (every climate entity grouped by floor); radiators and appliances.
  const mix = all(
    set(LIVING, 'heat', { ...heating, current_temperature: 19, temperature: 21 }),
    set('climate.bedroom', 'cool', { ...cooling, current_temperature: 26, temperature: 23 }),
    set('climate.office', 'off', { hvac_action: 'off' }),
    set(STUDIO, 'heat_cool', { ...idle, current_temperature: 21.4 }),
  );
  const cluster = (id: string, apply: (s: States) => void, cfg: Cfg): Scene => ({
    id, kind: 'cluster', glass: true, apply,
    build: (c) => c.card('liquid-climate-cluster', { ...cfg, look: look(c.glass) }, c.box('w-cluster')),
  });
  out.push(cluster('cluster-rooms-mixed-modes', mix, ROOM_CLUSTER));
  out.push(cluster('cluster-rooms-paused-and-unavailable', all(mix, setState('input_boolean.window', 'on'), setState('climate.bedroom', 'unavailable'), setState(ERROR_FLAG, 'on')), ROOM_CLUSTER));
  out.push(cluster('cluster-auto-by-floor', mix, { type: 'custom:liquid-climate-cluster' }));
  out.push(
    cluster(
      'cluster-radiators-and-appliances',
      all(variant('trv-heating').apply, variant('water-eco').apply, variant('humidifier-humidifying').apply),
      { type: 'custom:liquid-climate-cluster', entities: [{ entity: TRV_ID, name: 'Radiator' }, { entity: WATER, name: 'Water heater' }, { entity: HUMID, name: 'Humidifier' }] },
    ),
  );
  // Sheet.
  for (const id of SHEET_VARIANTS) {
    const v = variant(id);
    out.push({
      id: `sheet-${id}`, kind: 'sheet', glass: true, apply: v.apply, viewport: { width: 560, height: 860 },
      build: (c) => {
        const tile = c.card('liquid-climate-tile', { entity: v.entity, look: look(c.glass) }, c.box('w-tile'));
        sheetOf = () => tile.shadowRoot!.querySelector('liquid-climate-sheet') as unknown as { open(cfg: unknown, from?: HTMLElement | null): Promise<void> };
        sheetCfg = sheetConfig(normalizeTileConfig(migrateConfig({ entity: v.entity, look: look(c.glass) })));
      },
    });
  }
  // Editors: the Home Assistant theme decides how they look, not the glass.
  const editor = (id: string, tag: string, cfg: Cfg): Scene => ({
    id, kind: 'editor', glass: false, apply: none,
    build: (c) => c.card(tag, cfg, c.box('editor-box w-editor')),
  });
  out.push(editor('editor-dial-climate', 'liquid-climate-card-editor', { type: 'custom:liquid-climate-card', entity: LIVING }));
  out.push(editor('editor-dial-water-heater', 'liquid-climate-card-editor', { type: 'custom:liquid-climate-card', entity: WATER }));
  out.push(editor('editor-dial-humidifier', 'liquid-climate-card-editor', { type: 'custom:liquid-climate-card', entity: HUMID }));
  out.push(editor('editor-dial-radiator-valve', 'liquid-climate-card-editor', { type: 'custom:liquid-climate-card', entity: TRV_ID }));
  out.push(editor('editor-tile', 'liquid-climate-tile-editor', { type: 'custom:liquid-climate-tile', entity: LIVING }));
  out.push(editor('editor-badge', 'liquid-climate-badge-editor', { type: 'custom:liquid-climate-badge', entity: LIVING }));
  out.push(editor('editor-cluster-rooms', 'liquid-climate-cluster-editor', ROOM_CLUSTER));
  out.push(editor('editor-cluster-auto', 'liquid-climate-cluster-editor', { type: 'custom:liquid-climate-cluster' }));
  return out;
}

let sheetOf: (() => { open(cfg: unknown, from?: HTMLElement | null): Promise<void> }) | undefined;
let sheetCfg: unknown;

const SCENES = scenes();
const w = window as unknown as Record<string, unknown>;
w.__pixelCases = SCENES.map((s) => ({ id: s.id, kind: s.kind, glass: s.glass, viewport: s.viewport ?? null }));
w.__pixelGrounds = Object.keys(GROUNDS);
w.__pixelGlasses = [...GLASSES];

// ---- Fake Home Assistant ---------------------------------------------------------------------

const params = new URLSearchParams(location.search);

const WORDS: Record<string, string> = { on: 'On', off: 'Off', open: 'Open', closed: 'Closed', home: 'Home', not_home: 'Away', unavailable: 'Unavailable', unknown: 'Unknown' };
const title = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
function formatEntityState(e: HassEntity, state?: string): string {
  const value = state ?? e.state;
  const domain = e.entity_id.split('.')[0];
  if (domain === 'input_select' || domain === 'select') return value;
  const unit = e.attributes.unit_of_measurement;
  if (domain === 'sensor' && /^-?\d+(\.\d+)?$/.test(value)) return unit ? `${value} ${unit}` : value;
  return WORDS[value] ?? title(value);
}

let pendingWS = 0;

function makeWorld(dark: boolean) {
  const { fixture: english, areas, floors } = englishFixture();
  const fixture = mergeFixtures(english, appliances(), trvFixtures);
  const states = fixture.states;
  addHelperEntities(states);
  const hass = makeHass(fixture, '°C', () => undefined);
  hass.states = states;
  hass.areas = areas;
  hass.floors = floors;
  hass.language = 'en';
  hass.locale = { language: 'en', number_format: 'language' };
  hass.localize = () => '';
  hass.formatEntityState = formatEntityState;
  hass.themes = { darkMode: dark } as HomeAssistant['themes'];
  hass.user = { is_admin: true };
  hass.callWS = (async (msg: Record<string, unknown>) => {
    pendingWS++;
    try {
      if (msg.type === 'config/entity_registry/list') {
        return Object.entries(fixture.registry).map(([entity_id, x]) => ({ entity_id, ...x }));
      }
      throw new Error('unsupported');
    } finally {
      pendingWS--;
    }
  }) as HomeAssistant['callWS'];
  return { hass, states };
}

// ---- Run -------------------------------------------------------------------------------------

const frames = (n: number) => new Promise<void>((res) => (function step(i: number) { requestAnimationFrame(() => (i <= 1 ? res() : step(i - 1))); })(n));

/** Every element, shadow roots included. */
function allElements(root: ParentNode = document): Element[] {
  const out: Element[] = [];
  for (const e of root.querySelectorAll('*')) {
    out.push(e);
    if (e.shadowRoot) out.push(...allElements(e.shadowRoot));
  }
  return out;
}

/** Cancel whatever is still animating (the CSS rule cannot stop script-made animations). Returns how many. */
function parkAnimations(): number {
  let n = 0;
  for (const e of allElements()) for (const a of e.getAnimations()) { a.cancel(); n++; }
  return n;
}

/** Where the run is, for the capture script to report when a page never gets ready. */
const step = (name: string) => { w.__pixelStep = name; };

async function run() {
  step('start');
  const id = params.get('case') ?? '';
  const scene = SCENES.find((s) => s.id === id);
  if (!scene) throw new Error(`Unknown case "${id}"`);
  const glass = params.get('glass') === 'light' ? 'light' : 'dark';
  const groundName = (params.get('ground') ?? 'ha-light') as Ground;
  const ground = GROUNDS[groundName];
  if (!ground) throw new Error(`Unknown ground "${groundName}"`);

  document.documentElement.classList.add(ground.dark ? 'theme-dark' : 'theme-light', `ground-${groundName}`);
  const style = document.createElement('style');
  style.textContent = FREEZE_CSS;
  document.head.append(style);

  const { hass, states } = makeWorld(ground.dark);
  scene.apply(states);
  const els: El[] = [];
  const stage = document.getElementById('stage')!;
  const ctx: BuildContext = {
    host: stage,
    glass,
    box(cls, parent = stage) {
      const d = document.createElement('div');
      d.className = cls;
      parent.append(d);
      return d;
    },
    card(tag, cfg, parent = stage) {
      const e = document.createElement(tag) as El;
      e.setConfig(cfg);
      e.hass = hass;
      els.push(e);
      parent.append(e);
      return e;
    },
  };
  scene.build(ctx);

  step('fonts');
  // The shipped face (src/index.ts registers it from /src/liquid-inter.woff2, served by vite.config.ts): load it
  // before the first render, and stop the case when it does not load, so no baseline falls back to a system font.
  const faces = await document.fonts.load("16px 'Liquid Inter'");
  if (!faces.some((f) => f.status === 'loaded')) throw new Error('The Liquid Inter font did not load');
  await document.fonts.ready;
  step('first render');
  for (const e of els) await e.updateComplete;
  step('frames');
  await frames(2);
  // Editors read the entity registry over the websocket: wait for it, then for the render that follows.
  step('registry');
  for (let i = 0; i < 50 && pendingWS > 0; i++) await frames(1);
  step('second render');
  for (const e of els) await e.updateComplete;
  if (scene.kind === 'sheet') {
    step('sheet');
    await sheetOf!().open(sheetCfg, null);
    await frames(2);
  }
  step('park');
  await document.fonts.ready;
  await frames(2);
  w.__pixelInfo = { parkedAnimations: parkAnimations() };
  await frames(2);
  step('ready');
  w.__pixelReady = true;
}

if (params.get('list') === '1') w.__pixelReady = true;
else void run().catch((e) => { w.__pixelError = String(e?.stack ?? e); w.__pixelReady = true; });
