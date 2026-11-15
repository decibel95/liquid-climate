import { LitElement, css, html, nothing, svg, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';
import { normalizeTileConfig, sheetConfig, type TileConfig } from '../../config';
import { migrateConfig } from '../../migrate';
import { resolveSensors, roomTemperatureOf } from '../../detect/resolve';
import { Memo } from '../../detect/cache';
import { runtimeDetection, type RuntimeDetection } from '../../detect/runtime';
import { resolveGlass } from '../../ui/glass';
import { glassTokens } from '../../ui/glass-styles';
import { ICONS, STATUS_COLORS, TINT, modeInfo, rgba, tone } from '../../ui/modes';
import { num, t } from '../../i18n';
import type { HassEntity, HomeAssistant } from '../../types';
import { buildView, getCapabilities, steppedTarget, type Capabilities, type DialView } from '../dial/capabilities';
import { WriterLease, powerOnMode, rememberedMode, type ClimateWriter } from '../shared/writer';
import { hassNeedsRender } from '../shared/render-gate';
import { activelyHeating, batteryText, statusWord } from '../shared/status';
import '../shared/sheet';
import type { LiquidClimateSheet } from '../shared/sheet';

interface Ctx {
  stateObj: HassEntity;
  caps: Capabilities;
  view: DialView;
}

@customElement('liquid-climate-tile')
export class LiquidClimateTile extends LitElement {
  @property({ attribute: false }) hass!: HomeAssistant;
  @state() private _config?: TileConfig;
  @state() private _tick = 0;

  /** Shared with every other card on the same entity, the sheet's dial included. */
  private _lease = new WriterLease(() => this._tick++);
  private _detection = new Memo<RuntimeDetection>();
  private _watched: string[] = [];
  private _awaiting: string[] = [];

  /** The shared writer of this tile's entity, with this tile's write delay. */
  private get _writer(): ClimateWriter {
    const w = this._lease.get(this._config?.entity ?? '');
    w.delay = this._config?.write_delay ?? 1.5;
    w.hold = this._config?.write_hold ?? 10;
    if (this.hass && !w.hass) w.hass = this.hass;
    return w;
  }

  // ---- Lovelace API ----------------------------------------------------

  setConfig(raw: Record<string, unknown>): void {
    if (!raw || typeof raw.entity !== 'string' || !raw.entity.startsWith('climate.')) {
      throw new Error('Liquid Climate: "entity" must be a climate entity id');
    }
    const next = normalizeTileConfig(migrateConfig(raw));
    // Pending writes belong to the old entity: releasing its writer sends them.
    if (this._config && this._config.entity !== next.entity) {
      this._lease.release();
      this._detection.clear();
      this._watched = [];
      this._awaiting = [];
    }
    this._config = next;
    this._sheet()?.reconfigure(sheetConfig(next));
  }

  getGridOptions() {
    return { columns: 12, rows: 'auto', min_columns: 6 };
  }

  getCardSize(): number {
    return 2;
  }

  static async getConfigElement(): Promise<HTMLElement> {
    return document.createElement('liquid-climate-tile-editor');
  }

  static getStubConfig(hass: HomeAssistant): Record<string, unknown> {
    const entity = Object.keys(hass.states).find((id) => id.startsWith('climate.')) ?? 'climate.example';
    return { type: 'custom:liquid-climate-tile', entity, config_version: 1 };
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    // Do not lose a change the user already made: releasing the writer sends it.
    this._lease.release();
  }

  protected override shouldUpdate(changed: PropertyValues): boolean {
    // An open sheet follows every hass update, whatever this tile skips.
    const sheet = this._sheet();
    if (changed.has('hass') && sheet) sheet.hass = this.hass;
    if (changed.has('hass') && this._config && this.hass) this._writer.observe(this.hass);
    if (!changed.has('hass') || changed.size > 1 || !this._config) return true;
    const ids = this._watched.length ? this._watched : [this._config.entity];
    return hassNeedsRender(changed.get('hass') as HomeAssistant | undefined, this.hass, ids, this._awaiting);
  }

  // ---- Interaction -----------------------------------------------------

  private _context(): Ctx | null {
    const stateObj = this._config ? this.hass?.states[this._config.entity] : undefined;
    if (!stateObj || !this._config || stateObj.state === 'unavailable' || stateObj.state === 'unknown') return null;
    const caps = getCapabilities(stateObj, this._config, this.hass);
    return { stateObj, caps, view: buildView(stateObj, caps, this._writer.local) };
  }

  private _step(dir: 1 | -1) {
    const ctx = this._context();
    const next = ctx ? steppedTarget(ctx.view, ctx.caps, dir) : null;
    if (next != null) this._writer.set({ temperature: next });
  }

  private _power() {
    const ctx = this._context();
    if (ctx) this._writer.togglePower(ctx.view.mode);
  }

  private _sheet(): LiquidClimateSheet | null {
    return this.renderRoot?.querySelector('liquid-climate-sheet') ?? null;
  }

  private _openSheet(from: HTMLElement) {
    if (this._config) void this._sheet()?.open(sheetConfig(this._config), from);
  }

  private _tap(e: Event) {
    const cfg = this._config;
    if (!cfg) return;
    if (cfg.tap_action === 'sheet') this._openSheet(e.currentTarget as HTMLElement);
    else if (cfg.tap_action === 'more-info') {
      this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: cfg.entity }, bubbles: true, composed: true }));
    }
  }

  // ---- Rendering -------------------------------------------------------

  private _icon(path: string, size: number, sw: number, cls = '') {
    return svg`<svg class="i ${cls}" width=${size} height=${size} viewBox="0 0 24 24" stroke-width=${sw} aria-hidden="true"><path d=${path}></path></svg>`;
  }

  protected override render(): TemplateResult {
    const cfg = this._config;
    if (!cfg || !this.hass) return html`<article class="tile g-dark"><span class="sub">${t(this.hass, 'common.loading')}</span></article>`;
    const stateObj = this.hass.states[cfg.entity];
    const name = cfg.name || stateObj?.attributes.friendly_name || cfg.entity;
    const glassKind = resolveGlass(cfg.look.glass, this.hass);
    const glass = `g-${glassKind}`;
    const ctx = this._context();
    const view = ctx?.view;
    const mode = view?.mode ?? 'off';
    const on = !!ctx && mode !== 'off';
    const changing = this._writer.modeChanging;

    // Off shows the mode the power button would return to, muted.
    const shown = on ? mode : (powerOnMode(stateObj?.attributes.hvac_modes, rememberedMode(cfg.entity)) ?? 'off');
    const info = modeInfo(shown);
    const flicker = on && cfg.look.motion !== 'minimal' && activelyHeating(stateObj!, mode, changing);
    const canPower = !!ctx && (on ? ctx.caps.hasOff : !!powerOnMode(stateObj!.attributes.hvac_modes, rememberedMode(cfg.entity)));

    // Health: problem flags decide, error codes are only detail (same resolution as the dial and badge).
    const found = runtimeDetection(this.hass, cfg.entity, this._detection);
    this._awaiting = found.awaiting;
    const sensors = resolveSensors(this.hass, cfg, found.detection);
    this._watched = [cfg.entity, ...sensors.watched];
    const problems = sensors.problems;
    const details = [...new Set(problems.map((p) => p.detail).filter(Boolean))].join(', ');
    const problem = problems.length ? (details ? t(this.hass, 'common.errorDetail', { detail: details }) : t(this.hass, 'common.error')) : null;
    const lowBattery = sensors.battery?.low ? batteryText(this.hass, sensors.battery) : null;

    const room = roomTemperatureOf(this.hass, cfg);
    let sub: string;
    if (problem) sub = problem;
    else if (lowBattery && stateObj && ctx) sub = lowBattery;
    else if (!stateObj) sub = t(this.hass, 'common.entityNotFound', { entity: cfg.entity });
    else if (!ctx) sub = t(this.hass, 'common.unavailable');
    else {
      const word = statusWord(this.hass, stateObj, mode, changing);
      sub = room != null ? t(this.hass, 'tile.insideSub', { word, temp: `${num(this.hass, room, 1)}°` }) : word;
    }

    const dec = ctx?.caps.decimals ?? 1;
    const single = on && !!view?.hasSetpoint && !view.dual && view.target != null;
    const range = on && !!view?.dual;
    const nf = (v: number) => num(this.hass, v, dec);
    const target = single ? `${nf(view!.target!)}°` : range ? `${nf(view!.low!)}–${nf(view!.high!)}°` : '--';
    const atMin = single && view!.target! <= ctx!.caps.min;
    const atMax = single && view!.target! >= ctx!.caps.max;
    const tap = cfg.tap_action;

    const err = this._writer.error;
    const titles = html`<span class="name">${name}</span><span class="sub ${err || problem || lowBattery ? 'err' : ''}">${err ?? sub}</span>`;
    // Announced outside the buttons: a failed write first, then a health problem.
    const announce = err ? `${name}: ${err}` : problem ? `${name}: ${problem}` : lowBattery ? `${name}: ${lowBattery}` : '';
    const tint = problem ? tone(STATUS_COLORS.error, glassKind) : on ? tone(info.color, glassKind) : null;

    return html`
      <article class="tile rim ${glass}" style=${styleMap({ '--_blur': `${cfg.look.blur}px` })} aria-label=${t(this.hass, 'tile.ariaTile', { name })}>
        <button
          class="press power"
          aria-label=${t(this.hass, 'tile.power', { name })}
          aria-pressed=${on ? 'true' : 'false'}
          ?disabled=${!canPower}
          style=${styleMap({
            background: tint ? rgba(tint, TINT.tile) : undefined,
            borderColor: tint ? rgba(tint, TINT.tileEdge) : undefined,
            color: tint ? 'var(--lc-bright)' : 'var(--lc-fg2)',
          })}
          @click=${this._power}
        >
          ${this._icon(problem ? ICONS.alert : info.icon, 22, 1.9, flicker && !problem ? 'flick' : '')}
        </button>
        ${tap === 'none'
          ? html`<div class="body">${titles}</div>`
          : html`<button class="body" aria-haspopup=${tap === 'sheet' ? 'dialog' : nothing} @click=${this._tap}>${titles}</button>`}
        <div class="steps">
          ${range
            ? html`<button
                class="press target range"
                aria-haspopup="dialog"
                aria-label=${t(this.hass, 'tile.rangeAria', { range: t(this.hass, 'common.range', { low: nf(view!.low!), high: nf(view!.high!) }), unit: ctx!.caps.unit })}
                @click=${(e: Event) => this._openSheet(e.currentTarget as HTMLElement)}
              >
                ${target}
              </button>`
            : html`<button class="press step" aria-label=${t(this.hass, 'common.stepDown')} ?disabled=${!single || atMin} @click=${() => this._step(-1)}>
                  ${this._icon(ICONS.minus, 16, 2.2)}
                </button>
                <span class="target" aria-live="polite">${single ? target : html`<span aria-hidden="true">--</span>`}</span>
                <button class="press step" aria-label=${t(this.hass, 'common.stepUp')} ?disabled=${!single || atMax} @click=${() => this._step(1)}>
                  ${this._icon(ICONS.plus, 16, 2.2)}
                </button>`}
        </div>
      </article>
      <span class="sr" aria-live="polite">${announce}</span>
      <liquid-climate-sheet .hass=${this.hass}></liquid-climate-sheet>
    `;
  }

  static override styles = [
    glassTokens,
    css`
      :host {
        display: block;
      }
      .tile {
        font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
        -webkit-font-smoothing: antialiased;
        font-feature-settings: 'tnum' 1;
        position: relative;
        box-sizing: border-box;
        height: 96px;
        padding: 0 12px 0 14px;
        display: flex;
        align-items: center;
        gap: 14px;
        border-radius: var(--lc-radius, 26px);
        color: var(--lc-fg);
        background: var(--lc-bg);
        backdrop-filter: blur(var(--lc-blur, var(--_blur, 30px))) saturate(170%);
        -webkit-backdrop-filter: blur(var(--lc-blur, var(--_blur, 30px))) saturate(170%);
        border: 1px solid var(--lc-edge);
        box-shadow:
          inset 0 1px 0 var(--lc-shine),
          0 20px 40px -20px rgba(0, 0, 0, 0.6);
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
      .press:active:not(:disabled) {
        transform: scale(0.9);
      }
      .power {
        width: 50px;
        height: 50px;
        flex: none;
        border-radius: 16px;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .power:disabled {
        opacity: 0.5;
      }
      .body {
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
        padding: 0;
        border: none;
        background: none;
        text-align: left;
        border-radius: 8px;
      }
      .name {
        font-size: 16px;
        font-weight: 600;
        letter-spacing: -0.01em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sub {
        font-size: 13px;
        color: var(--lc-fg2);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sub.err {
        color: var(--lc-warn);
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
      .steps {
        display: flex;
        align-items: center;
        gap: 2px;
        flex: none;
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
      .step:disabled {
        opacity: 0.3;
      }
      .target {
        width: 64px;
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
      .flick {
        animation: lcFlick 2.4s ease-in-out infinite;
        transform-origin: 50% 90%;
      }
      @keyframes lcFlick {
        0%,
        100% {
          transform: scale(1) rotate(0);
        }
        30% {
          transform: scale(1.06, 0.97) rotate(-3deg);
        }
        60% {
          transform: scale(0.97, 1.05) rotate(3deg);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .flick {
          animation: none;
        }
        .press {
          transition: none;
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'liquid-climate-tile': LiquidClimateTile;
  }
}
