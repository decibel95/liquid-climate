import { LitElement, css, html, nothing, render, svg, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { LiquidClimateConfig } from '../../config';
import { resolveGlass } from '../../ui/glass';
import { glassTokens } from '../../ui/glass-styles';
import { ICONS } from '../../ui/modes';
import { t } from '../../i18n';
import type { HomeAssistant } from '../../types';
import '../dial/liquid-climate-card';
import type { LiquidClimateCard } from '../dial/liquid-climate-card';

/**
 * The dial card in a modal sheet. A native <dialog> opened with showModal() sits in the
 * top layer, so transforms and backdrop filters on HA's own ancestors cannot clip it.
 * The dial only exists while the sheet is open; closing it removes the dial, which sends
 * any change still waiting in its write queue.
 */
@customElement('liquid-climate-sheet')
export class LiquidClimateSheet extends LitElement {
  @property({ attribute: false }) hass?: HomeAssistant;
  @state() private _card?: LiquidClimateCard;
  @state() private _config?: LiquidClimateConfig;
  private _returnTo?: HTMLElement | null;

  get isOpen(): boolean {
    return !!this._card;
  }

  /** Open the dial for `config`. Focus goes back to `returnTo` when the sheet closes. */
  async open(config: LiquidClimateConfig, returnTo?: HTMLElement | null): Promise<void> {
    if (!this.hass || this._card) return;
    // A dialog left open without being modal (shown some other way) must close before showModal.
    const stale = this._dialog();
    if (stale?.open && !isModal(stale)) stale.close();
    const card = document.createElement('liquid-climate-card');
    card.setConfig(config as unknown as Record<string, unknown>);
    card.hass = this.hass;
    // Close sits in the dial's own header, next to its power button, inside the glass.
    render(
      html`<button class="close" slot="header-action" aria-label=${t(this.hass, 'common.close')} autofocus @click=${() => this.close()}>
        ${svg`<svg class="i" width="18" height="18" viewBox="0 0 24 24" stroke-width="2" aria-hidden="true"><path d=${ICONS.close}></path></svg>`}
      </button>`,
      card,
    );
    this._returnTo = returnTo;
    this._config = config;
    this._card = card;
    await this.updateComplete;
    const dialog = this._dialog();
    if (dialog && !dialog.open) dialog.showModal();
    // The dialog would focus the first focusable in the composed tree, the dial's power button,
    // where Enter right after opening would switch the unit. Start on Close instead.
    await card.updateComplete;
    if (this._card === card) card.querySelector<HTMLButtonElement>('button.close')?.focus();
  }

  /** The owning card's config changed: the open dial follows it. */
  reconfigure(config: LiquidClimateConfig): void {
    if (!this._card) return;
    this._config = config;
    this._card.setConfig(config as unknown as Record<string, unknown>);
  }

  close(): void {
    const dialog = this._dialog();
    if (dialog?.open) dialog.close();
    // Remove the dial now: the close event may arrive later, or not at all on some paths.
    this._closed();
  }

  private _dialog(): HTMLDialogElement | null {
    return this.renderRoot?.querySelector('dialog') ?? null;
  }

  private _closed = () => {
    if (!this._card) return;
    this._card = undefined;
    const to = this._returnTo;
    this._returnTo = undefined;
    to?.focus();
  };

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('hass') && this._card && this.hass) this._card.hass = this.hass;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    // Removed while open: close the dialog so the next open() starts modal, and focus nowhere.
    this._returnTo = undefined;
    const dialog = this._dialog();
    if (dialog?.open) dialog.close();
    this._card = undefined;
  }

  private _onCancel = (e: Event) => {
    // Escape: close through the same path as the button so focus returns.
    e.preventDefault();
    this.close();
  };

  private _onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    }
  };

  /** A click that lands on the dialog itself, not its content, is a click on the backdrop. */
  private _onClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) this.close();
  };

  protected override render() {
    const cfg = this._config;
    const glass = cfg && this.hass ? resolveGlass(cfg.look.glass, this.hass, this) : 'dark';
    const name = cfg?.name || (cfg && this.hass?.states[cfg.entity]?.attributes.friendly_name) || cfg?.entity || '';
    return html`<dialog
      class="g-${glass} m-${cfg?.look.motion ?? 'rich'}"
      aria-label=${name}
      @cancel=${this._onCancel}
      @close=${this._closed}
      @keydown=${this._onKey}
      @click=${this._onClick}
    >
      ${this._card
        ? html`<div class="frame">${this._card}</div>`
        : nothing}
    </dialog>`;
  }

  static override styles = [
    glassTokens,
    css`
      :host {
        display: contents;
      }
      dialog {
        box-sizing: border-box;
        width: min(444px, calc(100vw - 24px));
        max-width: none;
        max-height: calc(100dvh - 24px);
        margin: auto;
        /* Only the dial's rounded glass shows: the dialog box itself paints nothing. */
        padding: 0;
        border: none;
        outline: none;
        box-shadow: none;
        background: transparent;
        color: var(--lc-fg);
        overflow: auto;
        overscroll-behavior: contain;
      }
      dialog:focus,
      dialog:focus-visible {
        outline: none;
      }
      /* The dialog clips its overflow, so the dial's drop shadow would show as a square. */
      liquid-climate-card {
        --lc-drop: 0 0 0 transparent;
      }
      dialog::backdrop {
        background: rgba(0, 0, 0, 0.45);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
      }
      @media (prefers-reduced-transparency: reduce) {
        dialog::backdrop {
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: none;
          -webkit-backdrop-filter: none;
        }
      }
      dialog[open] {
        animation: lcSheetIn 0.32s cubic-bezier(0.3, 1.3, 0.5, 1);
      }
      dialog.m-minimal[open] {
        animation: none;
      }
      @keyframes lcSheetIn {
        from {
          opacity: 0;
          transform: translateY(16px) scale(0.98);
        }
        to {
          opacity: 1;
          transform: none;
        }
      }
      .frame {
        display: block;
      }
      /* Slotted into the dial header: it inherits the dial's glass tokens, like its power button. */
      .close {
        width: 44px;
        height: 44px;
        flex: none;
        margin: 0;
        padding: 0;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font: inherit;
        color: var(--lc-fg);
        cursor: pointer;
        background: var(--lc-btn);
        border: 1px solid var(--lc-btn-edge);
      }
      .close:focus-visible {
        outline: 2px solid var(--lc-bright);
        outline-offset: 2px;
      }
      @media (prefers-reduced-motion: reduce) {
        dialog[open] {
          animation: none;
        }
      }
    `,
  ];
}

function isModal(d: HTMLDialogElement): boolean {
  try {
    return d.matches(':modal');
  } catch {
    // Engines without :modal: treat as not modal, so the dialog is reopened modal.
    return false;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'liquid-climate-sheet': LiquidClimateSheet;
  }
}
