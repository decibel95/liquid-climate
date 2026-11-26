import { LitElement, css, html, nothing, svg, unsafeCSS, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';
import { normalizeBadgeConfig, sheetConfig, type BadgeConfig } from '../../config';
import { migrateConfig } from '../../migrate';
import { Memo } from '../../detect/cache';
import { isPaused, resolveSensors } from '../../detect/resolve';
import { runtimeDetection, type RuntimeDetection } from '../../detect/runtime';
import type { Detection } from '../../detect/roles';
import { DOT_RING, resolveGlass } from '../../ui/glass';
import { glassTokens } from '../../ui/glass-styles';
import { ICONS, STATUS_COLORS, TINT, entityModeInfo, modeVerb, rgba, tone } from '../../ui/modes';
import { num, numAuto, t } from '../../i18n';
import { ENTITY_ERROR, domainOf, isSupportedEntity } from '../../domain';
import { statusWord } from '../shared/status';
import type { HomeAssistant } from '../../types';
import { hassNeedsRender } from '../shared/render-gate';
import '../shared/sheet';
import type { LiquidClimateSheet } from '../shared/sheet';

export type BadgeKind = 'error' | 'paused' | 'battery' | 'unavailable' | 'off' | 'on';

export interface BadgeState {
  kind: BadgeKind;
  value: string;
  color: string;
  icon: string;
  /** Error, paused and a low battery ask for attention: the icon-only badge shows a pulsing dot. */
  attention: boolean;
  /** Every entity id the state reads, for change detection. */
  watched: string[];
}

/**
 * What the badge shows, by priority: a health problem (problem flags decide, error codes
 * are detail only), then paused (the pause entity, else a window contact of the device),
 * then unavailable, then a low battery (it replaces the room temperature), then off, then the room temperature.
 */
export function badgeState(hass: HomeAssistant, cfg: BadgeConfig, detection: Detection): BadgeState {
  const s = hass.states[cfg.entity];
  const sensors = resolveSensors(hass, cfg, detection);
  const watched = [cfg.entity, ...sensors.watched, ...(cfg.pause_entity ? [cfg.pause_entity] : [])];
  const base = { watched };
  if (sensors.problems.length) {
    return { ...base, kind: 'error', value: t(hass, 'common.error'), color: STATUS_COLORS.error, icon: ICONS.alert, attention: true };
  }
  if (isPaused(hass, cfg.pause_entity, sensors.windowOpen)) {
    return { ...base, kind: 'paused', value: t(hass, 'common.paused'), color: STATUS_COLORS.paused, icon: ICONS.door, attention: true };
  }
  if (!s || s.state === 'unavailable' || s.state === 'unknown') {
    return { ...base, kind: 'unavailable', value: '--', color: STATUS_COLORS.off, icon: ICONS.power, attention: false };
  }
  if (sensors.battery?.low) {
    return { ...base, kind: 'battery', value: t(hass, 'common.batteryLow'), color: STATUS_COLORS.paused, icon: ICONS.alert, attention: true };
  }
  if (s.state === 'off') {
    return { ...base, kind: 'off', value: t(hass, 'common.off'), color: STATUS_COLORS.off, icon: ICONS.power, attention: false };
  }
  const info = entityModeInfo(s, s.state);
  const room = sensors.roomTemperature;
  const domain = domainOf(s.entity_id);
  // The current figure with its unit: 21.4° for a room or a tank, 45% for a humidifier.
  const figure = room == null ? null : domain === 'humidifier' ? `${numAuto(hass, room, 1)}%` : `${num(hass, room, 1)}°`;
  return {
    ...base,
    kind: 'on',
    value: figure ?? (domain === 'climate' ? modeVerb(hass, s.state) : statusWord(hass, s, s.state, false)),
    color: info.color,
    icon: info.icon,
    attention: false,
  };
}

/** Glass status pill for a climate entity, usable as a view badge and as a card. */
@customElement('liquid-climate-badge')
export class LiquidClimateBadge extends LitElement {
  @property({ attribute: false }) hass!: HomeAssistant;
  /** Set by HA while the badge is shown in the badge editor. */
  @property({ type: Boolean }) preview = false;
  @state() private _config?: BadgeConfig;
  private _detection = new Memo<RuntimeDetection>();
  private _watched: string[] = [];
  private _awaiting: string[] = [];

  setConfig(raw: Record<string, unknown>): void {
    if (!raw || !isSupportedEntity(raw.entity)) throw new Error(ENTITY_ERROR);
    this._config = normalizeBadgeConfig(migrateConfig(raw));
    this._sheet()?.reconfigure(sheetConfig(this._config));
    this._detection.clear();
    this._watched = [];
    this._awaiting = [];
  }

  getGridOptions() {
    return { columns: 4, rows: 1, min_columns: 2 };
  }

  getCardSize(): number {
    return 1;
  }

  static async getConfigElement(): Promise<HTMLElement> {
    return document.createElement('liquid-climate-badge-editor');
  }

  static getStubConfig(hass: HomeAssistant): Record<string, unknown> {
    const entity = Object.keys(hass.states).find((id) => id.startsWith('climate.')) ?? 'climate.example';
    return { type: 'custom:liquid-climate-badge', entity, config_version: 1 };
  }

  protected override shouldUpdate(changed: PropertyValues): boolean {
    const sheet = this._sheet();
    if (changed.has('hass') && sheet) sheet.hass = this.hass;
    if (!changed.has('hass') || changed.size > 1 || !this._config) return true;
    const ids = this._watched.length ? this._watched : [this._config.entity];
    return hassNeedsRender(changed.get('hass') as HomeAssistant | undefined, this.hass, ids, this._awaiting);
  }

  private _sheet(): LiquidClimateSheet | null {
    return this.renderRoot?.querySelector('liquid-climate-sheet') ?? null;
  }

  private _tap(e: Event) {
    const cfg = this._config;
    if (!cfg) return;
    if (cfg.tap_action === 'sheet') void this._sheet()?.open(sheetConfig(cfg), e.currentTarget as HTMLElement);
    else if (cfg.tap_action === 'more-info') {
      this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: cfg.entity }, bubbles: true, composed: true }));
    }
  }

  protected override render(): TemplateResult {
    const cfg = this._config;
    if (!cfg || !this.hass) return html``;
    const r = runtimeDetection(this.hass, cfg.entity, this._detection);
    this._awaiting = r.awaiting;
    const st = badgeState(this.hass, cfg, r.detection);
    this._watched = st.watched;
    const name = cfg.name || this.hass.states[cfg.entity]?.attributes.friendly_name || cfg.entity;
    const glassKind = resolveGlass(cfg.look.glass, this.hass, this);
    const glass = `g-${glassKind}`;
    const color = tone(st.color, glassKind);
    const tint = rgba(color, TINT.badge);
    const label = t(this.hass, 'badge.label', { name, value: st.value });
    const cls = `badge rim ${glass} m-${cfg.look.motion} ${cfg.icon_only ? 'round' : 'pill'} k-${st.kind}`;
    const style = styleMap({
      '--_blur': `${cfg.look.blur}px`,
      // Icon only: the whole circle carries the status colour, layered over the glass base.
      backgroundImage: cfg.icon_only ? `linear-gradient(${tint}, ${tint})` : undefined,
    });

    const icon = html`<span class="ic" style=${styleMap({ backgroundColor: cfg.icon_only ? undefined : tint })}
      >${svg`<svg class="i" viewBox="0 0 24 24" stroke-width="2" aria-hidden="true"><path d=${st.icon}></path></svg>`}</span
    >`;
    const extra = cfg.icon_only
      ? st.attention
        ? html`<span class="dot" aria-hidden="true" style=${styleMap({ backgroundColor: color })}></span>`
        : nothing
      : html`<span class="txt" aria-hidden="true"><span class="n">${name}</span><span class="v">${st.value}</span></span>`;

    // The wrapper (display: contents) keeps every part inside an element, never at the template's top level.
    return html`<div class="wrap"
      >${cfg.tap_action === 'none'
        ? html`<div class=${cls} style=${style} role="img" aria-label=${label}>${icon}${extra}</div>`
        : html`<button class=${cls} style=${style} aria-label=${label} aria-haspopup=${cfg.tap_action === 'sheet' ? 'dialog' : nothing} @click=${this._tap}>${icon}${extra}</button>`}<liquid-climate-sheet
        .hass=${this.hass}
      ></liquid-climate-sheet
    ></div>`;
  }

  static override styles = [
    glassTokens,
    css`
      :host {
        display: inline-block;
        max-width: 100%;
      }
      .wrap {
        display: contents;
      }
      .g-dark {
        --lc-ring: ${unsafeCSS(DOT_RING.dark)};
      }
      .g-light {
        --lc-ring: ${unsafeCSS(DOT_RING.light)};
      }
      /* Sizes follow HA's own badge (ha-badge), through its theme tokens. */
      .badge {
        --_size: var(--ha-badge-size, 36px);
        font: inherit;
        font-family: 'Liquid Inter', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
        -webkit-font-smoothing: antialiased;
        font-feature-settings: 'tnum' 1;
        position: relative;
        box-sizing: border-box;
        height: var(--_size);
        min-width: var(--_size);
        margin: 0;
        display: flex;
        align-items: center;
        color: var(--lc-fg);
        background-color: var(--lc-bg);
        backdrop-filter: blur(var(--lc-blur, var(--_blur, 22px))) saturate(180%);
        -webkit-backdrop-filter: blur(var(--lc-blur, var(--_blur, 22px))) saturate(180%);
        border: 1px solid var(--lc-edge);
        border-radius: var(--ha-badge-border-radius, calc(var(--ha-badge-size, 36px) / 2));
        box-shadow:
          inset 0 1px 0 var(--lc-shine),
          0 12px 28px -14px rgba(0, 0, 0, 0.6);
        text-align: left;
      }
      button.badge {
        cursor: pointer;
      }
      button.badge:focus-visible {
        outline: 2px solid var(--lc-bright);
        outline-offset: 2px;
      }
      .pill {
        max-width: 100%;
        padding: 0 12px;
        gap: var(--ha-space-2, 8px);
      }
      .round {
        width: var(--_size);
        padding: 0;
        justify-content: center;
      }
      .ic {
        flex: none;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--lc-bright);
      }
      .ic svg {
        width: var(--ha-badge-icon-size, 18px);
        height: var(--ha-badge-icon-size, 18px);
      }
      /* The tinted circle sits 4px inside the badge edge, like HA pulls its icon in. */
      .pill .ic {
        width: calc(var(--_size) - 8px);
        height: calc(var(--_size) - 8px);
        margin-inline-start: -8px;
        border-radius: 50%;
      }
      .txt {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .n {
        font-size: var(--ha-font-size-xs, 10px);
        font-weight: var(--ha-font-weight-medium, 500);
        line-height: 10px;
        letter-spacing: 0.1px;
        color: var(--lc-fg2);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .v {
        font-size: var(--ha-badge-font-size, var(--ha-font-size-s, 12px));
        font-weight: var(--ha-font-weight-medium, 500);
        line-height: var(--ha-line-height-condensed, 1.2);
        letter-spacing: 0.1px;
        white-space: nowrap;
      }
      .dot {
        position: absolute;
        right: 1px;
        top: 1px;
        width: 8px;
        height: 8px;
        box-sizing: content-box;
        border-radius: 50%;
        box-shadow: 0 0 0 2px var(--lc-ring);
        animation: lcDot 2.4s ease-in-out infinite;
      }
      @keyframes lcDot {
        0%,
        100% {
          opacity: 0.5;
          transform: scale(0.85);
        }
        50% {
          opacity: 1;
          transform: scale(1.1);
        }
      }
      .m-minimal .dot {
        animation: none;
      }
      @media (prefers-reduced-motion: reduce) {
        .dot {
          animation: none;
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'liquid-climate-badge': LiquidClimateBadge;
  }
}
