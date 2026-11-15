/**
 * Staging page for the README and docs media. No harness chrome: just the cards on a calm
 * background, in Home Assistant's light or dark theme. Driven by scripts/media (Playwright).
 *
 *   ?scene=hero|dial|tile|badge|cluster|editor|cluster-editor|status-menu|sheet|trv
 *   ?theme=light|dark|split   ?lang=en|nl|de|fr|es|it   ?cursor=1 (visible pointer for recordings)
 *
 * Window API for the scripts: __mediaReady (true once fonts and all cards have rendered) and
 * __media.setLang(lang), __media.pointer(visible), __media.settle() (pause ambient motion) and
 * __media.trv(room, patch) (change a radiator valve of the trv scene: action, current, target, valve, battery).
 */
import './media-focus';
import '../src/index';
import { englishFixture } from '../src/demo/english';
import { addHelperEntities } from '../src/demo/service';
import { makeHass } from '../src/demo/fixtures';
import { trvSonoff } from '../test/fixtures/trv';
import type { HassEntity, HomeAssistant } from '../src/types';

const params = new URLSearchParams(location.search);
const scene = params.get('scene') ?? 'hero';
const theme = params.get('theme') ?? 'light';
const LANGUAGES = ['en', 'nl', 'de', 'fr', 'es', 'it'];
let lang = LANGUAGES.includes(params.get('lang') ?? '') ? params.get('lang')! : 'en';

type El = HTMLElement & { hass: HomeAssistant; setConfig(c: Record<string, unknown>): void };

// ---- Fake state: English names and ids only (the docs demos share them, see src/demo/english.ts) ----
const { fixture, areas, floors } = englishFixture();
const states = fixture.states;
// Fixed readings: one room per mode, so the composition shows heat, cool, off and a range.
const attrs = (id: string) => states[id].attributes as Record<string, unknown>;
states['climate.office'] = { ...states['climate.office'], state: 'off' };
attrs('climate.living_room').fan_mode = '3';
attrs('climate.bedroom').fan_mode = 'auto';

addHelperEntities(states);
// Pauses the Studio badge only (a window contact that reads open).
states['input_boolean.studio_window'] = { entity_id: 'input_boolean.studio_window', state: 'on', attributes: { friendly_name: 'Studio window' } };

// Two radiator valves (Zigbee2MQTT style: climate, battery, valve opening, window contact) with fake ids and English names.
const TRV_ROOMS = {
  hallway: { id: 'climate.hallway_radiator', name: 'Hallway radiator', hex: '0x00124b00aa000001' },
  bedroom: { id: 'climate.bedroom_radiator', name: 'Bedroom radiator', hex: '0x00124b00aa000002' },
} as const;
type TrvRoom = keyof typeof TRV_ROOMS;
for (const [slug, room] of Object.entries(TRV_ROOMS)) {
  const copy = JSON.parse(
    JSON.stringify(trvSonoff)
      .replaceAll('trv_sonoff', `${slug}_radiator`)
      .replaceAll('0x00124b001234abcd', room.hex)
      .replaceAll('Radiator valve', room.name)
      .replaceAll('SONOFF', 'Acme')
      .replaceAll('TRVZB', 'TRV-1')
      .replaceAll('"area_id":"lab"', '"area_id":null'),
  ) as typeof trvSonoff;
  Object.assign(states, copy.states);
  Object.assign(fixture.entities, copy.entities);
  Object.assign(fixture.devices, copy.devices);
  Object.assign(fixture.registry, copy.registry);
}
/** Change one reading of a radiator valve. */
function setTrv(slug: TrvRoom, patch: { action?: string; current?: number; target?: number; valve?: number; battery?: number }) {
  const id = TRV_ROOMS[slug].id;
  const a = { ...states[id].attributes };
  if (patch.action !== undefined) a.hvac_action = patch.action;
  if (patch.current !== undefined) a.current_temperature = patch.current;
  if (patch.target !== undefined) a.temperature = patch.target;
  states[id] = { ...states[id], attributes: a };
  const setSensor = (suffix: string, value?: number) => {
    const sid = `sensor.${slug}_radiator_${suffix}`;
    if (value !== undefined) states[sid] = { ...states[sid], state: String(value) };
  };
  setSensor('pi_heating_demand', patch.valve);
  setSensor('battery', patch.battery);
}
setTrv('hallway', { action: 'idle', current: 20.6, target: 20, valve: 0, battery: 78 });
setTrv('bedroom', { action: 'heating', current: 17.8, target: 20.5, valve: 65, battery: 78 });

// ---- What the card reads as a state: HA's formatEntityState ------------------------------------
const WORDS: Record<string, Record<string, string>> = {
  en: { on: 'On', off: 'Off', open: 'Open', closed: 'Closed', home: 'Home', not_home: 'Away', away: 'Away', unavailable: 'Unavailable', unknown: 'Unknown', heat: 'Heat', cool: 'Cool', heat_cool: 'Heat/Cool', auto: 'Auto', dry: 'Dry', fan_only: 'Fan only' },
  nl: { on: 'Aan', off: 'Uit', open: 'Open', closed: 'Gesloten', home: 'Thuis', not_home: 'Afwezig', away: 'Afwezig', unavailable: 'Niet beschikbaar', unknown: 'Onbekend', heat: 'Verwarmen', cool: 'Koelen', heat_cool: 'Verwarmen/Koelen', auto: 'Auto', dry: 'Drogen', fan_only: 'Alleen ventilator' },
  de: { on: 'An', off: 'Aus', open: 'Offen', closed: 'Geschlossen', home: 'Zuhause', not_home: 'Abwesend', away: 'Abwesend', unavailable: 'Nicht verfügbar', unknown: 'Unbekannt', heat: 'Heizen', cool: 'Kühlen', heat_cool: 'Heizen/Kühlen', auto: 'Auto', dry: 'Trocknen', fan_only: 'Nur Lüfter' },
  fr: { on: 'Marche', off: 'Arrêt', open: 'Ouvert', closed: 'Fermé', home: 'Maison', not_home: 'Absent', away: 'Absent', unavailable: 'Indisponible', unknown: 'Inconnu' },
  es: { on: 'Encendido', off: 'Apagado', open: 'Abierto', closed: 'Cerrado', home: 'En casa', not_home: 'Fuera', away: 'Fuera', unavailable: 'No disponible', unknown: 'Desconocido' },
  it: { on: 'Acceso', off: 'Spento', open: 'Aperto', closed: 'Chiuso', home: 'A casa', not_home: 'Fuori', away: 'Fuori', unavailable: 'Non disponibile', unknown: 'Sconosciuto' },
};
const title = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Like the frontend: translated words for on/off/open/..., user options (input_select) as they are. */
function formatEntityState(e: HassEntity, state?: string): string {
  const value = state ?? e.state;
  const domain = e.entity_id.split('.')[0];
  if (domain === 'input_select' || domain === 'select') return value;
  const unit = e.attributes.unit_of_measurement;
  if (domain === 'sensor' && /^-?\d+(\.\d+)?$/.test(value)) return unit ? `${value} ${unit}` : value;
  return WORDS[lang]?.[value] ?? WORDS.en[value] ?? title(value);
}

// ---- Fake hass, one per themed root ----------------------------------------------------------
interface Root {
  hass: HomeAssistant;
  els: El[];
}
const roots: Root[] = [];
const DELAY_MS = 300;

function applyClimate(service: string, data: Record<string, unknown>) {
  const id = String(data.entity_id);
  const s = states[id];
  if (!s) return;
  const a = { ...s.attributes };
  let state = s.state;
  if (service === 'set_hvac_mode') state = String(data.hvac_mode);
  if (service === 'set_temperature') {
    for (const k of ['temperature', 'target_temp_low', 'target_temp_high']) if (k in data) a[k] = data[k];
  }
  for (const k of ['fan_mode', 'swing_mode', 'swing_horizontal_mode', 'preset_mode']) {
    if (service === `set_${k}`) a[k] = data[k];
  }
  states[id] = { ...s, state, attributes: a };
}

function applyHelper(domain: string, service: string, data: Record<string, unknown>) {
  const id = String(data.entity_id);
  const s = states[id];
  if (!s) return;
  const set = (state: string) => (states[id] = { ...states[id], state });
  if (service === 'select_option') set(String(data.option));
  else if (service === 'turn_on') {
    set('on');
    if (domain === 'script') setTimeout(() => { set('off'); publish(); }, 1500);
  } else if (service === 'turn_off') set('off');
  else if (service === 'toggle') set(s.state === 'on' ? 'off' : 'on');
}

function publish() {
  for (const r of roots) {
    r.hass = { ...r.hass, states: { ...states } };
    for (const el of r.els) el.hass = r.hass;
  }
}

function newRoot(dark: boolean): Root {
  const hass = makeHass(fixture, '°C', (domain, service, data) =>
    new Promise<void>((resolve) =>
      setTimeout(() => {
        if (['input_select', 'select', 'input_boolean', 'switch', 'script', 'automation'].includes(domain)) {
          applyHelper(domain, service, data as Record<string, unknown>);
        } else applyClimate(service, data as Record<string, unknown>);
        publish();
        resolve();
      }, DELAY_MS),
    ),
  );
  hass.states = { ...states };
  hass.areas = areas;
  hass.floors = floors;
  hass.language = lang;
  hass.locale = { language: lang, number_format: 'language' };
  hass.localize = () => '';
  hass.formatEntityState = formatEntityState;
  hass.themes = { darkMode: dark } as HomeAssistant['themes'];
  hass.user = { is_admin: true };
  hass.callWS = (async (msg: Record<string, unknown>) => {
    if (msg.type === 'config/entity_registry/list') {
      return Object.entries(fixture.registry).map(([entity_id, x]) => ({ entity_id, ...x }));
    }
    throw new Error('unsupported');
  }) as HomeAssistant['callWS'];
  const r: Root = { hass, els: [] };
  roots.push(r);
  return r;
}

// ---- Scenes ----------------------------------------------------------------------------------
function el(tag: string, cls?: string, parent?: HTMLElement): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.append(e);
  return e;
}

function card(r: Root, tag: string, cfg: Record<string, unknown>, parent: HTMLElement): El {
  const e = document.createElement(tag) as El;
  e.setConfig(cfg);
  e.hass = r.hass;
  r.els.push(e);
  parent.append(e);
  return e;
}

const LIVING = 'climate.living_room';
const BEDROOM = 'climate.bedroom';
const OFFICE = 'climate.office';
const STUDIO = 'climate.studio';

/** Mode colour stays on the setpoint arc, the knob and the active mode: no wash over the glass. */
const look = { tint: 0 };

const dialConfig = (): Record<string, unknown> => ({
  entity: LIVING,
  name: 'Living Room',
  look,
  status_entities: [
    { entity: 'input_select.heating_mode', name: 'Heating mode', actions: ['script.apply_heating', 'automation.heating_schedule'] },
    { entity: 'input_boolean.window', name: 'Window pause' },
  ],
});

const roomSensors = (slug: string) => ({
  outdoor: `sensor.${slug}_outdoor_temperature`,
  energy: [`sensor.${slug}_energy_heating_daily`, `sensor.${slug}_energy_cooling_daily`],
});
const clusterConfig = (): Record<string, unknown> => ({
  type: 'custom:liquid-climate-cluster',
  look,
  entities: [
    { entity: LIVING, name: 'Living Room', sensors: roomSensors('living_room') },
    { entity: OFFICE, name: 'Office', sensors: roomSensors('office') },
    { entity: BEDROOM, name: 'Bedroom', sensors: roomSensors('bedroom') },
    { entity: STUDIO, name: 'Studio' },
  ],
});

const tileConfigs = (): Record<string, unknown>[] =>
  [
    { entity: LIVING, name: 'Living Room' },
    { entity: BEDROOM, name: 'Bedroom' },
    { entity: OFFICE, name: 'Office' },
    { entity: STUDIO, name: 'Studio' },
  ].map((c) => ({ ...c, look }));

const badgeConfigs = (): Record<string, unknown>[] => [
  { entity: LIVING, name: 'Living Room' },
  { entity: BEDROOM, name: 'Bedroom' },
  { entity: OFFICE, name: 'Office' },
  { entity: STUDIO, name: 'Studio', pause_entity: 'input_boolean.studio_window' },
];

function build(r: Root, parent: HTMLElement) {
  switch (scene) {
    case 'hero': {
      const g = el('div', 'hero', parent);
      card(r, 'liquid-climate-card', dialConfig(), el('div', 'dialbox', g));
      const mid = el('div', 'mid', g);
      for (const c of tileConfigs()) card(r, 'liquid-climate-tile', c, mid);
      const badges = el('div', 'badges', mid);
      for (const c of badgeConfigs()) card(r, 'liquid-climate-badge', c, badges);
      card(r, 'liquid-climate-cluster', clusterConfig(), el('div', 'clusterbox', g));
      break;
    }
    case 'dial':
    case 'status-menu': {
      const w = el('div', scene === 'dial' ? 'dial-scene' : 'menu-scene', parent);
      const d = el('div', 'w-dial', w);
      card(r, 'liquid-climate-card', dialConfig(), d);
      break;
    }
    case 'trv': {
      const w = el('div', 'trv-scene', parent);
      for (const room of Object.values(TRV_ROOMS)) card(r, 'liquid-climate-card', { entity: room.id, name: room.name, look, sensors: { valve: room.id.replace('climate.', 'sensor.') + '_pi_heating_demand' } }, el('div', 'w-dial', w));
      break;
    }
    case 'tile': {
      const w = el('div', 'pad', parent);
      const c = el('div', 'col w-tile', w);
      for (const cfg of tileConfigs()) card(r, 'liquid-climate-tile', cfg, c);
      break;
    }
    case 'sheet': {
      const w = el('div', 'sheet-scene', parent);
      const c = el('div', 'col', w);
      for (const cfg of tileConfigs().slice(0, 2)) card(r, 'liquid-climate-tile', cfg, c);
      break;
    }
    case 'badge': {
      const w = el('div', 'pad', parent);
      const rows = el('div', 'col', w);
      const a = el('div', 'row', rows);
      for (const cfg of badgeConfigs()) card(r, 'liquid-climate-badge', cfg, a);
      const b = el('div', 'row', rows);
      for (const cfg of badgeConfigs()) card(r, 'liquid-climate-badge', { ...cfg, icon_only: true }, b);
      break;
    }
    case 'cluster': {
      const w = el('div', 'pad', parent);
      const c = el('div', 'w-cluster', w);
      card(r, 'liquid-climate-cluster', clusterConfig(), c);
      break;
    }
    case 'editor':
    case 'cluster-editor': {
      const w = el('div', 'pad', parent);
      const box = el('div', 'editor-box w-editor', w);
      const tag = scene === 'editor' ? 'liquid-climate-card-editor' : 'liquid-climate-cluster-editor';
      const cfg = scene === 'editor' ? { type: 'custom:liquid-climate-card', entity: LIVING, name: 'Living Room' } : clusterConfig();
      card(r, tag, cfg, box);
      break;
    }
    default:
      throw new Error(`Unknown scene ${scene}`);
  }
}

const stage = document.getElementById('stage')!;
if (scene === 'hero') stage.classList.add('fixed');
if (theme === 'split') {
  for (const dark of [false, true]) {
    const layer = el('div', `root layer theme-${dark ? 'dark' : 'light'}`, stage);
    layer.id = dark ? 'dark-layer' : 'light-layer';
    build(newRoot(dark), layer);
  }
} else {
  const dark = theme === 'dark';
  stage.className += ` root theme-${dark ? 'dark' : 'light'}`;
  // The page behind the stage follows the theme too, so no rounding edge shows the other one.
  document.documentElement.classList.add(dark ? 'theme-dark' : 'theme-light');
  build(newRoot(dark), stage);
}

// ---- Pointer overlay for recordings ----------------------------------------------------------
const pointerEl = el('div', '', document.body);
if (params.get('cursor') === '1') {
  const p = pointerEl;
  p.id = 'pointer';
  p.setAttribute('popover', 'manual');
  p.append(document.createElement('i'));
  p.showPopover();
  let queued = false;
  const move = (e: MouseEvent) => {
    p.style.transform = `translate(${e.clientX - 11}px, ${e.clientY - 11}px)`;
    // A modal dialog opens in the top layer above the pointer: put the pointer back on top.
    if (!queued) {
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        p.hidePopover();
        p.showPopover();
      });
    }
  };
  addEventListener('mousemove', move, true);
  // No focus rings from pointer use in recordings.
  addEventListener('mousedown', (e) => { move(e); p.classList.add('down'); e.preventDefault(); }, true);
  addEventListener('mouseup', () => p.classList.remove('down'), true);
} else {
  pointerEl.remove();
}

// ---- Window API --------------------------------------------------------------------------------
const allElements = (root: ParentNode = document): Element[] => {
  const out: Element[] = [];
  for (const e of root.querySelectorAll('*')) {
    out.push(e);
    if (e.shadowRoot) out.push(...allElements(e.shadowRoot));
  }
  return out;
};

(window as unknown as { __media: unknown }).__media = {
  setLang(next: string) {
    lang = next;
    for (const r of roots) {
      r.hass = { ...r.hass, language: next, locale: { language: next, number_format: 'language' } };
      for (const e of r.els) e.hass = r.hass;
    }
  },
  trv(slug: TrvRoom, patch: Parameters<typeof setTrv>[1]) {
    setTrv(slug, patch);
    publish();
  },
  pointer(visible: boolean) {
    pointerEl.classList.toggle('on', visible);
  },
  /** For stills: let finite animations and transitions finish, park the endless ones (particles, spin) at their start. */
  async settle() {
    // A paused finite animation never finishes: give up after about 3 s rather than hang the run.
    const work = (async () => {
      for (let round = 0; round < 4; round++) {
        const list = allElements().flatMap((e) => e.getAnimations());
        const finite = list.filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime as number));
        await Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
        for (const a of list) {
          if (!finite.includes(a)) {
            a.pause();
            a.currentTime = 0;
          }
        }
      }
    })();
    await Promise.race([work, new Promise((res) => setTimeout(res, 3000))]);
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  },
};

/** Hero: the dial is scaled to the height of the cluster, and the split sits in the gap between tiles and cluster. */
function fitHero() {
  for (const h of document.querySelectorAll<HTMLElement>('.hero')) {
    const box = h.querySelector<HTMLElement>('.dialbox')!;
    const cluster = h.querySelector<HTMLElement>('.clusterbox')!;
    // Measure the dial at its natural width, not squeezed into the scaled column.
    h.style.gridTemplateColumns = '444px 420px 520px';
    box.style.zoom = '1';
    const z = cluster.getBoundingClientRect().height / box.getBoundingClientRect().height;
    box.style.zoom = String(z);
    h.style.gridTemplateColumns = `${Math.floor(444 * z)}px 420px 520px`;
  }
  const dark = document.getElementById('dark-layer');
  const light = document.getElementById('light-layer');
  if (dark && light) {
    const mid = light.querySelector('.mid')!.getBoundingClientRect();
    const cluster = light.querySelector('.clusterbox')!.getBoundingClientRect();
    dark.style.clipPath = `inset(0 0 0 ${Math.round((mid.right + cluster.left) / 2)}px)`;
  }
}

async function ready() {
  await document.fonts.ready;
  for (const r of roots) {
    for (const e of r.els) await (e as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  }
  await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  if (scene === 'hero') {
    fitHero();
    await new Promise((res) => requestAnimationFrame(res));
  }
  (window as unknown as { __mediaReady: boolean }).__mediaReady = true;
}
void ready();
