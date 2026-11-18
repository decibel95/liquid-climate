import type { HassEntity, HomeAssistant } from '../types';
import { englishFixture } from './english';
import { AREAS, FLOORS, allFixtures, appliances, makeHass, mergeFixtures } from './fixtures';

/**
 * A fake Home Assistant for the dev harness and the docs site. Service calls wait a moment, change only
 * the in-memory states and publish a new hass object to the subscribers, as Home Assistant does.
 * Not part of the shipped bundle: nothing in src/index.ts imports this folder.
 */

export const HELPER_DOMAINS = ['input_select', 'select', 'input_boolean', 'switch', 'script', 'automation'];

/** The helper entities of the status menu, next to the climate fixtures. */
export function addHelperEntities(states: Record<string, HassEntity>): void {
  states['input_select.heating_mode'] = {
    entity_id: 'input_select.heating_mode',
    state: 'Auto',
    attributes: { friendly_name: 'Heating mode', options: ['Auto', 'Comfort', 'Eco', 'Off'] },
  };
  states['script.apply_heating'] = { entity_id: 'script.apply_heating', state: 'off', attributes: { friendly_name: 'Apply heating' } };
  states['automation.heating_schedule'] = {
    entity_id: 'automation.heating_schedule',
    state: 'on',
    attributes: { friendly_name: 'Heating schedule', id: '1700000000001' },
  };
  // The pause switch the badges and the cluster read.
  states['input_boolean.window'] = { entity_id: 'input_boolean.window', state: 'off', attributes: { friendly_name: 'Window' } };
}

export interface DemoOptions {
  /** Milliseconds a service call takes before the state changes. Default 400. */
  delay?: number;
  /** Initial language. Default en. */
  language?: string;
  /** Sets hass.themes.darkMode. Leave undefined to give the cards no theme (they render light). */
  dark?: boolean;
  /** Neutral English names and ids (Living Room, Bedroom, Office, Studio) instead of the Daikin fixtures. The docs use this. */
  english?: boolean;
  /** hass.user.is_admin: shows the Edit links in the menu. Default true. */
  admin?: boolean;
  /** Called at the moment of every service call, before the delay. */
  onCall?: (domain: string, service: string, data: Record<string, unknown>) => void;
}

export interface Demo {
  /** The latest published hass object. */
  readonly hass: HomeAssistant;
  /** The mutable fake states; call publish() after changing one. */
  readonly states: Record<string, HassEntity>;
  /** Builds a new hass object from the current states and hands it to every subscriber. */
  publish(): void;
  /** Called with every published hass object. Returns the unsubscribe function. */
  subscribe(fn: (hass: HomeAssistant) => void): () => void;
  setLanguage(language: string): void;
  setDark(dark: boolean): void;
  /** Resolves pending calls without applying them, stops timers and drops the subscribers. Later calls do nothing. */
  dispose(): void;
}

/** The demo water heater: turn_on goes back to eco and turn_off to off, as Home Assistant's demo does. */
function applyWaterHeater(states: Record<string, HassEntity>, service: string, data: Record<string, unknown>) {
  const id = String(data.entity_id);
  const s = states[id];
  if (!s) return;
  const a = { ...s.attributes };
  let state = s.state;
  if (service === 'set_temperature' && 'temperature' in data) a.temperature = data.temperature;
  if (service === 'set_operation_mode') state = String(data.operation_mode);
  if (service === 'turn_on') state = state === 'off' ? 'eco' : state;
  if (service === 'turn_off') state = 'off';
  if (service === 'set_away_mode') a.away_mode = data.away_mode ? 'on' : 'off';
  a.operation_mode = state;
  states[id] = { ...s, state, attributes: a };
}

/** The demo humidifiers: on and off, the mode and the target humidity. */
function applyHumidifier(states: Record<string, HassEntity>, service: string, data: Record<string, unknown>) {
  const id = String(data.entity_id);
  const s = states[id];
  if (!s) return;
  const a = { ...s.attributes };
  let state = s.state;
  if (service === 'turn_on') state = 'on';
  if (service === 'turn_off') state = 'off';
  if (service === 'set_mode') a.mode = data.mode;
  if (service === 'set_humidity') a.humidity = data.humidity;
  if ('action' in a) a.action = state === 'off' ? 'off' : a.device_class === 'dehumidifier' ? 'drying' : 'humidifying';
  states[id] = { ...s, state, attributes: a };
}

/** A water heater or humidifier service call on the fake states; the media page uses it too. */
export function applyAppliance(states: Record<string, HassEntity>, domain: string, service: string, data: Record<string, unknown>): void {
  if (domain === 'water_heater') applyWaterHeater(states, service, data);
  else if (domain === 'humidifier') applyHumidifier(states, service, data);
}

function applyClimate(states: Record<string, HassEntity>, service: string, data: Record<string, unknown>) {
  const id = String(data.entity_id);
  const s = states[id];
  if (!s) return;
  const a = { ...s.attributes };
  let state = s.state;
  if (service === 'set_hvac_mode') state = String(data.hvac_mode);
  if (service === 'set_temperature') {
    if ('temperature' in data) a.temperature = data.temperature;
    if ('target_temp_low' in data) a.target_temp_low = data.target_temp_low;
    if ('target_temp_high' in data) a.target_temp_high = data.target_temp_high;
  }
  for (const k of ['fan_mode', 'swing_mode', 'swing_horizontal_mode', 'preset_mode']) {
    if (service === `set_${k}`) a[k] = data[k];
  }
  states[id] = { ...s, state, attributes: a };
}

export function createDemo(options: DemoOptions = {}): Demo {
  const delay = options.delay ?? 400;
  const language = options.language ?? 'en';
  const source = options.english ? englishFixture() : { fixture: allFixtures, areas: AREAS, floors: FLOORS };
  // The water heaters and humidifiers of Home Assistant's demo integration, next to the climate units.
  const fixture = mergeFixtures(source.fixture, appliances());
  const { areas, floors } = source;
  const states = structuredClone(fixture.states);
  addHelperEntities(states);

  const subscribers = new Set<(hass: HomeAssistant) => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const pending = new Set<() => void>();
  let disposed = false;
  const later = (fn: () => void, ms: number) => {
    if (disposed) return;
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
  };

  const base = makeHass(fixture, '°C', (domain, service, rawData) => {
    const data = (rawData ?? {}) as Record<string, unknown>;
    if (disposed) return Promise.resolve();
    options.onCall?.(domain, service, data);
    return new Promise<void>((resolve) => {
      pending.add(resolve);
      later(() => {
        pending.delete(resolve);
        if (HELPER_DOMAINS.includes(domain)) applyHelper(domain, service, data);
        else if (domain === 'water_heater' || domain === 'humidifier') applyAppliance(states, domain, service, data);
        else applyClimate(states, service, data);
        publish();
        resolve();
      }, delay);
    });
  });
  // localize returns '' ("no such key"), so the cards show their own translations; on a real install
  // Home Assistant's own names for modes, fan, swing and preset values win.
  base.localize = () => '';
  base.states = states;
  base.areas = areas;
  base.floors = floors;
  base.language = language;
  base.locale = { language, number_format: 'language' };
  base.user = { is_admin: options.admin ?? true };
  if (options.dark !== undefined) base.themes = { darkMode: options.dark };
  // The editor reads unique_id and original_name over the websocket; serve them from the fixtures.
  base.callWS = (async (msg: Record<string, unknown>) => {
    if (msg.type === 'config/entity_registry/list') {
      return Object.entries(fixture.registry).map(([entity_id, x]) => ({ entity_id, ...x }));
    }
    throw new Error('unsupported in the demo');
  }) as HomeAssistant['callWS'];

  let hass: HomeAssistant = base;

  function notify() {
    if (disposed) return;
    for (const fn of subscribers) fn(hass);
  }

  function publish() {
    hass = { ...hass, states: { ...states } };
    notify();
  }

  /** Helper entities of the status menu: not climate, so they get their own service handling. */
  function applyHelper(domain: string, service: string, data: Record<string, unknown>) {
    const id = String(data.entity_id);
    const s = states[id];
    if (!s) return;
    const set = (state: string) => (states[id] = { ...states[id], state });
    if (service === 'select_option') set(String(data.option));
    else if (service === 'turn_on') {
      set('on');
      // A script runs for a moment and then falls back to off.
      if (domain === 'script') later(() => { set('off'); publish(); }, 1500);
    } else if (service === 'turn_off') set('off');
    else if (service === 'toggle') set(s.state === 'on' ? 'off' : 'on');
  }

  return {
    get hass() {
      return hass;
    },
    states,
    publish,
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    // A new locale object counts as a change for every card and editor.
    setLanguage(lang) {
      if (disposed) return;
      hass = { ...hass, language: lang, locale: { language: lang, number_format: 'language' } };
      notify();
    },
    setDark(dark) {
      if (disposed) return;
      hass = { ...hass, themes: { darkMode: dark } };
      notify();
    },
    dispose() {
      disposed = true;
      for (const resolve of pending) resolve();
      pending.clear();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      subscribers.clear();
    },
  };
}
