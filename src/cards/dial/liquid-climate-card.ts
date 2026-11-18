import { LitElement, html, nothing, svg, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { keyed } from 'lit/directives/keyed.js';
import { styleMap } from 'lit/directives/style-map.js';
import { normalizeConfig, type LiquidClimateConfig, type StatusItem } from '../../config';
import { migrateConfig } from '../../migrate';
import { resolveSensors } from '../../detect/resolve';
import { Memo } from '../../detect/cache';
import { runtimeDetection, type RuntimeDetection } from '../../detect/runtime';
import type { Detection } from '../../detect/roles';
import { statusTitle, statusValue, type StatusValue } from '../../ui/status';
import { handleMenuKey, menuVisible, panelId, renderMenuPanel } from '../../ui/menu';
import { resolveGlass } from '../../ui/glass';
import { num, numAuto, t } from '../../i18n';
import { ENTITY_ERROR, domainOf, isSupportedEntity } from '../../domain';
import type { HomeAssistant } from '../../types';
import { WriterLease, type ClimateWriter } from '../shared/writer';
import { hassNeedsRender } from '../shared/render-gate';
import { batteryText, isResting, readsAsActivity, statusWord } from '../shared/status';
import { RowCalls } from '../shared/service';
import {
  CX,
  CY,
  R_FAN,
  R_TEMP,
  arcPath,
  buildTicks,
  clamp,
  fanIndexFromFraction,
  fanSegments,
  fractionToAngle,
  litFanSegments,
  pointToFraction,
  pt,
  tickInterval,
  valueToFraction,
  zoneForDistance,
} from '../../ui/geometry';
import {
  ICONS,
  climateTwin,
  domainModeLabel,
  entityModeInfo,
  fanIntensity,
  fanShortLabels,
  optionLabel,
  particleDuration,
  rgba,
  spinSeconds,
  spinStyle,
} from '../../ui/modes';
import { buildView, getCapabilities, setpointPatch, snapFor, type Capabilities, type DialView, type Optimistic } from './capabilities';
import { dialStyles } from './styles';

const PARTICLES = Array.from({ length: 14 }, (_, i) => ({
  left: 6 + ((i * 37) % 86),
  delay: ((i * 0.61) % 4).toFixed(2),
  base: 3.4 + ((i * 0.71) % 2.6),
  size: 3 + (i % 3) * 1.5,
}));

const INACTIVE = ['stop', 'off', 'none', 'fixed'];

type Zone = 'fan' | 'temp';
type Knob = 'low' | 'high';

interface Ctx {
  stateObj: NonNullable<ReturnType<LiquidClimateCard['_entity']>>;
  caps: Capabilities;
  view: DialView;
}

@customElement('liquid-climate-card')
export class LiquidClimateCard extends LitElement {
  static override styles = dialStyles;

  @property({ attribute: false }) hass!: HomeAssistant;
  @state() private _config?: LiquidClimateConfig;
  @state() private _tick = 0;

  /** Shared with every other card on the same entity, so pending values never diverge. */
  private _lease = new WriterLease(() => this._bump());
  private _drag: Zone | null = null;
  private _knob: Knob = 'low';
  private _detection = new Memo<RuntimeDetection>();
  private _watched: string[] = [];
  private _timerTick?: ReturnType<typeof setTimeout>;
  /** Family entities whose state has not arrived yet; their first state must trigger a render. */
  private _awaiting: string[] = [];
  private _observer?: IntersectionObserver;
  /** Index of the status row whose menu is open, if any. Only one is open at a time. */
  @state() private _openRow: number | null = null;
  private _calls = new RowCalls(() => this._bump());

  /** The shared writer of this card's entity, with this card's write delay. */
  private get _writer(): ClimateWriter {
    const w = this._lease.get(this._config?.entity ?? '');
    w.delay = this._config?.write_delay ?? 1.5;
    w.hold = this._config?.write_hold ?? 10;
    if (this.hass && !w.hass) w.hass = this.hass;
    return w;
  }

  private get _queue() {
    return this._writer.queue;
  }

  /** Values sent but not yet reported back. Not private: tests reach in here. */
  get _inflight(): Optimistic {
    return this._writer.inflight;
  }

  set _inflight(v: Optimistic) {
    this._writer.inflight = v;
  }

  // ---- Lovelace API ----------------------------------------------------

  setConfig(raw: Record<string, unknown>): void {
    if (!raw || !isSupportedEntity(raw.entity)) throw new Error(ENTITY_ERROR);
    const next = normalizeConfig(migrateConfig(raw));
    if (this._config && this._config.entity !== next.entity) {
      // Pending writes belong to the old entity: releasing its writer sends them.
      this._drag = null;
      this._lease.release();
    }
    this._config = next;
    this._closeRow();
    this._detection.clear();
    this._watched = [];
    this._awaiting = [];
  }

  getGridOptions() {
    return { columns: 12, rows: 'auto', min_columns: 6 };
  }

  getCardSize(): number {
    return 9;
  }

  static async getConfigElement(): Promise<HTMLElement> {
    return document.createElement('liquid-climate-card-editor');
  }

  static getStubConfig(hass: HomeAssistant): Record<string, unknown> {
    const entity = Object.keys(hass.states).find((id) => id.startsWith('climate.')) ?? 'climate.example';
    return { type: 'custom:liquid-climate-card', entity, config_version: 1 };
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (typeof IntersectionObserver !== 'undefined') {
      this._observer = new IntersectionObserver((entries) => {
        const visible = entries[entries.length - 1]?.isIntersecting ?? true;
        this.toggleAttribute('data-paused', !visible);
      });
      this._observer.observe(this);
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._glowHide();
    this._observer?.disconnect();
    this._observer = undefined;
    this._closeRow();
    // Do not lose a change the user already made: send it now.
    this._drag = null;
    this._lease.release();
    clearTimeout(this._timerTick);
  }

  protected override shouldUpdate(changed: PropertyValues): boolean {
    if (changed.has('hass') && this._config && this.hass) this._writer.observe(this.hass);
    if (!changed.has('hass') || changed.size > 1 || !this._config) return true;
    const ids = this._watched.length ? this._watched : [this._config.entity];
    return hassNeedsRender(changed.get('hass') as HomeAssistant | undefined, this.hass, ids, this._awaiting);
  }

  // ---- State helpers ---------------------------------------------------

  _entity() {
    return this._config ? this.hass?.states[this._config.entity] : undefined;
  }

  private _bump() {
    this._tick++;
  }

  protected override willUpdate(): void {
    // The open row can vanish (the card went unavailable or the rows changed): close it, and
    // do not leave focus on a node that is gone.
    if (this._openRow === null) return;
    const row = this._config?.status_entities[this._openRow];
    const st = this._entity();
    if (!row || !menuVisible(this.hass, row) || !st || st.state === 'unavailable') {
      // The row may stop being a menu row (or vanish) with focus inside it: remember where to put focus back after the render.
      const wrap = this._openWrap();
      const active = this.shadowRoot?.activeElement;
      if (wrap && active && wrap.contains(active)) this._refocus = this._openRow;
      this._closeRow();
    }
  }

  /** Whether the line under the big number is empty. Set in render, read in updated(); not reactive. */
  private _centerEmpty = false;

  /** Config index of the row that held focus when it stopped being a menu row. Not reactive. */
  private _refocus: number | null = null;

  protected override updated(): void {
    const sub = this.shadowRoot?.querySelector('.centersub');
    if (sub) {
      if (this._centerEmpty) sub.setAttribute('aria-hidden', 'true');
      else sub.removeAttribute('aria-hidden');
    }
    if (this._refocus !== null) {
      const at = this.shadowRoot?.querySelector<HTMLElement>(`.status [data-index="${this._refocus}"]`);
      const target = at?.matches('.srow') ? at.querySelector<HTMLElement>('.row') : at;
      (target ?? this.shadowRoot?.querySelector<HTMLElement>('button:not([disabled]), [tabindex="0"]'))?.focus();
      this._refocus = null;
    }
    // A running timer row counts down, so re-render once a second while one is active.
    clearTimeout(this._timerTick);
    const running = this._config?.status_entities.some((s) => {
      const e = this.hass?.states[s.entity];
      return s.entity.startsWith('timer.') && e?.state === 'active';
    });
    if (running) this._timerTick = setTimeout(() => this._bump(), 1000);
  }

  private _context(): Ctx | null {
    const stateObj = this._entity();
    if (!stateObj || !this._config || stateObj.state === 'unavailable') return null;
    // A water heater or humidifier in unknown has no mode to show; climate keeps its older behaviour.
    if (stateObj.state === 'unknown' && domainOf(stateObj.entity_id) !== 'climate') return null;
    const caps = getCapabilities(stateObj, this._config, this.hass);
    const view = buildView(stateObj, caps, this._writer.local);
    return { stateObj, caps, view };
  }

  private _detect(): Detection {
    const r = runtimeDetection(this.hass, this._config!.entity, this._detection);
    this._awaiting = r.awaiting;
    return r.detection;
  }

  // ---- Interaction -----------------------------------------------------

  private _setMode(ctx: Ctx, mode: string) {
    // A humidifier's mode lives next to on and off: picking one while off turns it on too.
    if (ctx.caps.domain === 'humidifier') this._queue.set(ctx.view.mode === 'off' ? { hvac_mode: 'on', mode } : { mode });
    else this._writer.setMode(mode);
  }

  private _togglePower(ctx: Ctx) {
    this._writer.togglePower(ctx.view.mode);
  }

  private _setTemp(ctx: Ctx, v: number, knob: Knob = this._knob) {
    const { caps, view } = ctx;
    if (view.dual) {
      const lo = view.low ?? caps.min;
      const hi = view.high ?? caps.max;
      if (knob === 'low') {
        this._queue.set({ target_temp_low: clamp(Math.min(v, hi - caps.step), caps.min, caps.max), target_temp_high: clamp(hi, caps.min, caps.max) });
      } else {
        this._queue.set({ target_temp_low: clamp(lo, caps.min, caps.max), target_temp_high: clamp(Math.max(v, lo + caps.step), caps.min, caps.max) });
      }
    } else {
      this._queue.set(setpointPatch(caps, v));
    }
  }

  private _stepTemp(ctx: Ctx, dir: 1 | -1, knob: Knob = this._knob) {
    const { caps, view } = ctx;
    if (!view.hasSetpoint) return;
    const cur = view.dual ? (knob === 'low' ? view.low : view.high) : view.target;
    if (cur == null) return;
    this._setTemp(ctx, snapFor(caps, cur + dir * caps.step), knob);
  }

  private _stepFan(ctx: Ctx, dir: 1 | -1) {
    const { fanModes } = ctx.caps;
    if (!fanModes.length) return;
    const i = fanModes.indexOf(ctx.view.fan ?? '');
    const next = clamp((i < 0 ? 0 : i) + dir, 0, fanModes.length - 1);
    this._queue.set({ fan_mode: fanModes[next] });
  }

  private _cycle(key: 'swing_mode' | 'swing_horizontal_mode' | 'preset_mode', list: string[], current: string | null) {
    const i = list.indexOf(current ?? '');
    this._queue.set({ [key]: list[(i + 1) % list.length] });
  }

  private _local(e: PointerEvent): [number, number] {
    const r = (e.currentTarget as Element).getBoundingClientRect();
    const s = 400 / r.width;
    return [(e.clientX - r.left) * s, (e.clientY - r.top) * s];
  }

  private _applyDrag(ctx: Ctx, zone: Zone, x: number, y: number) {
    const f = pointToFraction(x, y);
    if (zone === 'temp') {
      const { caps } = ctx;
      this._setTemp(ctx, snapFor(caps, caps.min + f * (caps.max - caps.min)));
    } else {
      const { fanModes } = ctx.caps;
      const fan = fanModes[fanIndexFromFraction(f, fanModes.length)];
      if (fan !== ctx.view.fan) this._queue.set({ fan_mode: fan });
    }
  }

  private _onDown(e: PointerEvent) {
    const ctx = this._context();
    if (!ctx) return;
    const [x, y] = this._local(e);
    const zone = zoneForDistance(Math.hypot(x - CX, y - CY));
    if (!zone) return;
    if (zone === 'fan' && !ctx.caps.fanModes.length) return;
    if (zone === 'temp' && !ctx.view.hasSetpoint) return;
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events have no active pointer */
    }
    this._drag = zone;
    this._queue.hold();
    if (zone === 'temp' && ctx.view.dual) {
      const { caps, view } = ctx;
      const f = pointToFraction(x, y);
      const fl = valueToFraction(view.low ?? caps.min, caps.min, caps.max);
      const fh = valueToFraction(view.high ?? caps.max, caps.min, caps.max);
      this._knob = Math.abs(f - fl) <= Math.abs(f - fh) ? 'low' : 'high';
    }
    this._applyDrag(ctx, zone, x, y);
  }

  private _onMove(e: PointerEvent) {
    if (!this._drag) return;
    const ctx = this._context();
    if (!ctx) return;
    const [x, y] = this._local(e);
    this._applyDrag(ctx, this._drag, x, y);
  }

  private _onUp() {
    if (!this._drag) return;
    this._drag = null;
    this._queue.release();
  }

  private _onKey(e: KeyboardEvent) {
    const ctx = this._context();
    if (!ctx) return;
    const target = (e.target as Element).getAttribute?.('data-knob') as Knob | null;
    // A focused knob moves itself; on the dial, Shift plus an arrow moves the upper knob.
    const knob: Knob = target ?? (e.shiftKey ? 'high' : 'low');
    let handled = true;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        this._stepTemp(ctx, 1, knob);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        this._stepTemp(ctx, -1, knob);
        break;
      case 'Home':
        if (ctx.view.hasSetpoint) this._setTemp(ctx, ctx.caps.min, knob);
        break;
      case 'End':
        if (ctx.view.hasSetpoint) this._setTemp(ctx, ctx.caps.max, knob);
        break;
      case 'PageUp':
        this._stepFan(ctx, 1);
        break;
      case 'PageDown':
        this._stepFan(ctx, -1);
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      // A knob handles its own keys; the dial handler must not repeat it.
      e.stopPropagation();
    }
  }

  // ---- Pointer-follow light ----------------------------------------------
  // Written straight to the DOM: a mouse move must never cause a Lit render.

  private _glowRaf?: number;
  private _glowPos: [number, number] = [50, 50];

  private _glowAllowed(e: PointerEvent): boolean {
    if (e.pointerType !== 'mouse' || this._config?.look.motion === 'minimal') return false;
    return !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  private _glowEl(): HTMLElement | null {
    return this.shadowRoot?.querySelector<HTMLElement>('.glow') ?? null;
  }

  private _glowPlace(e: PointerEvent) {
    const r = this.getBoundingClientRect();
    const w = r.width || 1;
    const h = r.height || 1;
    this._glowPos = [Math.round(((e.clientX - r.left) / w) * 100), Math.round(((e.clientY - r.top) / h) * 100)];
  }

  private _glowWrite = () => {
    this._glowRaf = undefined;
    const el = this._glowEl();
    el?.style.setProperty('--mx', `${this._glowPos[0]}%`);
    el?.style.setProperty('--my', `${this._glowPos[1]}%`);
  };

  private _glowEnter = (e: PointerEvent) => {
    if (!this._glowAllowed(e)) return;
    this._hovering = true;
    // Jump to the new position while still invisible, then fade in.
    this._glowPlace(e);
    this._glowWrite();
    this._glowEl()?.classList.add('on');
  };

  private _glowMove = (e: PointerEvent) => {
    if (!this._glowAllowed(e)) return;
    this._glowPlace(e);
    if (this._glowRaf === undefined) this._glowRaf = requestAnimationFrame(this._glowWrite);
    this._glowEl()?.classList.add('on');
  };

  private _hovering = false;

  /** Focus moving between elements inside the card, or a click that leaves focus nowhere, must not hide it. */
  private _glowFocusOut = (e: FocusEvent) => {
    const to = e.relatedTarget as Node | null;
    if (to && (this.shadowRoot?.contains(to) || this.contains(to))) return;
    if (!to && this._hovering) return;
    this._glowHide();
  };

  private _glowHide = () => {
    this._hovering = false;
    if (this._glowRaf !== undefined) cancelAnimationFrame(this._glowRaf);
    this._glowRaf = undefined;
    this._glowEl()?.classList.remove('on');
  };

  // ---- Rendering -------------------------------------------------------

  protected override render(): TemplateResult {
    const cfg = this._config;
    if (!cfg || !this.hass) return html`<div class="lc g-dark unavailable">${t(this.hass, 'common.loading')}</div>`;
    const name = cfg.name || this._entity()?.attributes.friendly_name || cfg.entity;
    const glass = `g-${resolveGlass(cfg.look.glass, this.hass, this)}`;
    const vars = { '--_blur': `${cfg.look.blur}px`, '--_tint': String(cfg.look.tint) };

    const ctx = this._context();
    if (!ctx) {
      const missing = !this._entity();
      return html`<section class="lc ${glass}" style=${styleMap(vars)} aria-label=${name}>
        <h2>${name}</h2>
        <div class="unavailable">${missing ? t(this.hass, 'common.entityNotFound', { entity: cfg.entity }) : t(this.hass, 'common.unavailable')}</div>
      </section>`;
    }

    const { caps, view } = ctx;
    const info = entityModeInfo(ctx.stateObj, view.mode);
    const on = view.mode !== 'off';
    const sym = caps.symbol;
    const color = info.color;
    const sensors = resolveSensors(this.hass, cfg, this._detect(), caps.decimals);
    this._watched = [cfg.entity, ...sensors.watched, ...cfg.status_entities.flatMap((s) => [s.entity, ...(s.actions ?? [])])];
    const room = sensors.roomTemperature;
    const fmt = (n: number) => num(this.hass, n, caps.decimals);
    const hass = this.hass;
    const changing = this._writer.modeChanging;
    const verb = statusWord(hass, ctx.stateObj, view.mode, changing, view.subMode);
    // An activity reads "Heating to 20.0°"; a state ("Idle") reads "Idle, target 20.0°".
    const activity = readsAsActivity(ctx.stateObj, view.mode, changing, view.subMode);
    const resting = isResting(ctx.stateObj, view.mode, changing);

    const headerSub = !on
      ? t(hass, 'common.off')
      : view.dual
        ? activity
          ? t(hass, 'dial.subRange', { verb, range: `${t(hass, 'common.range', { low: fmt(view.low!), high: fmt(view.high!) })}${sym}` })
          : t(hass, 'dial.subTargetState', { state: verb, target: `${t(hass, 'common.range', { low: fmt(view.low!), high: fmt(view.high!) })}${sym}` })
        : view.hasSetpoint
          ? t(hass, activity ? 'dial.subTarget' : 'dial.subTargetState', activity ? { verb, target: `${fmt(view.target!)}${sym}` } : { state: verb, target: `${fmt(view.target!)}${sym}` })
          : verb;

    const intensity = view.fan ? fanIntensity(view.fan, caps.fanModes) : null;
    const spinS = spinSeconds(intensity);

    return html`
      <section
        class="lc rim ${glass} m-${cfg.look.motion}"
        style=${styleMap({ ...vars, '--delay': `${cfg.write_delay}s` })}
        aria-label=${name}
        @pointerenter=${this._glowEnter}
        @pointermove=${this._glowMove}
        @pointerleave=${this._glowHide}
        @pointercancel=${this._glowHide}
        @focusout=${this._glowFocusOut}
      >
        <div
          class="tint"
          aria-hidden="true"
          style=${styleMap({
            backgroundColor: color,
            opacity: on ? 'var(--lc-tint, var(--_tint))' : '0',
          })}
        ></div>

        <div class="glow" aria-hidden="true"></div>

        <header>
          <div class="titles">
            <h2>${name}</h2>
            <span class="sub">${headerSub}</span>
          </div>
          <div class="actions">
            <button
              class="press power"
              aria-label=${t(hass, on ? 'dial.turnOff' : 'dial.turnOn')}
              aria-pressed=${on ? 'true' : 'false'}
              ?hidden=${!caps.hasOff}
              style=${styleMap({ background: on ? rgba(color, 0.28) : undefined })}
              @click=${() => this._togglePower(ctx)}
            >
              ${this._icon(ICONS.power, 18, 2)}
            </button>
            <slot name="header-action"></slot>
          </div>
        </header>

        ${this._renderDial(ctx, color, on, room, spinS, intensity, resting)}
        ${this._renderModes(ctx)} ${this._renderChips(ctx)}
        ${sensors.problems.length
          ? html`<div class="alert" role="status">
              ${t(hass, sensors.problems.some((p) => p.detail) ? 'dial.problemDetail' : 'dial.problem', {
                source: [...new Set(sensors.problems.map((p) => p.source || p.entity_id))].join(', '),
                detail: [...new Set(sensors.problems.map((p) => p.detail).filter(Boolean))].join(', '),
              })}
            </div>`
          : nothing}
        ${sensors.battery?.low
          ? html`<div class="alert battery" role="status">${batteryText(hass, sensors.battery)}</div>`
          : nothing}
        ${sensors.info.length
          ? html`<div class="info" style=${styleMap({ gridTemplateColumns: `repeat(${sensors.info.length}, minmax(0, 1fr))` })}>
              ${sensors.info.map(
                (i) => html`<div>
                  <span class="v ${i.warn ? 'warn' : ''}"
                    >${i.value}${i.unit ? html`<small>${i.unit === '°' ? '°' : ` ${i.unit}`}</small>` : nothing}</span
                  >
                  <span class="l">${i.label}</span>
                </div>`,
              )}
            </div>`
          : nothing}
        ${this._renderStatus(cfg)}
        ${this._writer.error ? html`<div class="alert" role="alert">${this._writer.error}</div>` : nothing}
      </section>
    `;
  }

  private _icon(path: string, size: number, sw = 1.8, cls = '') {
    return svg`<svg class="i ${cls}" width=${size} height=${size} viewBox="0 0 24 24" stroke-width=${sw} aria-hidden="true"><path d=${path}></path></svg>`;
  }

  private _renderDial(ctx: Ctx, color: string, on: boolean, room: number | null, spinS: number, intensity: number | null, resting: boolean) {
    const { caps, view } = ctx;
    const { min, max } = caps;
    const hasFan = caps.fanModes.length > 0;
    const sp = view.hasSetpoint;
    const frac = (v: number) => valueToFraction(v, min, max);
    const angle = (v: number) => fractionToAngle(frac(v));

    // Setpoint geometry.
    const aLow = view.dual ? angle(view.low!) : view.target != null ? angle(view.target) : 135;
    const aHigh = view.dual ? angle(view.high!) : aLow;
    const progD = view.dual ? arcPath(R_TEMP, aLow, aHigh) : arcPath(R_TEMP, 135, aLow);
    const knobs: [number, number][] = [];
    if (sp) {
      knobs.push(pt(R_TEMP, aLow));
      if (view.dual) knobs.push(pt(R_TEMP, aHigh));
    }
    const roomPt = room != null && room >= min && room <= max ? pt(R_TEMP, angle(room)) : null;

    // Ticks.
    let dim = '';
    let lit = '';
    const labels: { x: number; y: number; t: string }[] = [];
    for (const t of buildTicks(min, max, tickInterval(caps.domain, min, max))) {
      const p1 = pt(t.major ? 111 : 116, t.angle);
      const p2 = pt(123, t.angle);
      const seg = `M ${p1[0].toFixed(1)} ${p1[1].toFixed(1)} L ${p2[0].toFixed(1)} ${p2[1].toFixed(1)} `;
      const isLit = sp && (view.dual ? t.value >= view.low! && t.value <= view.high! : t.value <= (view.target ?? min));
      if (isLit) lit += seg;
      else dim += seg;
      if (t.label) {
        const lp = pt(99, t.angle);
        labels.push({ x: lp[0], y: lp[1], t: String(t.value) });
      }
    }

    // Fan ring.
    const n = caps.fanModes.length;
    const segs = hasFan ? fanSegments(n) : [];
    const fi = view.fan ? caps.fanModes.indexOf(view.fan) : -1;
    const litSegs = litFanSegments(fi, n, caps.fanModes[0] === 'auto', caps.fanModes.indexOf('off'));
    let fanDim = '';
    let fanLit = '';
    const fanLabels: { x: number; y: number; t: string; on: boolean }[] = [];
    const fanLetters = fanShortLabels(caps.fanModes, caps.fanModes.map((m) => optionLabel(this.hass, 'fan_mode', m, ctx.stateObj)));
    segs.forEach((s, i) => {
      if (litSegs[i]) fanLit += arcPath(R_FAN, s.a0, s.a1) + ' ';
      else fanDim += arcPath(R_FAN, s.a0, s.a1) + ' ';
      const q = pt(190, (s.a0 + s.a1) / 2);
      fanLabels.push({ x: q[0], y: q[1], t: fanLetters[i], on: i === fi });
    });

    const hass = this.hass;
    const dec = caps.decimals;
    const nf = (v: number, d = dec) => num(hass, v, d);
    const sym = caps.symbol;
    const climate = caps.domain === 'climate';
    // Humidity reads whole when it is whole (45%), a temperature always with one decimal.
    const roomText = (v: number) => (caps.domain === 'humidifier' ? numAuto(hass, v, 1) : nf(v, 1));
    const big = sp
      ? view.dual
        ? null
        : nf(view.target!)
      : on
        ? room != null
          ? roomText(room)
          : '--'
        : t(hass, 'common.off');
    const centerSub = this._queue.isPending || this._writer.sending
      ? t(hass, 'dial.sending')
      : room != null && (sp || !on)
        ? climate
          ? t(hass, 'dial.insideValue', { temp: `${roomText(room)}${sym}` })
          : t(hass, 'dial.currentValue', { value: `${roomText(room)}${sym}` })
        : on && !sp
          ? t(hass, climate ? 'dial.inside' : 'dial.current')
          : '';

    const valueText = view.dual
      ? `${t(hass, 'common.range', { low: nf(view.low!), high: nf(view.high!) })} ${caps.unit}`
      : sp
        ? `${nf(view.target!)} ${caps.unit}`
        : t(hass, 'dial.noSetpoint');
    const nowValue = view.dual ? view.low : view.target;

    // An empty line is a fixed-height spacer: updated() hides it from assistive tech.
    this._centerEmpty = !centerSub;

    return html`
      <div class="dial-wrap">
        <div class="parts" aria-hidden="true">
          ${PARTICLES.map(
            (p) => html`<span
              class="pt pt-${climateTwin(ctx.stateObj, view.mode)}"
              style=${styleMap({
                left: `${p.left}%`,
                width: `${p.size}px`,
                height: `${p.size}px`,
                animationDelay: `${p.delay}s`,
                animationDuration: `${particleDuration(p.base, intensity).toFixed(2)}s`,
                backgroundColor: color,
              })}
            ></span>`,
          )}
        </div>
        <svg
          class="dial ${sp || hasFan ? '' : 'nodrag'}"
          role=${view.dual ? 'group' : 'slider'}
          tabindex=${view.dual ? nothing : '0'}
          aria-label=${view.dual
            ? t(hass, 'dial.ariaRange')
            : climate
              ? t(hass, 'dial.ariaTarget')
              : t(hass, caps.domain === 'humidifier' ? 'dial.ariaTargetHumidity' : 'dial.ariaTargetWater')}
          aria-valuemin=${view.dual ? nothing : min}
          aria-valuemax=${view.dual ? nothing : max}
          aria-valuenow=${view.dual ? nothing : (nowValue ?? nothing)}
          aria-valuetext=${view.dual ? nothing : valueText}
          viewBox="0 0 400 400"
          @pointerdown=${this._onDown}
          @pointermove=${this._onMove}
          @pointerup=${this._onUp}
          @pointercancel=${this._onUp}
          @lostpointercapture=${this._onUp}
          @keydown=${this._onKey}
        >
          ${hasFan
            ? svg`<path d=${fanDim || 'M 0 0'} fill="none" stroke="var(--lc-track)" stroke-width="10" stroke-linecap="round"></path>
                <path d=${fanLit || 'M 0 0'} fill="none" stroke="var(--lc-bright)" stroke-opacity="0.85" stroke-width="10" stroke-linecap="round" opacity=${on ? 1 : 0.3}></path>
`
            : nothing}
          ${hasFan
            ? svg`<circle class="spin" cx="200" cy="200" r="154" fill="none" stroke="var(--lc-tick)" stroke-width="1.2" stroke-dasharray="1.5 9" stroke-linecap="round" opacity=${on ? 1 : 0} style=${styleMap(spinStyle(spinS, on))}></circle>`
            : nothing}
          <path d=${arcPath(R_TEMP, 135, 405)} fill="none" stroke="var(--lc-track)" stroke-width="10" stroke-linecap="round"></path>
          <path d=${progD} fill="none" stroke=${color} stroke-width="10" stroke-linecap="round" opacity=${sp ? (resting ? 0.6 : 1) : 0} style="transition: stroke .8s, opacity .8s"></path>
          <path d=${dim || 'M 0 0'} fill="none" stroke="var(--lc-tick)" stroke-width="1.2" stroke-linecap="round"></path>
          <path d=${lit || 'M 0 0'} fill="none" stroke="var(--lc-bright)" stroke-width="1.5" stroke-linecap="round" opacity="0.85"></path>
          ${roomPt ? svg`<circle cx=${roomPt[0].toFixed(1)} cy=${roomPt[1].toFixed(1)} r="3.5" fill="var(--lc-bright)" opacity="0.7"></circle>` : nothing}
          ${knobs.map((k, i) => {
            const dualKnob = view.dual ? (i === 0 ? 'low' : 'high') : null;
            const v = dualKnob === 'low' ? view.low! : dualKnob === 'high' ? view.high! : null;
            return svg`<circle cx=${k[0].toFixed(1)} cy=${k[1].toFixed(1)} r="13" fill="var(--lc-bright)" stroke=${color} stroke-opacity=${resting ? 0.6 : 1} stroke-width="3.5" style="filter: drop-shadow(0 2px 6px rgba(0,0,0,0.45)); transition: stroke .8s, stroke-opacity .8s"
              role=${dualKnob ? 'slider' : nothing} tabindex=${dualKnob ? '0' : nothing} data-knob=${dualKnob ?? nothing}
              aria-label=${dualKnob ? t(hass, dualKnob === 'low' ? 'dial.knobLow' : 'dial.knobHigh') : nothing}
              aria-valuemin=${dualKnob ? (dualKnob === 'low' ? min : (view.low ?? min)) : nothing}
              aria-valuemax=${dualKnob ? (dualKnob === 'low' ? (view.high ?? max) : max) : nothing}
              aria-valuenow=${v ?? nothing} aria-valuetext=${v != null ? `${nf(v)} ${caps.unit}` : nothing}
              @keydown=${dualKnob ? this._onKey : nothing}></circle>`;
          })}
        </svg>

        ${fanLabels.map(
          (l) => html`<span
            class="fan-label"
            aria-hidden="true"
            style=${styleMap({ left: `${l.x / 4}%`, top: `${l.y / 4}%`, opacity: l.on ? '1' : '0.4' })}
            >${l.t}</span
          >`,
        )}
        ${labels.map(
          (l) => html`<span class="tick-label" aria-hidden="true" style=${styleMap({ left: `${l.x / 4}%`, top: `${l.y / 4}%` })}>${l.t}</span>`,
        )}

        <div class="center">
          ${keyed(
            `${view.mode}${big}${view.low}${view.high}`,
            html`<div class="big pop ${view.dual ? 'dual' : ''}">
              ${view.dual
                ? html`<span>${nf(view.low!)}</span><span class="dash"></span><span>${nf(view.high!)}</span><span class="deg">°</span>`
                : html`<span>${big}</span>${on ? html`<span class="deg">${sym}</span>` : nothing}`}
            </div>`,
          )}
          <div class="centersub">
            ${centerSub ? html`<span>${centerSub}</span>` : nothing}
            ${this._queue.isPending
              ? keyed(this._queue.generation, html`<span class="progress" aria-hidden="true"><span></span></span>`)
              : nothing}
          </div>
        </div>

        ${this._renderSteps(ctx)}
      </div>
    `;
  }

  /**
   * The steppers, in a template of their own. happy-dom matches the lit parts of the dial's big template wrongly
   * from its svg on, and a bound aria-label on these buttons inside it left them empty in the tests. Browsers are fine either way.
   */
  private _renderSteps(ctx: Ctx) {
    const sp = ctx.view.hasSetpoint;
    const hum = ctx.caps.domain === 'humidifier';
    return html`<div class="steps">
      <button class="press step" aria-label=${t(this.hass, hum ? 'common.stepDownHumidity' : 'common.stepDown')} ?disabled=${!sp} @click=${() => this._stepTemp(ctx, -1)}>
        ${this._icon('M5 12h14', 18, 2)}
      </button>
      <button class="press step" aria-label=${t(this.hass, hum ? 'common.stepUpHumidity' : 'common.stepUp')} ?disabled=${!sp} @click=${() => this._stepTemp(ctx, 1)}>
        ${this._icon('M5 12h14 M12 5v14', 18, 2)}
      </button>
    </div>`;
  }

  private _renderModes(ctx: Ctx) {
    const { caps, view } = ctx;
    if (!caps.modes.length) return nothing;
    return html`<div
      class="modes"
      role="group"
      aria-label=${t(this.hass, 'dial.mode')}
      style=${styleMap({ gridTemplateColumns: `repeat(${caps.modes.length}, minmax(0, 1fr))` })}
    >
      ${caps.modes.map((id) => {
        const m = entityModeInfo(ctx.stateObj, id);
        // A humidifier's mode shows as picked while it is on; its state is only on or off.
        const act = caps.domain === 'humidifier' ? view.mode !== 'off' && id === view.subMode : id === view.mode;
        return html`<button
          class="press mode"
          aria-pressed=${act ? 'true' : 'false'}
          aria-label=${domainModeLabel(this.hass, caps.domain, id, false, caps.modes)}
          style=${styleMap({
            background: act ? rgba(m.color, 0.2) : undefined,
            borderColor: act ? rgba(m.color, 0.45) : undefined,
            color: act ? 'var(--lc-fg)' : 'var(--lc-fg2)',
          })}
          @click=${() => this._setMode(ctx, id)}
        >
          ${this._icon(m.icon, 19)}
          <span>${domainModeLabel(this.hass, caps.domain, id, true, caps.modes)}</span>
        </button>`;
      })}
    </div>`;
  }

  private _renderChips(ctx: Ctx) {
    const { caps, view } = ctx;
    const chips: {
      label: string;
      value: string;
      icon: string;
      cls: string;
      active: boolean;
      aria: string;
      go: () => void;
    }[] = [];
    if (caps.swingModes.length) {
      const v = view.swing ?? caps.swingModes[0];
      chips.push({
        label: t(this.hass, 'dial.vertical'),
        value: optionLabel(this.hass, 'swing_mode', v, ctx.stateObj),
        icon: ICONS.swingV,
        cls: v === 'swing' ? 'osc' : v === 'windnice' ? 'osc-slow' : '',
        active: !INACTIVE.includes(v),
        aria: t(this.hass, 'dial.ariaVertical', { value: optionLabel(this.hass, 'swing_mode', v, ctx.stateObj) }),
        go: () => this._cycle('swing_mode', caps.swingModes, view.swing),
      });
    }
    if (caps.swingHModes.length) {
      const v = view.swingH ?? caps.swingHModes[0];
      chips.push({
        label: t(this.hass, 'dial.horizontal'),
        value: optionLabel(this.hass, 'swing_horizontal_mode', v, ctx.stateObj),
        icon: ICONS.swingH,
        cls: v === 'swing' ? 'osc' : '',
        active: !INACTIVE.includes(v),
        aria: t(this.hass, 'dial.ariaHorizontal', { value: optionLabel(this.hass, 'swing_horizontal_mode', v, ctx.stateObj) }),
        go: () => this._cycle('swing_horizontal_mode', caps.swingHModes, view.swingH),
      });
    }
    if (caps.presetModes.length) {
      const v = view.preset ?? caps.presetModes[0];
      chips.push({
        label: t(this.hass, 'dial.preset'),
        value: optionLabel(this.hass, 'preset_mode', v, ctx.stateObj),
        icon: v === 'away' ? ICONS.away : v === 'boost' ? ICONS.boost : ICONS.none,
        cls: v === 'boost' ? 'climb' : '',
        active: !INACTIVE.includes(v),
        aria: t(this.hass, 'dial.ariaPreset', { value: optionLabel(this.hass, 'preset_mode', v, ctx.stateObj) }),
        go: () => this._cycle('preset_mode', caps.presetModes, view.preset),
      });
    }
    if (caps.away && view.away != null) {
      const away = view.away;
      const value = t(this.hass, away ? 'common.on' : 'common.off');
      chips.push({
        label: t(this.hass, 'dial.away'),
        value,
        icon: ICONS.away,
        cls: '',
        active: away,
        aria: t(this.hass, 'dial.ariaAway', { value }),
        go: () => this._queue.set({ away_mode: away ? 'off' : 'on' }),
      });
    }
    if (!chips.length) return nothing;
    return html`<div class="chips" style=${styleMap({ gridTemplateColumns: `repeat(${chips.length}, minmax(0, 1fr))` })}>
      ${chips.map(
        (c) => html`<button
          class="press chip"
          aria-label=${c.aria}
          style=${styleMap({
            background: c.active ? 'var(--lc-btn-on)' : undefined,
            borderColor: c.active ? 'var(--lc-btn-on-edge)' : undefined,
          })}
          @click=${c.go}
        >
          ${this._icon(c.icon, 17, 2, c.cls)}
          <span class="txt"><span class="k">${c.label}</span><span class="v">${c.value}</span></span>
        </button>`,
      )}
    </div>`;
  }

  private _moreInfo(entityId: string) {
    this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId }, bubbles: true, composed: true }));
  }

  private _openWrap(): HTMLElement | null {
    return this._openRow === null ? null : (this.shadowRoot?.querySelector(`.srow[data-index="${this._openRow}"]`) as HTMLElement | null);
  }

  private _toggleRow(index: number) {
    this._calls.clear(String(index));
    if (this._openRow === index) this._closeRow();
    else {
      this._openRow = index;
      document.addEventListener('pointerdown', this._outside, true);
    }
  }

  private _closeRow = () => {
    if (this._openRow === null) return;
    const wrap = this._openWrap();
    const active = this.shadowRoot?.activeElement;
    // Focus inside the closing panel would be lost: bring it back to the row button first.
    if (wrap && active && wrap.querySelector('.mpanel')?.contains(active)) wrap.querySelector<HTMLElement>('.row')?.focus();
    this._calls.clear(String(this._openRow));
    this._openRow = null;
    document.removeEventListener('pointerdown', this._outside, true);
  };

  /** A press anywhere outside the open row and its panel closes the panel. */
  private _outside = (e: Event) => {
    const wrap = this._openWrap();
    if (wrap && e.composedPath().includes(wrap)) return;
    this._closeRow();
  };

  private _statusBody(v: StatusValue) {
    return v.kind === 'none'
      ? html`<span class="muted">--</span>`
      : v.kind === 'dot'
        ? html`<span class="dot" style=${`opacity: ${v.on ? 0.85 : 0.3}`}></span><span class="vt">${v.text}</span>`
        : v.kind === 'unit'
          ? html`<span class="vt">${v.number}<small class="unit"> ${v.unit}</small></span>`
          : html`<span class="vt">${v.text}</span>`;
  }

  private _renderStatus(cfg: LiquidClimateConfig) {
    // A row whose entity does not exist (deleted, misspelled, not picked yet) is not shown. One that
    // exists but is unavailable or unknown stays. The index stays the config index.
    const rows = cfg.status_entities.map((s, index) => ({ s, index })).filter(({ s }) => !!this.hass.states[s.entity]);
    if (!rows.length) return nothing;
    return html`<div class="status">
      ${rows.map(({ s, index }) => {
        const e = this.hass.states[s.entity];
        const v = statusValue(this.hass, e);
        const label = s.name || e?.attributes.friendly_name || s.entity;
        const title = statusTitle(v);
        const icon = s.icon ? html`<ha-icon class="ric" icon=${s.icon}></ha-icon>` : nothing;
        const content = [
          icon,
          html`<span class="lbl">${label}</span><span class="val" title=${title}>${this._statusBody(v)}</span>`,
        ];
        if (!menuVisible(this.hass, s)) {
          return html`<button class="row" data-index=${index} @click=${() => this._moreInfo(s.entity)}>${content}</button>`;
        }
        return this._renderMenuRow(s, index, content);
      })}
    </div>`;
  }

  private _renderMenuRow(s: StatusItem, index: number, content: unknown) {
    const open = this._openRow === index;
    return html`<div
      class="srow"
      data-index=${index}
      ?data-open=${open}
      @keydown=${(e: KeyboardEvent) => open && handleMenuKey(e, e.currentTarget as HTMLElement, this._closeRow)}
    >
      <button class="row" aria-expanded=${open ? 'true' : 'false'} aria-controls=${panelId(index)} @click=${() => this._toggleRow(index)}>
        ${content}
        <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"></path></svg>
      </button>
      ${renderMenuPanel(
        { hass: this.hass, item: s, index, calls: this._calls, moreInfo: (id) => this._moreInfo(id) },
        open,
      )}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'liquid-climate-card': LiquidClimateCard;
  }
}
