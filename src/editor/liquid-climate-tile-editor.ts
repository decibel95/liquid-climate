import { html, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { defaultConfig, normalizeTileConfig, type LiquidClimateConfig, type TapAction, type TileConfig } from '../config';
import { migrateConfig } from '../migrate';
import { LiquidClimateCardEditor } from './liquid-climate-card-editor';

/** Tile editor: the dial editor's setup, write delay and look, plus what a tap does. */
@customElement('liquid-climate-tile-editor')
export class LiquidClimateTileEditor extends LiquidClimateCardEditor {
  protected override _card = 'tile';

  override setConfig(raw: Record<string, unknown>): void {
    this._config = normalizeTileConfig(migrateConfig(raw ?? {}));
  }

  protected override _defaults(entity: string): Record<string, unknown> {
    return { ...defaultConfig(entity), type: 'custom:liquid-climate-tile', tap_action: 'sheet' };
  }

  protected override render(): TemplateResult {
    const cfg = this._config as TileConfig | undefined;
    if (!cfg || !this.hass) return html``;
    return html`
      <div class="body">
        ${this._head('entity', 'editor.tabSetup')}
        ${this._setup(cfg)}
        ${this._seg<TapAction>(
          this._t('editor.tapOnName'),
          [
            ['sheet', this._t('editor.tapDial')],
            ['more-info', this._t('editor.tapMoreInfo')],
            ['none', this._t('editor.tapNothing')],
          ],
          cfg.tap_action,
          (v) => this._fire((c) => ({ ...c, tap_action: v }) as LiquidClimateConfig),
          this._help('tap-action', 'editor.tapOnName'),
        )}
        ${this._writeDelay(cfg)}
        ${this._head('look', 'editor.tabLook')}
        ${this._look(cfg)}
        <span class="hint">${this._t('editor.tileHint')}</span>
      </div>
      ${this._footer()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'liquid-climate-tile-editor': LiquidClimateTileEditor;
  }
}
