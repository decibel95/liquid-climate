import { EntityWriter, WriterLease as CoreWriterLease, WriterRegistry, debounceWrites } from '@decibel95/liquid-core';
import type { Optimistic } from '../dial/capabilities';
import { buildCalls, type ServiceCall } from '../dial/write-queue';
import { t } from '../../i18n';
import { WATER_HEATER_FEATURE, domainOf, operationList, supports } from '../../domain';
import type { HassEntity, HomeAssistant } from '../../types';

/** Order the power button tries when it has no remembered mode to return to. */
export const POWER_ON_ORDER = ['heat', 'cool', 'heat_cool', 'auto', 'fan_only', 'dry'];

const NOT_A_MODE = ['off', 'unavailable', 'unknown'];

/**
 * Last non-off mode per entity, for this browser session. Shared by every card, so a tile
 * and the dial in its sheet agree on where the power button goes back to.
 */
const lastModes = new Map<string, string>();

export function rememberMode(entityId: string, mode: string): void {
  if (entityId && mode && !NOT_A_MODE.includes(mode)) lastModes.set(entityId, mode);
}

export function rememberedMode(entityId: string): string | undefined {
  return lastModes.get(entityId);
}

/** Test hook: forget every remembered mode. */
export function forgetModes(): void {
  lastModes.clear();
}

/** The mode the power button turns the unit on to, or undefined when it has none. */
export function powerOnMode(hvacModes: unknown, last?: string | null): string | undefined {
  const hvac = Array.isArray(hvacModes) ? hvacModes.map(String) : [];
  if (last && hvac.includes(last) && last !== 'off') return last;
  return POWER_ON_ORDER.find((m) => hvac.includes(m)) ?? hvac.find((m) => m !== 'off');
}

/**
 * The state the power button turns any supported entity on to: a climate hvac mode, a water
 * heater's operation mode (the last one used, else the first that is not off; `on` when it only
 * has turn_on), or `on` for a humidifier. Undefined when it cannot be turned on.
 */
export function powerOnModeOf(stateObj: HassEntity | undefined, last?: string | null): string | undefined {
  if (!stateObj) return undefined;
  const domain = domainOf(stateObj.entity_id);
  if (domain === 'humidifier') return 'on';
  if (domain === 'water_heater') {
    const ops = operationList(stateObj).filter((m) => m !== 'off');
    if (last && ops.includes(last)) return last;
    return ops[0] ?? (supports(stateObj, WATER_HEATER_FEATURE.ON_OFF) ? 'on' : undefined);
  }
  return powerOnMode(stateObj.attributes.hvac_modes, last);
}

/**
 * Debounced, optimistic climate writes for one entity: the write queue, the values already
 * sent but not yet reported back, and the last error. There is one writer per entity id,
 * shared by every card showing that entity (see acquireWriter), so a tile and the dial in
 * its sheet coalesce into one queue and agree on what is pending.
 *
 * Built on liquid-core's EntityWriter, with overrides that keep Liquid Climate's own
 * behaviour: a reported value equal to the held one drops it (also an older echo), a failed
 * call drops every held value, `sending` is false once any send settles, a call without a
 * domain goes to climate, and a card leaving sends what is pending and ends every drag hold.
 */
export class ClimateWriter extends EntityWriter<Optimistic, ServiceCall> {
  private _sending = false;

  constructor(entityId: string) {
    super(entityId, {
      build: (change, entity, baseline) =>
        buildCalls(entityId, change, entity, baseline).map((c) => (c.domain ? c : { ...c, domain: 'climate' })),
      schedule: debounceWrites(1500),
      hold: 10,
      stateOf: (s, key) => (key === 'hvac_mode' ? s.state : s.attributes[key]),
      // A water heater answers turn_on and turn_off with its current operation, which need not be the
      // mode shown while sending ("on", or "off" when it reports standby): any new state is the answer.
      answered: (s, key, from) => domainOf(entityId) === 'water_heater' && key === 'hvac_mode' && s.state !== from,
      t,
      errorKey: 'common.commandFailed',
      logLabel: 'Liquid Climate',
    });
  }

  /** Seconds to wait after the last interaction; the card that interacts sets it. */
  get delay(): number {
    return this.schedule.ms / 1000;
  }

  set delay(seconds: number) {
    this.schedule = debounceWrites(seconds * 1000);
  }

  /** A send is in progress; false as soon as any send settles. */
  override get sending(): boolean {
    return this._sending;
  }

  protected override sendStarted(): void {
    super.sendStarted();
    this._sending = true;
  }

  protected override sendSettled(): void {
    super.sendSettled();
    this._sending = false;
  }

  /** A mode change is pending or in flight, so the entity's own action is stale. */
  get modeChanging(): boolean {
    return this.local.hvac_mode !== undefined;
  }

  setMode(mode: string): void {
    rememberMode(this.entityId, mode);
    this.queue.set({ hvac_mode: mode });
  }

  /** Off when on; otherwise back to the last non-off mode of this entity. */
  togglePower(currentMode: string): void {
    if (currentMode !== 'off') {
      this.setMode('off');
      return;
    }
    const target = powerOnModeOf(this.entity(), rememberedMode(this.entityId));
    if (target) this.setMode(target);
  }

  /** Call when hass changes: remembers the entity's mode and drops values it has caught up with. */
  override observe(hass: HomeAssistant): void {
    const s = hass.states[this.entityId];
    if (s) rememberMode(this.entityId, s.state);
    super.observe(hass);
  }

  /** Drops each held value the entity reports exactly, or a water heater's mode it answered in its own way. */
  protected override reconcile(s: HassEntity): void {
    const next = { ...this.inflight } as Record<string, unknown>;
    for (const key of Object.keys(next)) {
      const from = this.sent.get(key)?.from;
      if (this.stateOf(s, key) === next[key] || (from !== undefined && !!this.opts.answered?.(s, key, from))) {
        delete next[key];
        this.sent.delete(key);
      }
    }
    // Assigned directly: the inflight setter would also forget the records of the keys still held.
    this._inflight = next as Optimistic;
  }

  /** A call failed: drop every held value. The hold timer keeps running and clears nothing more when it fires. */
  protected override rollback(): void {
    this.inflight = {};
  }

  /** Another card still uses this writer: send what is pending now, ending every drag hold. */
  override sendPending(): void {
    this.flushNow();
  }

  /** Send what is pending now, ending any drag hold. */
  override flushNow(): void {
    super.flushNow();
  }
}

const writers = new WriterRegistry((entityId) => new ClimateWriter(entityId));

/** The shared writer for an entity. Every acquire needs a matching releaseWriter. */
export function acquireWriter(entityId: string): ClimateWriter {
  return writers.acquire(entityId);
}

/**
 * A card stops using a writer. Whatever is pending is sent now, so a change is never lost
 * when its card goes away; the last release disposes the writer.
 */
export function releaseWriter(writer: ClimateWriter): void {
  writers.release(writer);
}

/** Number of cards holding the writer of an entity, for tests. */
export function writerRefs(entityId: string): number {
  return writers.refs(entityId);
}

/**
 * Holds one card's reference to the shared writer of its entity. Acquires lazily, releases
 * on disconnect, and switches cleanly when the card's entity changes.
 */
export class WriterLease extends CoreWriterLease<ClimateWriter> {
  constructor(onChange: () => void) {
    super(writers, onChange);
  }
}
