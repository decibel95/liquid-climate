import type { Optimistic } from '../dial/capabilities';
import { WriteQueue, type ServiceCall } from '../dial/write-queue';
import { t } from '../../i18n';
import type { HassEntity, HomeAssistant } from '../../types';

const INFLIGHT_MS = 10_000;
const ERROR_MS = 6000;

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
 * Debounced, optimistic climate writes for one entity: the write queue, the values already
 * sent but not yet reported back, and the last error. There is one writer per entity id,
 * shared by every card showing that entity (see acquireWriter), so a tile and the dial in
 * its sheet coalesce into one queue and agree on what is pending.
 */
export class ClimateWriter {
  readonly queue: WriteQueue;
  /** Latest hass, set by the cards using this writer. */
  hass?: HomeAssistant;
  /** Seconds to wait after the last interaction; the card that interacts sets it. */
  delay = 1.5;
  /** Values sent but not yet reflected by the entity. */
  inflight: Optimistic = {};
  sending = false;
  error: string | null = null;
  private inflightTimer?: ReturnType<typeof setTimeout>;
  private errorTimer?: ReturnType<typeof setTimeout>;
  private listeners = new Set<() => void>();

  constructor(readonly entityId: string) {
    this.queue = new WriteQueue({
      send: (calls) => this.send(calls),
      getDelayMs: () => this.delay * 1000,
      getEntity: () => this.entity(),
      entityId: () => this.entityId,
      getBaseline: () => this.inflight,
      onChange: () => this.changed(),
    });
    this.queue.onFlushed = (change) => {
      this.inflight = { ...this.inflight, ...change };
      clearTimeout(this.inflightTimer);
      this.inflightTimer = setTimeout(() => {
        this.inflight = {};
        this.changed();
      }, INFLIGHT_MS);
    };
  }

  /** Register a card's re-render callback; returns the unsubscribe function. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of [...this.listeners]) fn();
  }

  entity(): HassEntity | undefined {
    return this.hass?.states[this.entityId];
  }

  /** Optimistic values to show: in-flight writes, then pending ones on top. */
  get local(): Optimistic {
    return { ...this.inflight, ...this.queue.pending };
  }

  /** A mode change is pending or in flight, so the entity's own action is stale. */
  get modeChanging(): boolean {
    return this.local.hvac_mode !== undefined;
  }

  set(patch: Optimistic): void {
    this.queue.set(patch);
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
    const target = powerOnMode(this.entity()?.attributes.hvac_modes, rememberedMode(this.entityId));
    if (target) this.setMode(target);
  }

  /** Call when hass changes: remembers the entity's mode and drops values it has caught up with. */
  observe(hass: HomeAssistant): void {
    this.hass = hass;
    const s = this.entity();
    if (!s) return;
    rememberMode(this.entityId, s.state);
    if (!Object.keys(this.inflight).length) return;
    const next = { ...this.inflight } as Record<string, unknown>;
    for (const key of Object.keys(next)) {
      const actual = key === 'hvac_mode' ? s.state : s.attributes[key];
      if (actual === next[key]) delete next[key];
    }
    this.inflight = next as Optimistic;
  }

  /** Send what is pending now, ending any drag hold. */
  flushNow(): void {
    this.queue.release();
    if (this.queue.isPending) void this.queue.flush();
  }

  /** Last user gone: send what is pending, drop optimistic state and stop every timer. */
  dispose(): void {
    this.flushNow();
    clearTimeout(this.inflightTimer);
    clearTimeout(this.errorTimer);
    this.inflight = {};
    this.listeners.clear();
  }

  private async send(calls: ServiceCall[]): Promise<void> {
    const hass = this.hass;
    if (!hass) return;
    this.sending = true;
    this.changed();
    try {
      for (const c of calls) await hass.callService('climate', c.service, c.data);
    } catch (err) {
      console.error('Liquid Climate: service call failed', err);
      this.inflight = {};
      this.error = err instanceof Error && err.message ? err.message : t(hass, 'common.commandFailed');
      clearTimeout(this.errorTimer);
      this.errorTimer = setTimeout(() => {
        this.error = null;
        this.changed();
      }, ERROR_MS);
    } finally {
      this.sending = false;
      this.changed();
    }
  }
}

const writers = new Map<string, { writer: ClimateWriter; refs: number }>();

/** The shared writer for an entity. Every acquire needs a matching releaseWriter. */
export function acquireWriter(entityId: string): ClimateWriter {
  let e = writers.get(entityId);
  if (!e) {
    e = { writer: new ClimateWriter(entityId), refs: 0 };
    writers.set(entityId, e);
  }
  e.refs++;
  return e.writer;
}

/**
 * A card stops using a writer. Whatever is pending is sent now, so a change is never lost
 * when its card goes away; the last release disposes the writer.
 */
export function releaseWriter(writer: ClimateWriter): void {
  const e = writers.get(writer.entityId);
  if (!e || e.writer !== writer) {
    writer.dispose();
    return;
  }
  e.refs--;
  if (e.refs > 0) {
    writer.flushNow();
    return;
  }
  writers.delete(writer.entityId);
  writer.dispose();
}

/** Number of cards holding the writer of an entity, for tests. */
export function writerRefs(entityId: string): number {
  return writers.get(entityId)?.refs ?? 0;
}

/**
 * Holds one card's reference to the shared writer of its entity. Acquires lazily, releases
 * on disconnect, and switches cleanly when the card's entity changes.
 */
export class WriterLease {
  private writer?: ClimateWriter;
  private off?: () => void;

  constructor(private readonly onChange: () => void) {}

  /** The writer for `entityId`, acquiring it (and releasing a previous one) when needed. */
  get(entityId: string): ClimateWriter {
    if (this.writer?.entityId !== entityId) {
      this.release();
      this.writer = acquireWriter(entityId);
      this.off = this.writer.subscribe(this.onChange);
    }
    return this.writer;
  }

  get current(): ClimateWriter | undefined {
    return this.writer;
  }

  release(): void {
    if (!this.writer) return;
    this.off?.();
    const w = this.writer;
    this.writer = undefined;
    releaseWriter(w);
  }
}
