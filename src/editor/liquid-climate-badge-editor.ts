import { html, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { defaultConfig, normalizeBadgeConfig, type BadgeConfig, type LiquidClimateConfig, type TapAction } from '../config';
import { migrateConfig } from '../migrate';
import { LiquidClimateCardEditor } from './liquid-climate-card-editor';

const PAUSE_DOMAINS = ['binary_sensor.', 'input_boolean.', 'switch.'];

/** Badge editor: entity, name and room sensor from the dial editor, plus the badge options. */
@customElement('liquid-climate-badge-editor')
export class LiquidClimateBadgeEditor extends LiquidClimateCardEditor {
  protected override _card = 'badge';

  override setConfig(raw: Record<string, unknown>): void {
    this._config = normalizeBadgeConfig(migrateConfig(raw ?? {}));
  }

  protected override _defaults(entity: string): Record<string, unknown> {
    return { ...defaultConfig(entity), type: 'custom:liquid-climate-badge', tap_action: 'more-info', icon_only: false };
  }

  private _patch(extra: Partial<BadgeConfig>) {
    this._fire((c) => ({ ...c, ...extra }) as LiquidClimateConfig);
  }

  protected override render(): TemplateResult {
    const cfg = this._config as BadgeConfig | undefined;
    if (!cfg || !this.hass) return html``;
    const pauseIds = Object.keys(this.hass.states).filter((id) => PAUSE_DOMAINS.some((d) => id.startsWith(d)));
    return html`
      <div class="body">
        ${this._head('entity', 'editor.tabSetup')}
        ${this._setup(cfg)}
        <div class="field">
          <div class="lblrow"><span class="lbl" id="lc-pause-label">${this._t('editor.pauseEntity')}</span>${this._help('pause', 'editor.pauseEntity')}</div>
          <input
            type="text"
            aria-labelledby="lc-pause-label"
            list="lc-pause-ids"
            .value=${cfg.pause_entity ?? ''}
            placeholder="binary_sensor.window"
            @change=${(e: Event) => this._patch({ pause_entity: (e.target as HTMLInputElement).value.trim() || undefined })}
          />
          <datalist id="lc-pause-ids">${pauseIds.map((id) => html`<option value=${id}></option>`)}</datalist>
          <span class="hint">${this._t('editor.pauseHint')}</span>
        </div>
        <div class="row">
          <span class="grow name">${this._t('editor.iconOnly')}</span>
          <button
            class="sw ${cfg.icon_only ? 'on' : ''}"
            role="switch"
            aria-checked=${cfg.icon_only ? 'true' : 'false'}
            aria-label=${this._t('editor.iconOnly')}
            @click=${() => this._patch({ icon_only: !cfg.icon_only })}
          >
            <span></span>
          </button>
        </div>
        ${this._seg<TapAction>(
          this._t('editor.tap'),
          [
            ['more-info', this._t('editor.tapMoreInfo')],
            ['sheet', this._t('editor.tapDial')],
            ['none', this._t('editor.tapNothing')],
          ],
          cfg.tap_action,
          (v) => this._patch({ tap_action: v }),
          this._help('tap-action', 'editor.tap'),
        )}
        ${this._head('look', 'editor.tabLook')}
        ${this._look(cfg)}
      </div>
      ${this._footer()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'liquid-climate-badge-editor': LiquidClimateBadgeEditor;
  }
}
