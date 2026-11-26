import { LiquidSheetBase } from '@decibel95/liquid-core/sheet';
import { css } from 'lit';
import { customElement } from 'lit/decorators.js';
import type { LiquidClimateConfig } from '../../config';
import { t } from '../../i18n';
import '../dial/liquid-climate-card';
import type { LiquidClimateCard } from '../dial/liquid-climate-card';

/**
 * The dial card in a modal sheet. A native <dialog> opened with showModal() sits in the
 * top layer, so transforms and backdrop filters on HA's own ancestors cannot clip it.
 * The dial only exists while the sheet is open; closing it removes the dial, which sends
 * any change still waiting in its write queue.
 *
 * The sheet itself lives in liquid-core; this class supplies the dial. It never sets
 * `historyEntityId`: the dial has its own history button, which closes the sheet first.
 */
@customElement('liquid-climate-sheet')
export class LiquidClimateSheet extends LiquidSheetBase<LiquidClimateConfig> {
  constructor() {
    super();
    // The dial leaves the page (its history button): close now, before it navigates.
    this.addEventListener('liquid-climate-close', (e) => {
      e.stopPropagation();
      this.close();
    });
  }

  protected override createContent(): HTMLElement {
    return document.createElement('liquid-climate-card');
  }

  protected override applyConfig(content: HTMLElement, config: LiquidClimateConfig): void {
    (content as LiquidClimateCard).setConfig(config as unknown as Record<string, unknown>);
  }

  protected override tr(key: string, vars?: Record<string, string | number>): string {
    return key === 'core.close' ? t(this.hass, 'common.close') : super.tr(key, vars);
  }

  // Appended last: the same size as core's `.close, .history` rule, kept as its own `.close` rule
  // (the tile test reads the Close size from it). Redundant, so the order cannot change a pixel.
  static override styles = [
    ...LiquidSheetBase.styles,
    css`
      .close {
        width: 44px;
        height: 44px;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'liquid-climate-sheet': LiquidClimateSheet;
  }
}
