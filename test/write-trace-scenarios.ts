// Write-trace scenarios for test/write-trace.test.ts (against the 0.12.0 fixture) and
// test/write-trace-sensitivity.test.ts (the same scenarios on a plain liquid-core writer).
//
// Every scenario runs real cards (dial, tile with its sheet, cluster) on fake timers and a recording hass. The trace
// lists, in time order: what the scenario did (`do`), every service call (`call`), every console.error (`log`), and the
// writer and text state (`state`) whenever it changed since the last one, sampled after every action, every 100 ms
// tick and every change the probed writer announces to its listeners (so a change undone within a tick still shows).
import { vi } from 'vitest';
import '../src/index';
import { forgetModes, writerRefs } from '../src/cards/shared/writer';
import { R_TEMP, fractionToAngle, pt, valueToFraction } from '../src/ui/geometry';
import type { HomeAssistant } from '../src/types';
import { APPLIANCE_IDS, AREAS, FLOORS, allFixtures, appliances, makeHass, mergeFixtures, type Fixture } from './fixtures';

export const TICK = 100;

type AnyEl = HTMLElement & Record<string, any>;

export interface Snapshot {
  /** The entity of the probed writer, or null when no card holds one. */
  entity: string | null;
  local: Record<string, unknown> | null;
  modeChanging: boolean | null;
  sending: boolean | null;
  error: string | null;
  /** The tile's status line (`.sub`) as last rendered, null without a connected tile. */
  tile: string | null;
  /** The cluster's alert region (`.sr[role=alert]`), null without a connected cluster. */
  announce: string | null;
}

export type Entry =
  | { t: number; do: string }
  | { t: number; call: { domain: string; service: string; data: Record<string, unknown> } }
  | { t: number; log: string }
  | { t: number; state: Snapshot };

/** How the recording hass answers call number n (0-based): at once, after `ms`, and with or without an error. */
interface Reply {
  ms?: number;
  /** `message`: an Error with a message; `plain`: a rejection without one, so the card's own text shows. */
  fail?: 'message' | 'plain';
}

const K = 'climate.keuken_airco';
const S = 'climate.slaapkamer_airco';
const N = 'climate.nagelsalon_airco';
const DUAL = 'climate.dual_setpoint';
const WH = APPLIANCE_IDS.waterHeater;
const HYG = APPLIANCE_IDS.hygrostat;

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

/** JSON with sorted keys, so the change check and the fixture never depend on insertion order. */
function sorted(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sorted);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])]));
  return v;
}

class Rig {
  trace: Entry[] = [];
  hass: HomeAssistant;
  els: AnyEl[] = [];
  tile?: AnyEl;
  cluster?: AnyEl;
  probe: () => any = () => undefined;
  private calls = 0;
  private last = '';
  /** The probed writer this rig listens to, so every changed() of it is sampled, not only the ticks. */
  private watched?: any;
  private unwatch?: () => void;

  constructor(
    fixture: Fixture,
    private replies: Record<number, Reply> = {},
  ) {
    this.hass = makeHass(fixture, '°C', (domain, service, data) => this.callService(domain, service, data as Record<string, unknown>));
    this.hass.areas = structuredClone(AREAS);
    this.hass.floors = structuredClone(FLOORS);
  }

  private now() {
    return Date.now();
  }

  private callService(domain: string, service: string, data: Record<string, unknown>): Promise<void> {
    const n = this.calls++;
    this.trace.push({ t: this.now(), call: { domain, service, data: sorted(structuredClone(data)) as Record<string, unknown> } });
    const r = this.replies[n];
    if (!r) return Promise.resolve();
    const err = r.fail === 'message' ? new Error('Rate limit reached') : r.fail === 'plain' ? { code: 'unknown_error' } : undefined;
    if (!r.ms) return err ? Promise.reject(err) : Promise.resolve();
    return new Promise((resolve, reject) => setTimeout(() => (err ? reject(err) : resolve()), r.ms));
  }

  log(args: unknown[]) {
    const [first, err] = args;
    this.trace.push({ t: this.now(), log: `${String(first)}${err instanceof Error ? ` (${err.message})` : err ? ` (${JSON.stringify(err)})` : ''}` });
  }

  mount(tag: string, cfg: Record<string, unknown>): AnyEl {
    const el = document.createElement(tag) as AnyEl;
    el.setConfig({ type: `custom:${tag}`, ...cfg });
    el.hass = this.hass;
    document.body.append(el);
    this.els.push(el);
    if (tag === 'liquid-climate-tile') this.tile = el;
    if (tag === 'liquid-climate-cluster') this.cluster = el;
    return el;
  }

  async settle() {
    for (let i = 0; i < 3; i++) await Promise.all(this.els.map((e) => e.updateComplete));
  }

  sample() {
    const w = this.probe();
    if (w !== this.watched) {
      this.unwatch?.();
      this.watched = w;
      this.unwatch = w?.subscribe(() => this.sample());
    }
    const tile = this.tile?.isConnected ? text(this.tile.shadowRoot!.querySelector('.sub')) : null;
    const announce = this.cluster?.isConnected ? text(this.cluster.shadowRoot!.querySelector('.sr[role=alert]')) : null;
    const state: Snapshot = {
      entity: w ? w.entityId : null,
      local: w ? (sorted({ ...w.local }) as Record<string, unknown>) : null,
      modeChanging: w ? w.modeChanging : null,
      sending: w ? w.sending : null,
      error: w ? w.error : null,
      tile,
      announce,
    };
    const key = JSON.stringify(state);
    if (key === this.last) return;
    this.last = key;
    this.trace.push({ t: this.now(), state });
  }

  async act(label: string, fn: () => unknown = () => undefined) {
    this.trace.push({ t: this.now(), do: label });
    await fn();
    await this.settle();
    this.sample();
  }

  async wait(ms: number) {
    for (let i = 0; i < ms / TICK; i++) {
      await vi.advanceTimersByTimeAsync(TICK);
      await this.settle();
      this.sample();
    }
  }

  /** Stop listening to the probed writer. */
  end() {
    this.unwatch?.();
    this.watched = this.unwatch = undefined;
  }

  /** Home Assistant reports a new state for `id`: a new hass object goes to every card. */
  async report(id: string, patch: { state?: string; attributes?: Record<string, unknown> }) {
    const label = `report ${id} ${JSON.stringify(sorted(patch))}`;
    await this.act(label, () => {
      const old = this.hass.states[id];
      const next = { ...old, ...(patch.state ? { state: patch.state } : {}), attributes: { ...old.attributes, ...patch.attributes } };
      this.hass = { ...this.hass, states: { ...this.hass.states, [id]: next } };
      for (const el of this.els) el.hass = this.hass;
    });
  }

  /** Remove every card (their leases release, pending writes go out) and let the remaining timers run. */
  async teardown() {
    await this.act('remove every card', () => {
      for (const el of this.els) el.remove();
    });
    await this.wait(1000);
  }
}

// ---- Card helpers ----------------------------------------------------------

const $ = (el: AnyEl, sel: string) => el.shadowRoot!.querySelector(sel) as HTMLElement | null;
const $$ = (el: AnyEl, sel: string) => [...el.shadowRoot!.querySelectorAll(sel)] as HTMLElement[];

function byLabel(el: AnyEl, sel: string, label: string): HTMLElement {
  const hit = $$(el, sel).find((b) => b.getAttribute('aria-label') === label || text(b) === label);
  if (!hit) throw new Error(`write trace: no ${sel} "${label}" in ${el.localName}; have ${$$(el, sel).map((b) => b.getAttribute('aria-label') ?? text(b)).join(' | ')}`);
  return hit;
}

/** The dial in a tile's open sheet. */
function sheetDial(tile: AnyEl): AnyEl {
  const sheet = $(tile, 'liquid-climate-sheet') as AnyEl;
  const dial = sheet.shadowRoot!.querySelector('liquid-climate-card') as AnyEl | null;
  if (!dial) throw new Error('write trace: the sheet has no dial');
  return dial;
}

function dialSvg(dial: AnyEl): SVGElement & Record<string, any> {
  const svg = dial.shadowRoot!.querySelector('svg.dial') as SVGElement & Record<string, any>;
  // happy-dom lays nothing out: the dial is 400 px square at the origin, one viewBox unit per pixel.
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400, x: 0, y: 0, toJSON: () => ({}) });
  return svg;
}

/** A pointer event on the dial's setpoint track at `value` (min and max from the entity). */
function pointer(dial: AnyEl, type: string, value?: number) {
  const svg = dialSvg(dial);
  let x = 0;
  let y = 0;
  if (value !== undefined) {
    const a = dial.hass.states[dial._config.entity].attributes;
    [x, y] = pt(R_TEMP, fractionToAngle(valueToFraction(value, a.min_temp, a.max_temp)));
  }
  svg.dispatchEvent(Object.assign(new Event(type, { bubbles: true, composed: true }), { clientX: x, clientY: y, pointerId: 1 }));
}

function key(target: Element, k: string, shiftKey = false) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, composed: true }));
}

const tileStep = (tile: AnyEl, dir: 'down' | 'up') => ($$(tile, 'button.step')[dir === 'down' ? 0 : 1] as HTMLButtonElement).click();
const tilePower = (tile: AnyEl) => ($(tile, 'button.power') as HTMLButtonElement).click();
const openTileSheet = (tile: AnyEl) => ($(tile, 'button.body') as HTMLButtonElement).click();
const stripStep = (c: AnyEl, dir: 'down' | 'up') => ($$(c, '.strip button.step')[dir === 'down' ? 0 : 1] as HTMLButtonElement).click();

// ---- Scenarios -------------------------------------------------------------

interface Scenario {
  fixture?: (f: Fixture) => void;
  replies?: Record<number, Reply>;
  /** Entities whose writers must all be gone after teardown. */
  ids: string[];
  run: (r: Rig) => Promise<void>;
}

const base = () => mergeFixtures(allFixtures, appliances());

export const SCENARIOS: Record<string, Scenario> = {
  /** One setpoint drag on the tile's sheet dial: nothing while held, one call 1.5 s after release. */
  drag_one_call: {
    ids: [K],
    run: async (r) => {
      const tile = r.mount('liquid-climate-tile', { entity: K });
      r.probe = () => tile._lease.current;
      await r.act('mount tile');
      await r.act('open sheet', () => openTileSheet(tile));
      const dial = sheetDial(tile);
      await r.act('pointerdown 20', () => pointer(dial, 'pointerdown', 20));
      await r.wait(300);
      await r.act('pointermove 21', () => pointer(dial, 'pointermove', 21));
      await r.wait(300);
      await r.act('pointermove 22', () => pointer(dial, 'pointermove', 22));
      await r.wait(2000);
      await r.act('pointerup', () => pointer(dial, 'pointerup'));
      await r.wait(2000);
      await r.report(K, { attributes: { temperature: 22 } });
      await r.wait(300);
      await r.act('close sheet', () => ($(tile, 'liquid-climate-sheet') as AnyEl).close());
      await r.wait(300);
      await r.teardown();
    },
  },

  /** heat_cool: both knobs moved within the delay become one set_temperature with low and high. */
  heat_cool_pair: {
    ids: [DUAL],
    run: async (r) => {
      r.mount('liquid-climate-tile', { entity: DUAL });
      const dial = r.mount('liquid-climate-card', { entity: DUAL });
      r.probe = () => dial._lease.current;
      await r.act('mount tile and dial');
      await r.act('Shift+ArrowRight on the dial (upper knob)', () => key(dialSvg(dial), 'ArrowRight', true));
      await r.wait(500);
      await r.act('ArrowLeft on the lower knob', () => key(dial.shadowRoot!.querySelector('circle[data-knob=low]')!, 'ArrowLeft'));
      await r.wait(2000);
      await r.report(DUAL, { attributes: { target_temp_low: 18.5, target_temp_high: 24.5 } });
      await r.wait(300);
      await r.teardown();
    },
  },

  /** Fan, vertical swing and preset changed within the delay: one call each, in that order. */
  fan_swing_preset: {
    ids: [K],
    run: async (r) => {
      r.mount('liquid-climate-tile', { entity: K });
      const dial = r.mount('liquid-climate-card', { entity: K });
      r.probe = () => dial._lease.current;
      await r.act('mount tile and dial');
      await r.act('PageUp on the dial (fan up)', () => key(dialSvg(dial), 'PageUp'));
      await r.wait(400);
      await r.act('vertical swing chip', () => ($$(dial, 'button.chip')[0] as HTMLButtonElement).click());
      await r.wait(400);
      await r.act('preset chip', () => ($$(dial, 'button.chip')[2] as HTMLButtonElement).click());
      await r.wait(2000);
      await r.report(K, { attributes: { fan_mode: '3', swing_mode: 'swing', preset_mode: 'away' } });
      await r.wait(300);
      await r.teardown();
    },
  },

  /** A mode change on the dial: the tile shows the pending mode until the entity reports it. */
  mode_change: {
    ids: [K],
    run: async (r) => {
      r.mount('liquid-climate-tile', { entity: K });
      const dial = r.mount('liquid-climate-card', { entity: K });
      r.probe = () => dial._lease.current;
      await r.act('mount tile and dial');
      await r.act('mode Cool', () => byLabel(dial, 'button.mode', 'Cool').click());
      await r.wait(2000);
      await r.wait(1000);
      await r.report(K, { state: 'cool', attributes: { hvac_action: 'cooling' } });
      await r.wait(300);
      await r.teardown();
    },
  },

  /** Power off on the tile, then on again: back to the mode the entity was seen in. */
  power_remembered: {
    ids: [S],
    run: async (r) => {
      const tile = r.mount('liquid-climate-tile', { entity: S });
      r.probe = () => tile._lease.current;
      await r.act('mount tile (entity in cool)');
      await r.act('power', () => tilePower(tile));
      await r.wait(2000);
      await r.report(S, { state: 'off' });
      await r.wait(300);
      await r.act('power', () => tilePower(tile));
      await r.wait(2000);
      await r.report(S, { state: 'cool' });
      await r.wait(300);
      await r.teardown();
    },
  },

  /** Power on with no remembered mode: POWER_ON_ORDER picks heat, not the first listed mode (fan_only). */
  power_no_memory: {
    ids: [N],
    run: async (r) => {
      const tile = r.mount('liquid-climate-tile', { entity: N });
      r.probe = () => tile._lease.current;
      await r.act('mount tile (entity off, nothing remembered)');
      await r.act('power', () => tilePower(tile));
      await r.wait(2000);
      await r.report(N, { state: 'heat' });
      await r.wait(300);
      await r.teardown();
    },
  },

  /** Water heater: power on is turn_on then the operation mode; its own answer ends the hold; then a new mode. */
  water_heater: {
    ids: [WH],
    fixture: (f) => {
      f.states[WH].state = 'off';
    },
    run: async (r) => {
      const tile = r.mount('liquid-climate-tile', { entity: WH });
      const dial = r.mount('liquid-climate-card', { entity: WH });
      r.probe = () => dial._lease.current;
      await r.act('mount tile and dial (water heater off)');
      await r.act('tile power', () => tilePower(tile));
      await r.wait(2000);
      // It answers turn_on with an operation of its own: any new state ends the held mode.
      await r.report(WH, { state: 'electric', attributes: { operation_mode: 'electric' } });
      await r.wait(300);
      await r.act('mode Performance', () => byLabel(dial, 'button.mode', 'Performance').click());
      await r.wait(2000);
      await r.report(WH, { state: 'performance', attributes: { operation_mode: 'performance' } });
      await r.wait(300);
      await r.teardown();
    },
  },

  /** Humidifier off: picking a mode turns it on with that mode; then the target humidity from the tile. */
  humidifier: {
    ids: [HYG],
    fixture: (f) => {
      f.states[HYG].state = 'off';
    },
    run: async (r) => {
      const tile = r.mount('liquid-climate-tile', { entity: HYG });
      const dial = r.mount('liquid-climate-card', { entity: HYG });
      r.probe = () => dial._lease.current;
      await r.act('mount tile and dial (hygrostat off)');
      await r.act('mode Eco', () => byLabel(dial, 'button.mode', 'Eco').click());
      await r.wait(2000);
      await r.report(HYG, { state: 'on', attributes: { mode: 'eco' } });
      await r.wait(300);
      await r.act('tile step up', () => tileStep(tile, 'up'));
      await r.wait(2000);
      await r.report(HYG, { attributes: { humidity: 51 } });
      await r.wait(300);
      await r.teardown();
    },
  },

  /** write_delay 0: the tile's step goes out at once. */
  write_delay_zero: {
    ids: [K],
    run: async (r) => {
      const tile = r.mount('liquid-climate-tile', { entity: K, write_delay: 0 });
      r.probe = () => tile._lease.current;
      await r.act('mount tile (write_delay 0)');
      await r.act('step up', () => tileStep(tile, 'up'));
      await r.wait(500);
      await r.report(K, { attributes: { temperature: 20 } });
      await r.wait(300);
      await r.teardown();
    },
  },

  /** write_hold 3: with no answer the sent value shows for 3 s after the send, then the entity's own again. */
  hold_expiry: {
    ids: [K],
    run: async (r) => {
      const tile = r.mount('liquid-climate-tile', { entity: K, write_hold: 3 });
      r.probe = () => tile._lease.current;
      await r.act('mount tile (write_hold 3)');
      await r.act('step up', () => tileStep(tile, 'up'));
      await r.wait(5000);
      await r.teardown();
    },
  },

  /** setConfig to another entity while a change is pending: it goes out to the old entity at once. */
  entity_switch: {
    ids: [K, S],
    run: async (r) => {
      const tile = r.mount('liquid-climate-tile', { entity: K });
      r.probe = () => tile._lease.current;
      await r.act('mount tile');
      await r.act('step up', () => tileStep(tile, 'up'));
      await r.wait(500);
      await r.act(`setConfig entity ${S}`, () => tile.setConfig({ type: 'custom:liquid-climate-tile', entity: S }));
      await r.wait(2000);
      await r.teardown();
    },
  },

  /** A failed call: its message replaces the status line, and goes after 6 s. */
  error_and_clear: {
    ids: [K],
    replies: { 0: { fail: 'message' } },
    run: async (r) => {
      const tile = r.mount('liquid-climate-tile', { entity: K });
      r.probe = () => tile._lease.current;
      await r.act('mount tile');
      await r.act('step up', () => tileStep(tile, 'up'));
      await r.wait(8000);
      await r.teardown();
    },
  },

  // ---- Cluster: the fourth writer client -------------------------------------

  /** A strip step goes through _writeVia with the cluster's delay (2.5 s) and hold (4 s). */
  cluster_write_via: {
    ids: [K, S],
    run: async (r) => {
      const c = r.mount('liquid-climate-cluster', { entities: [K, S], write_delay: 2.5, write_hold: 4 });
      r.probe = () => c._leases.get(K)?.current;
      await r.act('mount cluster (write_delay 2.5, write_hold 4)');
      await r.act('strip step up', () => stripStep(c, 'up'));
      await r.wait(7000);
      await r.teardown();
    },
  },

  /** Humidifier off in the cluster: a mode button sends { hvac_mode: 'on', mode }. */
  cluster_humidifier: {
    ids: [HYG],
    fixture: (f) => {
      f.states[HYG].state = 'off';
    },
    run: async (r) => {
      const c = r.mount('liquid-climate-cluster', { entities: [HYG] });
      r.probe = () => c._leases.get(HYG)?.current;
      await r.act('mount cluster (hygrostat off)');
      await r.act('strip mode Eco', () => byLabel(c, '.strip button.mode', 'Eco').click());
      await r.wait(2000);
      await r.report(HYG, { state: 'on', attributes: { mode: 'eco' } });
      await r.wait(300);
      await r.teardown();
    },
  },

  /** A room leaves the cluster with a change pending: its lease is released and the change goes out at once. */
  cluster_lease_release: {
    ids: [K, S],
    run: async (r) => {
      const c = r.mount('liquid-climate-cluster', { entities: [K, S] });
      r.probe = () => c._leases.get(K)?.current;
      await r.act('mount cluster');
      await r.act('strip step up', () => stripStep(c, 'up'));
      await r.wait(500);
      await r.act(`setConfig without ${K}`, () => c.setConfig({ type: 'custom:liquid-climate-cluster', entities: [S] }));
      await r.wait(2000);
      await r.teardown();
    },
  },

  /** Failing calls in the cluster: the alert is empty while a call is in flight and speaks when it fails, each time. */
  cluster_announce_failing: {
    ids: [K],
    replies: { 0: { ms: 1000, fail: 'plain' }, 1: { ms: 1000, fail: 'message' } },
    run: async (r) => {
      const c = r.mount('liquid-climate-cluster', { entities: [K] });
      r.probe = () => c._leases.get(K)?.current;
      await r.act('mount cluster');
      await r.act('strip step up', () => stripStep(c, 'up'));
      await r.wait(3000);
      await r.act('strip step up', () => stripStep(c, 'up'));
      await r.wait(9000);
      await r.teardown();
    },
  },

  // ---- D-2: where a plain liquid-core writer behaves differently ----------------

  /** D-2 (1): cool, then back to heat before any echo; a report still in heat ends the held mode at once. */
  d2_return_to_start: {
    ids: [K],
    run: async (r) => {
      const tile = r.mount('liquid-climate-tile', { entity: K });
      r.probe = () => tile._lease.current;
      await r.act('mount tile (entity in heat)');
      await r.act('open sheet', () => openTileSheet(tile));
      const dial = sheetDial(tile);
      await r.act('mode Cool', () => byLabel(dial, 'button.mode', 'Cool').click());
      await r.wait(2000);
      await r.act('mode Heat', () => byLabel(dial, 'button.mode', 'Heat').click());
      await r.wait(2000);
      await r.report(K, { attributes: { current_temperature: 22 } });
      await r.wait(10000);
      await r.teardown();
    },
  },

  /** D-2 (2): a sent setpoint is held, then a fan call fails: every held value goes, the setpoint too. */
  d2_failure_drops_all: {
    ids: [K],
    replies: { 1: { fail: 'message' } },
    run: async (r) => {
      r.mount('liquid-climate-tile', { entity: K });
      const dial = r.mount('liquid-climate-card', { entity: K });
      r.probe = () => dial._lease.current;
      await r.act('mount tile and dial');
      await r.act('ArrowUp on the dial', () => key(dialSvg(dial), 'ArrowUp'));
      await r.wait(2000);
      await r.act('PageUp on the dial (fan up)', () => key(dialSvg(dial), 'PageUp'));
      await r.wait(8000);
      await r.teardown();
    },
  },

  /** D-2 (3): two debounced sends overlap; `sending` is false as soon as the first settles. */
  d2_overlapping_sends: {
    ids: [K],
    replies: { 0: { ms: 2500 }, 1: { ms: 2500 } },
    run: async (r) => {
      const tile = r.mount('liquid-climate-tile', { entity: K });
      r.probe = () => tile._lease.current;
      await r.act('mount tile');
      await r.act('step up', () => tileStep(tile, 'up'));
      await r.wait(2000);
      await r.act('step up', () => tileStep(tile, 'up'));
      await r.wait(6000);
      await r.teardown();
    },
  },

  /**
   * D-2 (4): a standalone dial and a separate tile on one entity. The dial holds for a drag, the tile leaves, the drag
   * goes on for more than 1.5 s, then pointerup. 0.12.0 sends mid-drag: the tile's release flushed and ended the hold.
   */
  d2_standalone_dial_and_tile: {
    ids: [K],
    run: async (r) => {
      const tile = r.mount('liquid-climate-tile', { entity: K });
      const dial = r.mount('liquid-climate-card', { entity: K });
      r.probe = () => dial._lease.current;
      await r.act('mount tile and dial');
      await r.act('pointerdown 21 on the dial', () => pointer(dial, 'pointerdown', 21));
      await r.wait(300);
      await r.act('remove the tile', () => tile.remove());
      await r.wait(300);
      await r.act('pointermove 22', () => pointer(dial, 'pointermove', 22));
      await r.wait(300);
      await r.act('pointermove 23', () => pointer(dial, 'pointermove', 23));
      await r.wait(2000);
      await r.act('pointerup', () => pointer(dial, 'pointerup'));
      await r.wait(2000);
      await r.teardown();
    },
  },
};

/** The D-2 scenarios, in plan order (1 to 4). */
export const D2 = ['d2_return_to_start', 'd2_failure_drops_all', 'd2_overlapping_sends', 'd2_standalone_dial_and_tile'];

/** Run one scenario from a clean page and return its trace, as JSON would carry it. */
export async function runScenario(name: string): Promise<Entry[]> {
  const s = SCENARIOS[name];
  document.body.innerHTML = '';
  forgetModes();
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const f = base();
  s.fixture?.(f);
  const rig = new Rig(f, s.replies);
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => rig.log(args));
  try {
    await s.run(rig);
  } finally {
    rig.end();
    spy.mockRestore();
    document.body.innerHTML = '';
    vi.clearAllTimers();
    vi.useRealTimers();
  }
  for (const id of s.ids) if (writerRefs(id) !== 0) throw new Error(`write trace: ${id} still has a writer after ${name}`);
  return JSON.parse(JSON.stringify(rig.trace)) as Entry[];
}

/** The first entry where two traces part, per channel (calls, logs, states), or null when that channel is equal. */
export function divergence(actual: Entry[], expected: Entry[]) {
  const channel = (k: 'call' | 'log' | 'state') => {
    const a = actual.filter((e) => k in e);
    const x = expected.filter((e) => k in e);
    for (let i = 0; i < Math.max(a.length, x.length); i++) {
      if (JSON.stringify(sorted(a[i])) !== JSON.stringify(sorted(x[i]))) return { index: i, expected: x[i] ?? null, actual: a[i] ?? null };
    }
    return null;
  };
  return { calls: channel('call'), logs: channel('log'), states: channel('state') };
}
