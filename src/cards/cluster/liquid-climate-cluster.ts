import { LitElement, css, html, nothing, svg, unsafeCSS, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';
import { clusterSource, normalizeClusterConfig, roomDialConfig, type ClusterConfig } from '../../config';
import { migrateConfig } from '../../migrate';
import { Memo } from '../../detect/cache';
import { runtimeDetection, type RuntimeDetection } from '../../detect/runtime';
import { ROOM_FILL, resolveGlass } from '../../ui/glass';
import { glassTokens } from '../../ui/glass-styles';
import { START, SWEEP, arcPath, fanSegments, fractionToAngle, litFanSegments, pt, valueToFraction } from '../../ui/geometry';
import { ICONS, STATUS_COLORS, TINT, domainModeLabel, entityModeInfo, fanIntensity, rgba, spinSeconds, tone } from '../../ui/modes';
import { num, numAuto, t } from '../../i18n';
import type { HomeAssistant } from '../../types';
import { isSupportedEntity } from '../../domain';
import { setpointPatch, steppedTarget } from '../dial/capabilities';
import { WriterLease, type ClimateWriter } from '../shared/writer';
import { hassNeedsRender } from '../shared/render-gate';
import '../shared/sheet';
import type { LiquidClimateSheet } from '../shared/sheet';
import { clusterGroups, defaultClusterTitle, type RoomGroup } from './grouping';
import { clusterFigures, clusterSummary, roomFooter, roomModel, type RoomModel } from './model';

/** Mini dial radii in the shared 400 x 400 geometry: setpoint track, fan ring, spin ring. */
const R_TRACK = 160;
const R_FANRING = 188;
const R_SPIN = 154;
/** Chevron on the strip's dial opener. */
const CHEVRON = 'M9 6l6 6-6 6';

@customElement('liquid-climate-cluster')
export class LiquidClimateCluster extends LitElement {
  @property({ attribute: false }) hass!: HomeAssistant;
  @state() private _config?: ClusterConfig;
  @state() private _tick = 0;
  /** The room the strip controls. Pinned during render (not a reactive state, so that is allowed). */
  private _selected?: string;
  /** The room shown in the dial sheet, so an open sheet can follow setConfig. */
  private _sheetEntity?: string;

  /** One lease per room: the same shared writer the tile, badge and dial use for that entity. */
  private _leases = new Map<string, WriterLease>();
  private _detections = new Map<string, Memo<RuntimeDetection>>();
  private _watched: string[] = [];
  private _awaiting: string[] = [];
  /** Auto modes: climate ids from the last render plus the registry; one appearing or going away re-renders. */
  private _climateIds: string[] = [];

  // ---- Lovelace API ----------------------------------------------------

  setConfig(raw: Record<string, unknown>): void {
    if (!raw || typeof raw !== 'object') throw new Error('Liquid Climate: invalid cluster config');
    const next = normalizeClusterConfig(migrateConfig(raw));
    const bad = next.entities.find((r) => !isSupportedEntity(r.entity));
    if (bad) throw new Error(`Liquid Climate: "${bad.entity}" in entities is not a climate entity (climate, water_heater or humidifier)`);
    this._config = next;
    this._watched = [];
    this._awaiting = [];
    this._climateIds = [];
    // An open dial follows the new config, like the tile's does; it closes when its room left.
    const sheet = this._sheet();
    if (sheet?.isOpen && this._sheetEntity && this.hass) {
      const ref = clusterGroups(this.hass, next)
        .flatMap((g) => g.rooms)
        .find((r) => r.room.entity === this._sheetEntity);
      if (ref) sheet.reconfigure(roomDialConfig(next, ref.room, ref.name));
      else sheet.close();
    }
  }

  getGridOptions() {
    return { columns: 'full', rows: 'auto', min_columns: 12 };
  }

  getCardSize(): number {
    return 8;
  }

  static async getConfigElement(): Promise<HTMLElement> {
    return document.createElement('liquid-climate-cluster-editor');
  }

  static getStubConfig(): Record<string, unknown> {
    return { type: 'custom:liquid-climate-cluster', config_version: 1 };
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // Moved or re-attached (a dashboard edit, a view switch): render again so the leases released
    // on disconnect are acquired again and pending writes show.
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    // Releasing sends whatever is still pending, so a change is never lost.
    for (const lease of this._leases.values()) lease.release();
    this._leases.clear();
  }

  protected override shouldUpdate(changed: PropertyValues): boolean {
    const sheet = this._sheet();
    if (changed.has('hass') && sheet) sheet.hass = this.hass;
    if (changed.has('hass') && this.hass) for (const lease of this._leases.values()) lease.current?.observe(this.hass);
    if (!changed.has('hass') || changed.size > 1 || !this._config || !this._watched.length) return true;
    const old = changed.get('hass') as HomeAssistant | undefined;
    // Auto rooms: a known climate entity appearing or going away is a new or removed unit. A
    // registry change (a new unit) re-renders through hassNeedsRender and refreshes the ids.
    if (old && this._climateIds.some((id) => !old.states[id] !== !this.hass.states[id])) return true;
    return hassNeedsRender(old, this.hass, this._watched, this._awaiting);
  }

  // ---- Rooms -----------------------------------------------------------

  private _writer(entity: string): ClimateWriter {
    let lease = this._leases.get(entity);
    if (!lease) {
      lease = new WriterLease(() => this._tick++);
      this._leases.set(entity, lease);
    }
    const w = lease.get(entity);
    if (this.hass && !w.hass) w.hass = this.hass;
    return w;
  }

  /** The writer for a write: this card's delay is set right before it, since other cards share the writer. */
  private _writeVia(entity: string): ClimateWriter {
    const w = this._writer(entity);
    w.delay = this._config?.write_delay ?? 1.5;
    w.hold = this._config?.write_hold ?? 10;
    return w;
  }

  private _detection(entity: string): RuntimeDetection {
    let memo = this._detections.get(entity);
    if (!memo) {
      memo = new Memo<RuntimeDetection>();
      this._detections.set(entity, memo);
    }
    return runtimeDetection(this.hass, entity, memo);
  }

  /** Rooms in display order, plus their groups. Releases the writers of rooms that left. */
  private _rooms(cfg: ClusterConfig): { groups: RoomGroup[]; rooms: RoomModel[] } {
    const groups = clusterGroups(this.hass, cfg);
    const rooms: RoomModel[] = [];
    const awaiting: string[] = [];
    for (const g of groups) {
      for (const ref of g.rooms) {
        const id = ref.room.entity;
        // Detached: no new leases (disconnectedCallback would not release them); read what exists.
        const w = this.isConnected ? this._writer(id) : this._leases.get(id)?.current;
        const found = this._detection(id);
        awaiting.push(...found.awaiting);
        rooms.push(roomModel(this.hass, ref, roomDialConfig(cfg, ref.room, ref.name), found.detection, w?.local ?? {}, w?.modeChanging ?? false));
      }
    }
    if (clusterSource(cfg) === 'list') this._climateIds = [];
    else {
      // Rendering scans the states anyway; the registry adds units whose state has not arrived yet.
      const registry = Object.keys(this.hass.entities ?? {}).filter((id) => cfg.domains.some((d) => id.startsWith(`${d}.`)));
      this._climateIds = [...new Set([...rooms.map((r) => r.dial.entity), ...registry])];
    }
    const ids = new Set(rooms.map((r) => r.dial.entity));
    for (const [id, lease] of this._leases) {
      if (ids.has(id)) continue;
      lease.release();
      this._leases.delete(id);
      this._detections.delete(id);
    }
    this._watched = rooms.flatMap((r) => [r.dial.entity, ...r.sensors.watched]);
    this._awaiting = awaiting;
    return { groups, rooms };
  }

  // ---- Interaction -----------------------------------------------------

  private _select(id: string) {
    if (this._selected === id) return;
    this._selected = id;
    this.requestUpdate();
  }

  private _setMode(r: RoomModel, mode: string) {
    if (!r.caps) return;
    const w = this._writeVia(r.dial.entity);
    // A humidifier's mode sits next to on and off: picking one while off turns it on too.
    if (r.caps.domain === 'humidifier') {
      if (mode !== r.view?.subMode || !r.on) w.set(r.on ? { mode } : { hvac_mode: 'on', mode });
    } else if (mode !== r.mode) w.setMode(mode);
  }

  /** steppedTarget is null at a limit and while off, so an aria-disabled stepper does nothing. */
  private _step(r: RoomModel, dir: 1 | -1) {
    const next = r.view && r.caps ? steppedTarget(r.view, r.caps, dir) : null;
    if (next != null) this._writeVia(r.dial.entity).set(setpointPatch(r.caps!, next));
  }

  private _sheet(): LiquidClimateSheet | null {
    return this.renderRoot?.querySelector('liquid-climate-sheet') ?? null;
  }

  private _openSheet(r: RoomModel, from: HTMLElement) {
    this._sheetEntity = r.dial.entity;
    void this._sheet()?.open(r.dial, from);
  }

  // ---- Rendering -------------------------------------------------------

  private _icon(path: string, size: number, sw: number) {
    return svg`<svg class="i" width=${size} height=${size} viewBox="0 0 24 24" stroke-width=${sw} aria-hidden="true"><path d=${path}></path></svg>`;
  }

  /** Colour of a room's icon: status colours first, the mode colour only while it is doing its job. */
  private _roomColor(r: RoomModel, glass: 'dark' | 'light'): string | null {
    if (r.kind === 'error') return tone(STATUS_COLORS.error, glass);
    if (r.kind === 'paused' || r.kind === 'battery') return tone(STATUS_COLORS.paused, glass);
    return r.on && r.active ? tone(entityModeInfo(r.stateObj, r.mode).color, glass) : null;
  }

  /** The mini dial and its centre text, in one span: an <svg> at a template root does not parse in every DOM. */
  private _miniDial(r: RoomModel, glass: 'dark' | 'light', motion: string, center: TemplateResult) {
    const caps = r.caps;
    const view = r.view;
    const color = tone(entityModeInfo(r.stateObj, r.mode).color, glass);
    const angle = (v: number) => fractionToAngle(valueToFraction(v, caps!.min, caps!.max));
    const fans = caps?.fanModes ?? [];
    const fanIndex = view?.fan ? fans.indexOf(view.fan) : -1;
    const lit = litFanSegments(r.on ? fanIndex : -1, fans.length, fans[0] === 'auto', fans.indexOf('off'));
    const segs = fanSegments(fans.length, 5);
    const spin = r.on && fanIndex >= 0 && motion !== 'minimal';
    const single = r.on && !!view?.hasSetpoint && !view.dual && view.target != null;
    const dual = r.on && !!view?.dual && view.low != null && view.high != null;
    const knob = single ? pt(R_TRACK, angle(view!.target!)) : [0, 0];
    const dot = caps && r.inside != null ? pt(R_TRACK, angle(r.inside)) : null;
    const fanD = (on: boolean) =>
      segs
        .filter((_, i) => lit[i] === on)
        .map((s) => arcPath(R_FANRING, s.a0, s.a1))
        .join(' ') || 'M 0 0';
    const prog = single ? arcPath(R_TRACK, START, angle(view!.target!)) : dual ? arcPath(R_TRACK, angle(view!.low!), angle(view!.high!)) : 'M 0 0';
    const spinS = spin ? spinSeconds(fanIntensity(view!.fan!, fans)) : 7;
    const show = (v: boolean) => (v ? 'inline' : 'none');
    // Attribute bindings only: some DOMs drop child-part markers inside <svg>.
    return html`<span class="mini"
      ><svg class="mini-svg" viewBox="0 0 400 400" aria-hidden="true">
        <path class="fan-dim" d=${fanD(false)} display=${show(segs.length > 0)}></path>
        <path class="fan-lit" d=${fanD(true)} display=${show(lit.some(Boolean))}></path>
        <circle class="spin" cx="200" cy="200" r=${R_SPIN} display=${show(spin)} style=${styleMap({ animationDuration: `${spinS.toFixed(1)}s` })}></circle>
        <path class="track" d=${arcPath(R_TRACK, START, START + SWEEP)}></path>
        <path class="prog" stroke=${color} d=${prog} display=${show(single || dual)}></path>
        <circle class="dot" cx=${dot ? dot[0].toFixed(1) : 0} cy=${dot ? dot[1].toFixed(1) : 0} r="6" display=${show(!!dot)}></circle>
        <circle class="knob" stroke=${color} cx=${knob[0].toFixed(1)} cy=${knob[1].toFixed(1)} r="16" display=${show(single)}></circle></svg
      >${center}</span
    >`;
  }

  /** Target as text (and spoken, "21.0 to 24.0" for a range): one setpoint, a range, Off, or -- for no setpoint. */
  private _target(r: RoomModel): { text: string; spoken: string; range: boolean; deg: boolean } {
    const v = r.view;
    const dec = r.caps?.decimals ?? 1;
    if (r.on && v?.dual && v.low != null && v.high != null) {
      const [lo, hi] = [num(this.hass, v.low, dec), num(this.hass, v.high, dec)];
      return { text: `${lo}–${hi}`, spoken: t(this.hass, 'common.range', { low: lo, high: hi }), range: true, deg: true };
    }
    if (r.on && v?.hasSetpoint && v.target != null) {
      const text = num(this.hass, v.target, dec);
      return { text, spoken: text, range: false, deg: true };
    }
    // An available unit that is off says Off, also while paused or in error.
    const text = r.available && !r.on ? t(this.hass, 'common.off') : '--';
    return { text, spoken: text, range: false, deg: false };
  }

  private _roomTile(r: RoomModel, selected: boolean, glass: 'dark' | 'light', motion: string) {
    const tg = this._target(r);
    const color = this._roomColor(r, glass);
    const icon = r.kind === 'error' || r.kind === 'battery' ? ICONS.alert : r.kind === 'paused' ? ICONS.door : entityModeInfo(r.stateObj, r.on ? r.mode : 'off').icon;
    const foot = roomFooter(r, this.hass);
    const warn = r.kind === 'error' || r.kind === 'paused' || r.kind === 'battery';
    const unit = r.caps?.unit ?? '°';
    const sym = r.caps?.symbol ?? '°';
    const climate = !r.caps || r.caps.domain === 'climate';
    const inside = r.inside == null ? '' : r.caps?.domain === 'humidifier' ? numAuto(this.hass, r.inside, 1) : num(this.hass, r.inside, 1);
    const aria = [
      r.ref.name,
      warn ? foot : r.verb,
      tg.deg ? t(this.hass, 'cluster.ariaTarget', { value: tg.spoken, unit }) : '',
      r.inside != null ? t(this.hass, climate ? 'cluster.ariaInside' : 'cluster.ariaCurrent', { value: inside, unit }) : '',
    ]
      .filter(Boolean)
      .join(', ');
    return html`<button
      class="room press ${selected ? 'sel' : ''}"
      aria-pressed=${selected ? 'true' : 'false'}
      aria-label=${aria}
      @click=${() => this._select(r.dial.entity)}
    >
      <span class="rhead">
        <span class="rname">${r.ref.name}</span>
        <span class="ricon" style=${styleMap({ color: color ?? 'var(--lc-fg3)' })}>${this._icon(icon, 16, 2)}</span>
      </span>
      ${this._miniDial(
        r,
        glass,
        motion,
        html`<span class="center">
          <span class="tline ${tg.range ? 'range' : ''}"><span class="big">${tg.text}</span>${tg.deg ? html`<span class="deg">${sym}</span>` : nothing}</span>
          ${r.inside != null
            ? html`<span class="inside">${climate ? t(this.hass, 'dial.insideValue', { temp: `${inside}${sym}` }) : t(this.hass, 'dial.currentValue', { value: `${inside}${sym}` })}</span>`
            : nothing}
        </span>`,
      )}
      ${warn
        ? html`<span class="foot warn">${foot}</span>`
        : html`<span class="foot" title=${foot}>${foot}</span>`}
    </button>`;
  }

  private _strip(r: RoomModel, glass: 'dark' | 'light') {
    const tg = this._target(r);
    const caps = r.caps;
    const single = r.on && !!r.view?.hasSetpoint && !r.view.dual && r.view.target != null;
    const atMin = single && r.view!.target! <= caps!.min;
    const atMax = single && r.view!.target! >= caps!.max;
    const err = this._leases.get(r.dial.entity)?.current?.error;
    const verb = err ?? (r.kind === 'error' || r.kind === 'paused' || r.kind === 'battery' ? roomFooter(r, this.hass) : r.verb);
    const modes = caps?.modes ?? [];
    const name = r.ref.name;
    const sym = caps?.symbol ?? '°';
    const hum = caps?.domain === 'humidifier';
    return html`<div class="strip ${modes.length ? '' : 'nomodes'}" role="group" aria-label=${t(this.hass, 'cluster.controls', { name })}>
      <button
        class="who"
        aria-haspopup="dialog"
        aria-label=${t(this.hass, 'cluster.openDial', { name, verb })}
        @click=${(e: Event) => this._openSheet(r, e.currentTarget as HTMLElement)}
      >
        <span class="wtext">
          <span class="sname">${name}</span>
          <span class="sverb ${err || r.kind === 'error' || r.kind === 'paused' || r.kind === 'battery' ? 'warn' : ''}">${verb}</span>
        </span>
        <span class="chev">${this._icon(CHEVRON, 16, 2)}</span>
      </button>
      ${modes.length
        ? html`<div class="modes" role="group" aria-label=${t(this.hass, 'cluster.modeGroup', { name })}>
        ${modes.map((id) => {
          const info = entityModeInfo(r.stateObj, id);
          const on = hum ? r.on && id === r.view?.subMode : id === r.mode;
          const c = tone(info.color, glass);
          return html`<button
            class="press mode"
            aria-label=${domainModeLabel(this.hass, caps!.domain, id)}
            aria-pressed=${on ? 'true' : 'false'}
            style=${styleMap({
              background: on ? rgba(c, TINT.tile) : undefined,
              borderColor: on ? rgba(c, TINT.tileEdge) : undefined,
              color: on ? 'var(--lc-bright)' : 'var(--lc-fg2)',
            })}
            @click=${() => this._setMode(r, id)}
          >
            ${this._icon(info.icon, 18, 1.9)}
          </button>`;
        })}
      </div>`
        : nothing}
      <div class="steps">
        ${tg.range
          ? html`<button
              class="press target range"
              aria-haspopup="dialog"
              aria-label=${t(this.hass, 'cluster.rangeAria', { range: tg.spoken, unit: caps?.unit ?? '' })}
              @click=${(e: Event) => this._openSheet(r, e.currentTarget as HTMLElement)}
            >
              ${tg.text}${sym}
            </button>`
          : html`<button
                class="press step"
                aria-label=${t(this.hass, hum ? 'common.stepDownHumidity' : 'common.stepDown')}
                aria-disabled=${!single || atMin ? 'true' : 'false'}
                @click=${() => this._step(r, -1)}
              >
                ${this._icon(ICONS.minus, 18, 2)}
              </button>
              <span class="target" aria-live="polite" aria-atomic="true"
                ><span class="sr">${t(this.hass, 'common.target')} </span>${single ? html`<span class="tval">${tg.text}${sym}</span>` : html`<span class="tval" aria-hidden="true">--</span>`}</span
              >
              <button
                class="press step"
                aria-label=${t(this.hass, hum ? 'common.stepUpHumidity' : 'common.stepUp')}
                aria-disabled=${!single || atMax ? 'true' : 'false'}
                @click=${() => this._step(r, 1)}
              >
                ${this._icon(ICONS.plus, 18, 2)}
              </button>`}
      </div>
    </div>`;
  }

  protected override render(): TemplateResult {
    const cfg = this._config;
    if (!cfg || !this.hass) return html`<section class="cluster g-dark"><span class="sum">${t(this.hass, 'common.loading')}</span></section>`;
    const glass = resolveGlass(cfg.look.glass, this.hass, this);
    const motion = cfg.look.motion;
    const { groups, rooms } = this._rooms(cfg);
    // Pin the selection: the first room at first, and the first room again when the selected one left.
    const selected = rooms.find((r) => r.dial.entity === this._selected) ?? rooms[0];
    this._selected = selected?.dial.entity;
    const figures = clusterFigures(this.hass, rooms);
    const title = cfg.title || defaultClusterTitle(this.hass, cfg);
    const w = selected ? this._leases.get(selected.dial.entity)?.current : undefined;
    // Emptied while a new attempt is in flight, so the alert speaks again when that one fails too.
    const announce = w?.error && !w.sending ? `${selected!.ref.name}: ${w.error}` : '';

    return html`
      <section class="cluster rim g-${glass} m-${motion}" style=${styleMap({ '--_blur': `${cfg.look.blur}px` })} aria-label=${title}>
        <header>
          <div class="title">
            <h2>${title}</h2>
            ${rooms.length ? html`<span class="sum">${clusterSummary(rooms, this.hass)}</span>` : nothing}
          </div>
          ${figures.length
            ? html`<div class="figs">${figures.map((f) => html`<span class="fig"><strong>${f.value}</strong> ${f.label}</span>`)}</div>`
            : nothing}
        </header>
        ${groups.filter((g) => g.rooms.length).map(
          // The wrapper (display: contents) keeps every part inside an element, never at the template's top level.
          (g) => html`<div class="group">
            ${g.title ? html`<h3 class="floor">${g.title}</h3>` : nothing}
            <div class="rooms">${g.rooms.map((ref) => {
              const r = rooms.find((m) => m.ref === ref)!;
              return this._roomTile(r, r === selected, glass, motion);
            })}</div>
          </div>`,
        )}
        ${rooms.length ? nothing : html`<p class="empty">${t(this.hass, 'cluster.empty')}</p>`}
        ${selected ? this._strip(selected, glass) : nothing}
      </section>
      <span class="sr" role="alert">${announce}</span>
      <liquid-climate-sheet .hass=${this.hass}></liquid-climate-sheet>
    `;
  }

  static override styles = [
    glassTokens,
    css`
      :host {
        display: block;
        container-type: inline-size;
      }
      .g-dark {
        --lc-room: ${unsafeCSS(ROOM_FILL.dark.rest)};
        --lc-room-on: ${unsafeCSS(ROOM_FILL.dark.on)};
        --lc-room-edge: ${unsafeCSS(ROOM_FILL.dark.edge)};
        --lc-room-on-edge: ${unsafeCSS(ROOM_FILL.dark.onEdge)};
      }
      .g-light {
        --lc-room: ${unsafeCSS(ROOM_FILL.light.rest)};
        --lc-room-on: ${unsafeCSS(ROOM_FILL.light.on)};
        --lc-room-edge: ${unsafeCSS(ROOM_FILL.light.edge)};
        --lc-room-on-edge: ${unsafeCSS(ROOM_FILL.light.onEdge)};
      }
      .cluster {
        font-family: 'Liquid Inter', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
        -webkit-font-smoothing: antialiased;
        font-feature-settings: 'tnum' 1;
        position: relative;
        box-sizing: border-box;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 14px;
        border-radius: var(--lc-radius, 36px);
        color: var(--lc-fg);
        background: var(--lc-bg);
        backdrop-filter: blur(var(--lc-blur, var(--_blur, 30px))) saturate(170%);
        -webkit-backdrop-filter: blur(var(--lc-blur, var(--_blur, 30px))) saturate(170%);
        border: 1px solid var(--lc-edge);
        box-shadow:
          inset 0 1px 0 var(--lc-shine),
          0 40px 80px -24px rgba(0, 0, 0, 0.65);
      }
      button {
        font: inherit;
        color: inherit;
        cursor: pointer;
        margin: 0;
        border: 1px solid var(--lc-btn-edge);
        background: var(--lc-btn);
      }
      button:focus-visible {
        outline: 2px solid var(--lc-bright);
        outline-offset: 2px;
      }
      button:disabled {
        cursor: default;
      }
      .press {
        transition:
          transform 0.3s cubic-bezier(0.3, 1.7, 0.5, 1),
          background-color 0.5s ease,
          border-color 0.5s ease;
      }
      .press:active:not(:disabled):not([aria-disabled='true']) {
        transform: scale(0.96);
      }
      header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 6px 16px;
        flex-wrap: wrap;
      }
      .title {
        display: flex;
        align-items: baseline;
        gap: 12px;
        min-width: 0;
      }
      h2 {
        margin: 0;
        font-size: 22px;
        font-weight: 600;
        letter-spacing: -0.02em;
      }
      .sum,
      .figs {
        font-size: 13px;
        color: var(--lc-fg2);
      }
      .figs {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 22px;
      }
      .fig strong {
        font-weight: 500;
        color: var(--lc-fg);
      }
      .group {
        display: contents;
      }
      .floor {
        margin: 2px 0 -4px;
        font-size: 12px;
        font-weight: 500;
        color: var(--lc-fg2);
      }
      /* Narrow: compact rooms in a horizontal scroller. The vertical padding keeps focus rings unclipped. */
      .rooms {
        display: flex;
        gap: 10px;
        overflow-x: auto;
        scroll-snap-type: x mandatory;
        overscroll-behavior-x: contain;
        scrollbar-width: none;
        margin: -6px -16px;
        padding: 6px 16px;
        scroll-padding: 0 16px;
      }
      .rooms::-webkit-scrollbar {
        display: none;
      }
      .room {
        /* The next room peeks in, so the row reads as scrollable. */
        flex: 0 0 min(158px, 42cqw);
        scroll-snap-align: start;
        box-sizing: border-box;
        min-width: 0;
        border-radius: 22px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 4px;
        text-align: left;
        background: var(--lc-room);
        border-color: var(--lc-room-edge);
      }
      .room.sel {
        background: var(--lc-room-on);
        border-color: var(--lc-room-on-edge);
      }
      .rhead {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .rname {
        font-size: 15px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .ricon {
        display: flex;
        flex: none;
      }
      .mini {
        position: relative;
        align-self: center;
        width: min(190px, 100%);
        aspect-ratio: 1;
        display: block;
      }
      .mini-svg {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        fill: none;
        stroke-linecap: round;
      }
      .track {
        stroke: var(--lc-track);
        stroke-width: 14;
      }
      .prog {
        stroke-width: 14;
      }
      .fan-dim {
        stroke: var(--lc-track);
        stroke-width: 10;
      }
      .fan-lit {
        stroke: var(--lc-bright);
        stroke-width: 10;
        opacity: 0.8;
      }
      .spin {
        stroke: var(--lc-tick);
        stroke-width: 2;
        stroke-dasharray: 2.4 14;
        transform-box: fill-box;
        transform-origin: center;
        animation: lcSpin 7s linear infinite;
      }
      .m-minimal .spin {
        animation: none;
      }
      @keyframes lcSpin {
        to {
          transform: rotate(360deg);
        }
      }
      .dot {
        fill: var(--lc-bright);
        stroke: none;
        opacity: 0.7;
      }
      .knob {
        fill: #ffffff;
        stroke-width: 6;
      }
      .center {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding-bottom: 4px;
      }
      .tline {
        display: flex;
        align-items: flex-start;
      }
      .big {
        font-size: 34px;
        font-weight: 200;
        letter-spacing: -0.04em;
        line-height: 1;
      }
      .tline.range .big {
        font-size: 18px;
        font-weight: 300;
      }
      .deg {
        font-size: 15px;
        font-weight: 300;
        margin-top: 3px;
        color: var(--lc-fg2);
      }
      .inside {
        font-size: 12px;
        color: var(--lc-fg2);
        margin-top: 6px;
        max-width: 100%;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .foot {
        font-size: 12px;
        color: var(--lc-fg3);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .foot.warn,
      .sverb.warn {
        color: var(--lc-warn);
      }
      /* Error codes stay visible: up to two lines instead of an ellipsis. */
      .foot.warn {
        white-space: normal;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
      }
      .empty {
        margin: 0;
        font-size: 13px;
        color: var(--lc-fg2);
      }
      /* Name and steppers on one row, the modes below; from 720px all on one row (see below). */
      .strip {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        grid-template-areas: 'who steps' 'modes modes';
        align-items: center;
        gap: 12px 16px;
        border-top: 1px solid var(--lc-line);
        padding-top: 14px;
      }
      .strip.nomodes {
        grid-template-areas: 'who steps';
      }
      .who {
        grid-area: who;
        min-width: 0;
        min-height: 44px;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 0 8px;
        margin-left: -8px;
        border: none;
        background: none;
        text-align: left;
        border-radius: 12px;
        transition: background-color 0.3s ease;
      }
      .who:hover,
      .who:focus-visible {
        background: var(--lc-btn);
      }
      .wtext {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .chev {
        display: flex;
        flex: none;
        color: var(--lc-fg2);
      }
      .sname {
        font-size: 15px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sverb {
        font-size: 12px;
        color: var(--lc-fg3);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .modes {
        grid-area: modes;
        min-width: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .mode {
        width: 44px;
        height: 44px;
        border-radius: 14px;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .steps {
        grid-area: steps;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .step {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      /* aria-disabled, not disabled: the button keeps focus and _step ignores the click. */
      .step[aria-disabled='true'] {
        opacity: 0.3;
        cursor: default;
      }
      .target {
        width: 66px;
        text-align: center;
        font-size: 24px;
        font-weight: 300;
        letter-spacing: -0.03em;
        white-space: nowrap;
      }
      .target.range {
        width: auto;
        min-height: 44px;
        padding: 0 14px;
        border-radius: 22px;
        font-size: 20px;
      }
      .sr {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
        border: 0;
      }
      /* Medium: two columns of full rooms. */
      @container (min-width: 440px) {
        .cluster {
          padding: 20px;
        }
        .rooms {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          overflow: visible;
          margin: 0;
          padding: 0;
        }
        .room {
          border-radius: 26px;
          padding: 14px;
        }
        .big {
          font-size: 40px;
        }
        .deg {
          font-size: 17px;
        }
        .tline.range .big {
          font-size: 22px;
        }
      }
      /* Wide: three columns, the strip on one row like the board; many modes wrap inside their cell. */
      @container (min-width: 720px) {
        .cluster {
          padding: 24px;
          gap: 18px;
        }
        .rooms {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
        .room {
          padding: 16px;
        }
        .big {
          font-size: 44px;
        }
        .deg {
          font-size: 18px;
          margin-top: 4px;
        }
        .strip,
        .strip.nomodes {
          grid-template-columns: minmax(96px, 150px) minmax(0, 1fr) auto;
          grid-template-areas: 'who modes steps';
          padding-top: 16px;
        }
        .steps {
          gap: 8px;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .spin {
          animation: none;
        }
        .press,
        .who {
          transition: none;
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'liquid-climate-cluster': LiquidClimateCluster;
  }
}
