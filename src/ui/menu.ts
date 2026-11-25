import { css, html, nothing, type TemplateResult } from 'lit';
import { callEntityService, type RowCalls } from '../cards/shared/service';
import { hasMenu, type StatusItem } from '../config';
import { t } from '../i18n';
import type { HassEntity, HomeAssistant } from '../types';

const domainOf = (id: string) => id.split('.')[0];
const objectId = (id: string) => id.slice(id.indexOf('.') + 1);

const isGone = (e: HassEntity | undefined) => !e || e.state === 'unavailable';
const nameOf = (e: HassEntity | undefined, id: string) => String(e?.attributes.friendly_name || id);
const optionsOf = (e: HassEntity | undefined): string[] => (Array.isArray(e?.attributes.options) ? e!.attributes.options.map(String) : []);

/** The row's actions that exist in Home Assistant (a missing id is skipped), without the row itself. */
export function liveActions(hass: HomeAssistant, item: StatusItem): string[] {
  return (item.actions ?? []).filter((id) => id !== item.entity && !!hass.states[id]);
}

/** Whether the menu has anything of its own to show: a value control or an existing action. Details alone does not count. */
export function menuHasContent(hass: HomeAssistant, item: StatusItem): boolean {
  const row = hass.states[item.entity];
  if (!row) return false;
  const domain = domainOf(item.entity);
  const value =
    domain === 'input_select' || domain === 'select'
      ? optionsOf(row).length > 0
      : ['input_boolean', 'switch', 'automation', 'script'].includes(domain);
  return value || liveActions(hass, item).length > 0;
}

/** The row opens a menu: wanted by the config and with something to show, else it is a plain more-info row. */
export const menuVisible = (hass: HomeAssistant, item: StatusItem): boolean => hasMenu(item) && menuHasContent(hass, item);

/** Editor route of a script or automation, or null when it cannot be told (an automation without an id). */
export function editPath(hass: HomeAssistant, entityId: string): string | null {
  const domain = domainOf(entityId);
  if (domain === 'script') return `/config/script/edit/${objectId(entityId)}`;
  if (domain === 'automation') {
    const id = hass.states[entityId]?.attributes.id;
    return id ? `/config/automation/edit/${id}` : null;
  }
  return null;
}

/** Same as Home Assistant's navigate helper. */
export function navigate(path: string): void {
  history.pushState(null, '', path);
  window.dispatchEvent(new Event('location-changed', { bubbles: true, composed: true }));
}

/** Home Assistant's history page for one entity (liquid-core's helper, same pushState and location-changed as HA's own navigate). */
export { openHistory } from '@decibel95/liquid-core';

export interface MenuContext {
  hass: HomeAssistant;
  item: StatusItem;
  /** Position of the row in the card: panel id, and the key of its pending and error state. */
  index: number;
  calls: RowCalls;
  moreInfo: (entityId: string) => void;
}

/** The dom id of a row's panel, for aria-controls. */
export const panelId = (index: number) => `lc-menu-${index}`;

/** The inline panel under a status row. Always rendered, so closing can animate. */
export function renderMenuPanel(ctx: MenuContext, open: boolean): TemplateResult {
  const { hass, item, calls } = ctx;
  const row = item.entity;
  const key = String(ctx.index);
  const rowState = hass.states[row];
  const rowDomain = domainOf(row);
  const actions = liveActions(hass, item);
  const scripts = actions.filter((id) => domainOf(id) === 'script');
  const automations = actions.filter((id) => domainOf(id) === 'automation');
  const label = item.name || nameOf(rowState, row);
  const admin = !!hass.user?.is_admin;
  const running = [...(rowDomain === 'script' ? [row] : []), ...scripts].some((id) => hass.states[id]?.state === 'on');

  /** A 44px pencil button next to an item, for admins, when the editor route is known. */
  const withEdit = (id: string, name: string, main: TemplateResult): TemplateResult => {
    const path = admin ? editPath(hass, id) : null;
    if (!path) return main;
    return html`<div class="mrow">
      ${main}
      <button class="mitem medit" aria-label=${t(hass, 'menu.editLabel', { name })} title=${t(hass, 'menu.editLabel', { name })} @click=${() => navigate(path)}>
        <ha-icon icon="mdi:pencil" aria-hidden="true"></ha-icon>
      </button>
    </div>`;
  };

  const call = (control: string, domain: string, service: string, data: Record<string, unknown>) =>
    calls.run(key, control, () => callEntityService(hass, domain, service, data));
  const busy = (control: string) => calls.isPending(key, control);
  const guard = (control: string, go: () => void) => () => {
    if (!busy(control)) go();
  };

  const hint = (text: string) => html`<span class="mhint">${text}</span>`;

  let value: TemplateResult | typeof nothing = nothing;
  if (rowDomain === 'input_select' || rowDomain === 'select') {
    const options = optionsOf(rowState);
    const gone = isGone(rowState);
    // One Tab stop for the group: the checked option, or the first when none is checked.
    const stop = Math.max(0, options.indexOf(rowState?.state ?? ''));
    value = html`<div class="msec">
      ${options.length
        ? html`<div class="mgroup" role="radiogroup" aria-label=${label}>
        ${options.map((o, i) => {
          const control = `opt:${o}`;
          return html`<button
            class="mitem"
            role="radio"
            tabindex=${i === stop ? '0' : '-1'}
            aria-checked=${rowState?.state === o ? 'true' : 'false'}
            aria-busy=${busy(control) ? 'true' : 'false'}
            aria-disabled=${busy(control) || gone ? 'true' : nothing}
            @click=${() => {
              if (gone) return;
              guard(control, () => void call(control, rowDomain, 'select_option', { entity_id: row, option: o }))();
            }}
          >
            <span class="mlabel">${rowState && rowDomain === 'select' ? hass.formatEntityState?.(rowState, o) || o : o}</span>
            ${busyText(hass, busy(control))}
            <svg class="mcheck" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg>
          </button>`;
        })}
      </div>`
        : nothing}
      ${gone ? hint(t(hass, 'menu.unavailable')) : nothing}
    </div>`;
  } else if (rowDomain === 'input_boolean' || rowDomain === 'switch') {
    value = html`<div class="msec">${switchItem(ctx, row, label, 'value', rowDomain)}</div>`;
  } else if (rowDomain === 'automation') {
    value = html`<div class="msec">${withEdit(row, label, switchItem(ctx, row, label, 'value', 'automation'))}</div>`;
  } else if (rowDomain === 'script') {
    value = html`<div class="msec">${withEdit(row, label, scriptItem(ctx, row, 'value', item.name))}</div>`;
  }

  const scriptList = scripts.length
    ? html`<div class="msec">
        <div class="mhead">${t(hass, 'menu.scripts')}</div>
        ${scripts.map((id) => withEdit(id, nameOf(hass.states[id], id), scriptItem(ctx, id, id)))}
      </div>`
    : nothing;

  const autoList = automations.length
    ? html`<div class="msec">
        <div class="mhead">${t(hass, 'menu.automations')}</div>
        ${automations.map((id) => {
          const name = nameOf(hass.states[id], id);
          return withEdit(id, name, switchItem(ctx, id, name, id, 'automation'));
        })}
      </div>`
    : nothing;

  return html`<div class="mwrap">
    <div class="mclip">
      <div
        class="mpanel"
        id=${panelId(ctx.index)}
        role="group"
        aria-label=${t(hass, 'menu.panelLabel', { name: label })}
        aria-busy=${calls.rowBusy(key) ? 'true' : 'false'}
        ?inert=${!open}
      >
        ${value} ${scriptList} ${autoList}
        <div class="mfoot">
          <button class="mitem mlink" @click=${() => ctx.moreInfo(row)}>${t(hass, 'menu.details')}</button>
        </div>
        <div class="merr" role="status" aria-live="polite">${calls.hasError(key) ? t(hass, 'menu.error') : ''}</div>
      </div>
      <div class="vh" role="status" aria-live="polite" aria-atomic="true">${running ? t(hass, 'menu.runningAnnounce') : ''}</div>
    </div>
  </div>`;
}

const busyText = (hass: HomeAssistant, pending: boolean) => (pending ? html`<span class="vh">${t(hass, 'menu.updating')}</span>` : nothing);

const PLAY = 'M8 5.5v13l11-6.5z';

function scriptItem(ctx: MenuContext, id: string, control: string, name?: string): TemplateResult {
  const { hass, calls } = ctx;
  const key = String(ctx.index);
  const e = hass.states[id];
  const gone = isGone(e);
  const pending = calls.isPending(key, control);
  const label = name || nameOf(e, id);
  // Run is an action pill with a play icon; Running is a filled pill with a dot; a dead script is a plain hint.
  const state = gone
    ? html`<span class="mhint">${t(hass, 'menu.unavailable')}</span>`
    : e?.state === 'on'
      ? html`<span class="mrun running"><span class="mdot" aria-hidden="true"></span>${t(hass, 'menu.running')}</span>`
      : html`<span class="mrun"
          ><svg class="mplay" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d=${PLAY}></path></svg>${t(hass, 'menu.run')}</span
        >`;
  return html`<button
    class="mitem"
    aria-busy=${pending ? 'true' : 'false'}
    aria-disabled=${pending || gone ? 'true' : nothing}
    @click=${() => {
      if (pending || gone) return;
      void calls.run(key, control, () => callEntityService(hass, 'script', 'turn_on', { entity_id: id }));
    }}
  >
    <span class="mlabel" title=${label}>${label}</span>
    ${busyText(hass, pending)} ${state}
  </button>`;
}

function switchItem(ctx: MenuContext, id: string, label: string, control: string, domain: string): TemplateResult {
  const { hass, calls } = ctx;
  const key = String(ctx.index);
  const e = hass.states[id];
  const gone = isGone(e);
  const on = e?.state === 'on';
  const pending = calls.isPending(key, control);
  return html`<button
    class="mitem mswitch"
    role="switch"
    aria-checked=${on ? 'true' : 'false'}
    aria-label=${label}
    aria-busy=${pending ? 'true' : 'false'}
    aria-disabled=${pending || gone ? 'true' : nothing}
    @click=${() => {
      if (pending || gone) return;
      void calls.run(key, control, () => callEntityService(hass, domain, on ? 'turn_off' : 'turn_on', { entity_id: id }));
    }}
  >
    <span class="mlabel" title=${label}>${label}</span>
    ${busyText(hass, pending)} ${gone ? html`<span class="mhint">${t(hass, 'menu.unavailable')}</span>` : nothing}
    <span class="mtrack" aria-hidden="true"><span class="mthumb"></span></span>
  </button>`;
}

/**
 * Keys inside an open row (the row button and its panel): arrows, Home and End move focus
 * between the panel's controls, Escape closes and returns to the row button.
 */
export function handleMenuKey(e: KeyboardEvent, wrap: HTMLElement, close: () => void): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    // close() brings focus back to the row button when it was inside the panel.
    close();
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  const target = e.target as HTMLElement;
  // Inside a radio group the arrows move focus within the group only. They never select:
  // every select_option is a write, and on a cloud device each write costs API budget, so
  // an option is chosen on Space, Enter or click, not on arrow movement (a deliberate
  // deviation from the ARIA radio pattern).
  const group = target.closest?.('[role=radiogroup]');
  if (group && target.getAttribute('role') === 'radio') {
    const radios = [...group.querySelectorAll<HTMLElement>('[role=radio]')];
    const at = radios.indexOf(target);
    const to =
      e.key === 'Home' ? 0 : e.key === 'End' ? radios.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + radios.length) % radios.length;
    e.preventDefault();
    // Roving tabindex follows focus, so Shift+Tab leaves the group from where the user is.
    radios.forEach((r, k) => r.setAttribute('tabindex', k === to ? '0' : '-1'));
    radios[to].focus();
    return;
  }
  // Elsewhere: across the panel's tab stops (a radio group counts once).
  const items = [...wrap.querySelectorAll<HTMLElement>('.mitem:not([tabindex="-1"])')];
  if (!items.length) return;
  const at = items.indexOf(target);
  let next: number;
  if (at < 0) {
    // On the row button: Down or Home enter the panel, Up or End go to its last control.
    next = e.key === 'ArrowDown' || e.key === 'Home' ? 0 : items.length - 1;
  } else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = items.length - 1;
  else next = (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  e.preventDefault();
  items[next].focus();
}

export const menuStyles = css`
  .status .srow {
    border-bottom: 1px solid var(--lc-line2);
  }
  .status .srow:last-child {
    border-bottom: none;
  }
  .status .srow .row {
    border-bottom: none;
    padding: 12px 0;
    min-height: 44px;
  }
  .status .chev {
    flex: none;
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.6;
    transition: transform 0.28s ease;
  }
  .status .srow[data-open] .chev {
    transform: rotate(180deg);
  }
  .mwrap {
    --mdur: 0.28s;
    display: grid;
    grid-template-rows: 0fr;
    visibility: hidden;
    transition:
      grid-template-rows var(--mdur) ease,
      visibility 0s linear var(--mdur);
  }
  .srow[data-open] .mwrap {
    grid-template-rows: 1fr;
    visibility: visible;
    transition:
      grid-template-rows var(--mdur) ease,
      visibility 0s;
  }
  .m-subtle .mwrap {
    --mdur: 0.14s;
  }
  .mclip {
    min-height: 0;
    overflow: hidden;
  }
  .mpanel {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
    margin-bottom: 12px;
    border-radius: 16px;
    background: var(--lc-menu-panel);
    box-shadow: inset 0 0 0 1px var(--lc-btn-edge);
  }
  .mgroup {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .vh {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .msec {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .mhead {
    padding: 6px 10px 2px;
    font-size: 12px;
    font-weight: 600;
    color: var(--lc-menu-head);
  }
  .mrow {
    display: flex;
    align-items: stretch;
    gap: 2px;
  }
  .mrow > .mitem:first-child {
    flex: 1 1 auto;
    min-width: 0;
    width: auto;
  }
  .mitem.medit {
    flex: none;
    width: 44px;
    min-width: 44px;
    padding: 0;
    justify-content: center;
    color: var(--lc-menu-fg2);
  }
  .medit ha-icon {
    --mdc-icon-size: 18px;
    display: inline-flex;
  }
  .mrun {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    border-radius: 999px;
    box-shadow: inset 0 0 0 1px var(--lc-menu-edge);
    background: var(--lc-menu-pill);
    font-size: 12.5px;
    font-weight: 600;
    color: var(--lc-fg);
  }
  .mrun.running {
    box-shadow: none;
    background: var(--lc-menu-pill-on);
  }
  .mplay {
    fill: currentColor;
  }
  .mdot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
  }
  .mitem {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 44px;
    padding: 8px 10px;
    border: none;
    border-radius: 12px;
    background: none;
    font: inherit;
    font-size: 13px;
    color: var(--lc-fg);
    text-align: left;
    cursor: pointer;
  }
  .mitem:hover:not([aria-disabled='true']) {
    background: var(--lc-menu-hover);
  }
  .mitem[aria-disabled='true'] {
    cursor: default;
  }
  /* Busy keeps full-contrast text; a ring and the cursor show it. */
  .mitem[aria-busy='true'] {
    cursor: progress;
    box-shadow: inset 0 0 0 1px var(--lc-menu-edge);
  }
  .mitem[role='radio'][aria-checked='true'] {
    background: var(--lc-menu-pill-on);
    box-shadow: inset 0 0 0 1px var(--lc-btn-on-edge);
  }
  /* A long name wraps to two lines, then ellipsizes; the full name is in the title. */
  .mlabel {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow-wrap: anywhere;
  }
  .mhint {
    flex: none;
    font-size: 12px;
    color: var(--lc-menu-fg2);
    padding: 0 10px;
  }
  .mitem .mhint {
    padding: 0;
  }
  .mcheck {
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.4;
    stroke-linecap: round;
    stroke-linejoin: round;
    visibility: hidden;
  }
  .mitem[aria-checked='true'] .mcheck {
    visibility: visible;
  }
  .mtrack {
    flex: none;
    position: relative;
    width: 40px;
    height: 24px;
    border-radius: 12px;
    background: var(--lc-menu-off-track);
    box-shadow: inset 0 0 0 1.5px var(--lc-menu-edge);
    transition: background-color 0.2s ease;
  }
  .mthumb {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--lc-menu-off-thumb);
    transition:
      transform 0.2s ease,
      background-color 0.2s ease;
  }
  /* On: a solid neutral track and a contrasting thumb at the far end, never the mode colour. */
  .mitem[aria-checked='true'] .mtrack {
    background: var(--lc-menu-on-track);
    box-shadow: inset 0 0 0 1.5px var(--lc-menu-on-track);
  }
  .mitem[aria-checked='true'] .mthumb {
    background: var(--lc-menu-on-thumb);
    transform: translateX(16px);
  }
  .mfoot {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 6px;
    border-top: 1px solid var(--lc-line2);
    padding-top: 2px;
  }
  .mfoot .mitem {
    width: auto;
    flex: 0 1 auto;
    font-weight: 500;
  }
  .merr {
    padding: 0 10px;
    font-size: 12.5px;
    color: var(--lc-menu-warn);
  }
  /* Stays in the tree so the live region announces; only collapsed to nothing. */
  .merr:empty {
    height: 0;
    padding: 0;
    margin-top: -6px;
    overflow: hidden;
  }
  .mitem:focus-visible {
    outline: 2px solid var(--lc-bright);
    outline-offset: -2px;
  }
  .m-minimal .mwrap,
  .m-minimal .mwrap *,
  .m-minimal .chev {
    transition: none !important;
  }
  .m-subtle .chev {
    transition-duration: 0.14s;
  }
  @media (forced-colors: active) {
    .mitem[aria-checked='true'] .mtrack {
      background: Highlight;
      box-shadow: inset 0 0 0 1.5px Highlight;
    }
    .mitem[aria-checked='true'] .mthumb {
      background: HighlightText;
    }
    .mtrack {
      background: Canvas;
      box-shadow: inset 0 0 0 1.5px ButtonText;
    }
    .mthumb {
      background: ButtonText;
    }
    .mrun {
      box-shadow: inset 0 0 0 1px ButtonText;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .mwrap,
    .chev,
    .mtrack,
    .mthumb {
      transition: none !important;
    }
  }
`;
