import type { Optimistic } from './capabilities';
import { modeInfo } from '../../ui/modes';
import type { HassEntity } from '../../types';

export interface ServiceCall {
  service: string;
  data: Record<string, unknown>;
}

/**
 * Turn a set of pending changes into the minimum list of climate service calls.
 *
 * - Values equal to what the unit already has, or will have once in-flight writes land, are dropped.
 * - One call per service, whatever number of interactions led to it.
 * - hvac mode goes first so a setpoint lands on the new mode.
 * - Setpoint changes are dropped when the final mode has no setpoint.
 */
export function buildCalls(
  entityId: string,
  change: Optimistic,
  stateObj: HassEntity,
  inflight: Optimistic = {},
): ServiceCall[] {
  // What the unit will report once earlier writes land: in-flight values over the entity.
  const a: Record<string, any> = { ...stateObj.attributes };
  for (const [k, v] of Object.entries(inflight)) if (k !== 'hvac_mode' && v !== undefined) a[k] = v;
  const currentMode = inflight.hvac_mode ?? stateObj.state;
  const calls: ServiceCall[] = [];
  const base = { entity_id: entityId };

  const finalMode = change.hvac_mode ?? currentMode;
  const modeChanged = change.hvac_mode !== undefined && change.hvac_mode !== currentMode;
  if (modeChanged) calls.push({ service: 'set_hvac_mode', data: { ...base, hvac_mode: change.hvac_mode } });

  if (modeInfo(finalMode).setpoint) {
    const t: Record<string, unknown> = {};
    if (change.temperature !== undefined && change.temperature !== a.temperature) t.temperature = change.temperature;
    const lowChanged = change.target_temp_low !== undefined && change.target_temp_low !== a.target_temp_low;
    const highChanged = change.target_temp_high !== undefined && change.target_temp_high !== a.target_temp_high;
    if (lowChanged || highChanged) {
      // The service wants both ends of a range together.
      t.target_temp_low = change.target_temp_low ?? a.target_temp_low;
      t.target_temp_high = change.target_temp_high ?? a.target_temp_high;
    }
    if (Object.keys(t).length) calls.push({ service: 'set_temperature', data: { ...base, ...t } });
  }

  const simple: [keyof Optimistic, string, string][] = [
    ['fan_mode', 'fan_mode', 'set_fan_mode'],
    ['swing_mode', 'swing_mode', 'set_swing_mode'],
    ['swing_horizontal_mode', 'swing_horizontal_mode', 'set_swing_horizontal_mode'],
    ['preset_mode', 'preset_mode', 'set_preset_mode'],
  ];
  for (const [key, attr, service] of simple) {
    const v = change[key];
    if (v !== undefined && v !== a[attr]) calls.push({ service, data: { ...base, [key]: v } });
  }
  return calls;
}

export interface QueueOptions {
  send: (calls: ServiceCall[]) => Promise<void> | void;
  getDelayMs: () => number;
  getEntity: () => HassEntity | undefined;
  entityId: () => string;
  /** Optimistic values already sent but not yet reflected by the entity. */
  getBaseline?: () => Optimistic;
  onChange?: () => void;
  timers?: Timers;
}

type Timers = {
  set: (fn: () => void, ms: number) => unknown;
  clear: (h: unknown) => void;
};

/**
 * Debounced writer. Every interaction merges into one pending change and
 * restarts the timer; when it fires, `flush` sends the coalesced calls.
 */
export class WriteQueue {
  private change: Optimistic = {};
  private handle: unknown = null;
  /** Bumped on every interaction so the UI can restart its progress line. */
  generation = 0;
  private held = false;
  /** Called with the coalesced change right before it is sent. */
  onFlushed?: (change: Optimistic) => void;

  private readonly o: QueueOptions;

  constructor(o: QueueOptions) {
    this.o = {
      onChange: () => {},
      getBaseline: () => ({}),
      timers: {
        set: (fn, ms) => setTimeout(fn, ms),
        clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      },
      ...o,
    };
  }

  get pending(): Optimistic {
    return this.change;
  }

  get isPending(): boolean {
    return Object.keys(this.change).length > 0;
  }

  set(patch: Optimistic): void {
    this.change = { ...this.change, ...patch };
    this.generation++;
    this.arm();
    this.o.onChange!();
  }

  /** Pause the timer while a drag is in progress; nothing is sent until release. */
  hold(): void {
    this.held = true;
    if (this.handle != null) this.o.timers!.clear(this.handle);
    this.handle = null;
  }

  release(): void {
    this.held = false;
    if (this.isPending) this.arm();
  }

  private arm(): void {
    if (this.handle != null) this.o.timers!.clear(this.handle);
    this.handle = null;
    if (this.held) return;
    const delay = this.o.getDelayMs();
    if (delay <= 0) void this.flush();
    else this.handle = this.o.timers!.set(() => void this.flush(), delay);
  }

  async flush(): Promise<Optimistic> {
    if (this.handle != null) this.o.timers!.clear(this.handle);
    this.handle = null;
    const change = this.change;
    this.change = {};
    const entity = this.o.getEntity();
    try {
      if (entity && Object.keys(change).length) {
        // Built against the baseline as it is now, before this change joins it.
        const calls = buildCalls(this.o.entityId(), change, entity, this.o.getBaseline!());
        if (calls.length) {
          const sent: Record<string, unknown> = {};
          for (const c of calls) {
            const { entity_id: _id, ...rest } = c.data;
            Object.assign(sent, rest);
          }
          this.onFlushed?.(sent as Optimistic);
          await this.o.send(calls);
        }
      }
    } finally {
      this.o.onChange!();
    }
    return change;
  }

  cancel(): void {
    if (this.handle != null) this.o.timers!.clear(this.handle);
    this.handle = null;
    this.held = false;
    this.change = {};
  }
}
