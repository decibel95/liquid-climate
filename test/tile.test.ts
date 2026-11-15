// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/index';
import type { HomeAssistant } from '../src/types';
import { allFixtures, makeHass, mergeFixtures, type Fixture } from './fixtures';
import { forgetModes } from '../src/cards/shared/writer';
import { LiquidClimateTile } from '../src/cards/tile/liquid-climate-tile';
import { ICONS } from '../src/ui/modes';
import { LiquidClimateSheet } from '../src/cards/shared/sheet';
import { LiquidClimateCard } from '../src/cards/dial/liquid-climate-card';

const K = 'climate.keuken_airco';
type AnyEl = HTMLElement & Record<string, any>;

function setup(entity = K, cfg: Record<string, unknown> = {}, tweak?: (f: Fixture) => void) {
  const f = mergeFixtures(allFixtures);
  tweak?.(f);
  const calls: { service: string; data: any }[] = [];
  const hass = makeHass(f, '°C', (_d, service, data) => void calls.push({ service, data: data as any }));
  const tile = document.createElement('liquid-climate-tile') as unknown as AnyEl;
  tile.setConfig({ type: 'custom:liquid-climate-tile', entity, ...cfg });
  tile.hass = hass;
  document.body.append(tile);
  return { tile, hass, calls, f };
}

const $ = (el: AnyEl, sel: string) => el.shadowRoot!.querySelector(sel) as HTMLElement | null;
const $$ = (el: AnyEl, sel: string) => [...el.shadowRoot!.querySelectorAll(sel)] as HTMLElement[];
const text = (el: HTMLElement | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const power = (t: AnyEl) => $(t, 'button.power') as HTMLButtonElement;
const steps = (t: AnyEl) => $$(t, 'button.step') as HTMLButtonElement[];

beforeEach(() => {
  vi.useFakeTimers();
  forgetModes();
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('tile rendering per state', () => {
  it('heat: name, domain-aware subline, target, power pressed and a flickering flame', async () => {
    const { tile } = setup(K, { name: 'Living Room' });
    await tile.updateComplete;
    expect(text($(tile, '.name'))).toBe('Living Room');
    expect(text($(tile, '.sub'))).toBe('Heating, 21.0° inside');
    expect(text($(tile, '.target'))).toBe('19.5°');
    expect(power(tile).getAttribute('aria-pressed')).toBe('true');
    expect(power(tile).getAttribute('aria-label')).toBe('Power, Living Room');
    expect(power(tile).getAttribute('style')).toMatch(/rgba\(255,\s*148,\s*71,\s*0\.24\)/);
    expect($(tile, 'button.power svg')!.getAttribute('class')).toContain('flick');
    expect(steps(tile).every((b) => !b.disabled)).toBe(true);
  });

  it('uses hvac_action when present, through formatEntityAttributeValue, and only flickers while heating', async () => {
    const { tile, hass } = setup(K, {}, (f) => (f.states[K].attributes.hvac_action = 'idle'));
    await tile.updateComplete;
    expect(text($(tile, '.sub'))).toBe('Idle, 21.0° inside');
    expect($(tile, 'button.power svg')!.getAttribute('class')).not.toContain('flick');

    const states = { ...hass.states, [K]: { ...hass.states[K], attributes: { ...hass.states[K].attributes, hvac_action: 'heating' } } };
    tile.hass = { ...hass, states, formatEntityAttributeValue: (_s: unknown, attr: string) => (attr === 'hvac_action' ? 'Warming' : '') };
    await tile.updateComplete;
    expect(text($(tile, '.sub'))).toBe('Warming, 21.0° inside');
    expect($(tile, 'button.power svg')!.getAttribute('class')).toContain('flick');
  });

  it('does not flicker with motion minimal', async () => {
    const { tile } = setup(K, { look: { motion: 'minimal' } });
    await tile.updateComplete;
    expect($(tile, 'button.power svg')!.getAttribute('class')).not.toContain('flick');
  });

  it('off: Off subline, -- target, steppers disabled, power not pressed', async () => {
    const { tile } = setup('climate.nagelsalon_airco');
    await tile.updateComplete;
    expect(text($(tile, '.sub'))).toBe('Off, 24.0° inside');
    expect(text($(tile, '.target'))).toBe('--');
    expect(power(tile).getAttribute('aria-pressed')).toBe('false');
    expect(power(tile).getAttribute('aria-label')).toBe('Power, Nagelsalon Airco');
    expect(power(tile).disabled).toBe(false);
    expect(steps(tile).every((b) => b.disabled)).toBe(true);
  });

  it('unavailable: Unavailable subline, everything disabled', async () => {
    const { tile } = setup(K, {}, (f) => (f.states[K].state = 'unavailable'));
    await tile.updateComplete;
    expect(text($(tile, '.sub'))).toBe('Unavailable');
    expect(text($(tile, '.target'))).toBe('--');
    expect(power(tile).disabled).toBe(true);
    expect(steps(tile).every((b) => b.disabled)).toBe(true);
  });

  it('unknown is treated like unavailable', async () => {
    const { tile } = setup(K, {}, (f) => (f.states[K].state = 'unknown'));
    await tile.updateComplete;
    expect(text($(tile, '.sub'))).toBe('Unavailable');
    expect(power(tile).disabled).toBe(true);
    expect(steps(tile).every((b) => b.disabled)).toBe(true);
  });

  it('shows Error from the health flags: red alert power button, code as detail, announced outside the button', async () => {
    const health = [
      { entity: 'binary_sensor.keuken_airco_is_in_error_state', name: 'Unit' },
      { entity: 'sensor.keuken_airco_error_code', name: 'Controller' },
    ];
    const { tile, hass } = setup(K, { sensors: { health } }, (f) => {
      f.states['sensor.keuken_airco_error_code'].state = 'A6-01';
    });
    await tile.updateComplete;
    // Codes alone do not raise it while the flags are off.
    expect(text($(tile, '.sub'))).toBe('Heating, 21.0° inside');
    expect(text($(tile, '.sr'))).toBe('');

    const flag = 'binary_sensor.keuken_airco_is_in_error_state';
    tile.hass = { ...hass, states: { ...hass.states, [flag]: { ...hass.states[flag], state: 'on' } } };
    await tile.updateComplete;
    expect(text($(tile, '.sub'))).toBe('Error, Controller: A6-01');
    expect(text($(tile, '.sr[aria-live=polite]'))).toBe('Keuken Airco: Error, Controller: A6-01');
    expect($(tile, '.sr')!.closest('button')).toBeNull();
    expect(power(tile).getAttribute('style')).toMatch(/rgba\(220,\s*38,\s*38,\s*0\.24\)/);
    expect($(tile, 'button.power path')!.getAttribute('d')).toBe(ICONS.alert);
    expect($(tile, 'button.power svg')!.getAttribute('class')).not.toContain('flick');
    // The power button still works and keeps its name.
    expect(power(tile).getAttribute('aria-label')).toBe('Power, Keuken Airco');
    expect(power(tile).disabled).toBe(false);
  });

  it('missing entity says so', async () => {
    const { tile } = setup('climate.nope');
    await tile.updateComplete;
    expect(text($(tile, '.sub'))).toBe('Entity climate.nope not found');
  });

  it('range: shows low–high, hides the steppers and opens the sheet on tap', async () => {
    const { tile } = setup('climate.dual_setpoint');
    await tile.updateComplete;
    expect(steps(tile)).toHaveLength(0);
    const range = $(tile, 'button.range') as HTMLButtonElement;
    expect(text(range)).toBe('19.0–24.0°');
    expect(range.getAttribute('aria-label')).toContain('19.0 to 24.0');
    range.click();
    await tile.updateComplete;
    const sheet = $(tile, 'liquid-climate-sheet') as AnyEl;
    await sheet.updateComplete;
    expect(sheet.shadowRoot!.querySelector('dialog')!.hasAttribute('open')).toBe(true);
  });

  it('honours the temperature_sensor override and falls back when it has no number', async () => {
    const { tile, hass } = setup(K, { temperature_sensor: 'sensor.room' }, (f) => {
      f.states['sensor.room'] = { entity_id: 'sensor.room', state: '17.3', attributes: {} };
    });
    await tile.updateComplete;
    expect(text($(tile, '.sub'))).toBe('Heating, 17.3° inside');
    tile.hass = { ...hass, states: { ...hass.states, 'sensor.room': { entity_id: 'sensor.room', state: 'unavailable', attributes: {} } } };
    await tile.updateComplete;
    expect(text($(tile, '.sub'))).toBe('Heating, 21.0° inside');
  });

  it('follows look.glass: theme picks light or dark, explicit values stay', async () => {
    const { tile, hass } = setup();
    tile.hass = { ...hass, themes: { darkMode: true } };
    await tile.updateComplete;
    expect($(tile, 'article.tile')!.className).toContain('g-dark');
    tile.hass = { ...hass, themes: { darkMode: false } };
    await tile.updateComplete;
    expect($(tile, 'article.tile')!.className).toContain('g-light');
    const light = setup(K, { look: { glass: 'light' } });
    light.tile.hass = { ...light.hass, themes: { darkMode: true } };
    await light.tile.updateComplete;
    expect($(light.tile, 'article.tile')!.className).toContain('g-light');
  });

  it('has no pointer-follow light', async () => {
    const { tile } = setup();
    await tile.updateComplete;
    expect($(tile, '.glow')).toBeNull();
  });
});

describe('tile power toggle', () => {
  it('turns off with one set_hvac_mode call', async () => {
    const { tile, calls } = setup();
    await tile.updateComplete;
    power(tile).click();
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toEqual([{ service: 'set_hvac_mode', data: { entity_id: K, hvac_mode: 'off' } }]);
  });

  it('turns back on to the last non-off mode seen on the entity', async () => {
    const S = 'climate.slaapkamer_airco';
    const { tile, hass, calls } = setup(S);
    await tile.updateComplete; // seen in cool
    tile.hass = { ...hass, states: { ...hass.states, [S]: { ...hass.states[S], state: 'off' } } };
    await tile.updateComplete;
    expect(power(tile).getAttribute('aria-pressed')).toBe('false');
    power(tile).click();
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toEqual([{ service: 'set_hvac_mode', data: { entity_id: S, hvac_mode: 'cool' } }]);
  });

  it('falls back to the first known mode in dial order when nothing was seen', async () => {
    const { tile, calls } = setup('climate.nagelsalon_airco');
    await tile.updateComplete;
    power(tile).click();
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toEqual([{ service: 'set_hvac_mode', data: { entity_id: 'climate.nagelsalon_airco', hvac_mode: 'heat' } }]);
  });

  it('shows the new state optimistically before the entity reports it', async () => {
    const { tile } = setup();
    await tile.updateComplete;
    power(tile).click();
    await tile.updateComplete;
    expect(power(tile).getAttribute('aria-pressed')).toBe('false');
    expect(text($(tile, '.sub'))).toBe('Off, 21.0° inside');
  });
});

describe('tile steppers', () => {
  it('coalesces several presses into one set_temperature after write_delay', async () => {
    const { tile, calls } = setup();
    await tile.updateComplete;
    const [, plus] = steps(tile);
    plus.click();
    plus.click();
    plus.click();
    await tile.updateComplete;
    expect(text($(tile, '.target'))).toBe('21.0°');
    await vi.advanceTimersByTimeAsync(1400);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toEqual([{ service: 'set_temperature', data: { entity_id: K, temperature: 21 } }]);
  });

  it('uses target_temp_step and the write_delay from the config', async () => {
    const { tile, calls } = setup('climate.step_one', { write_delay: 0 });
    await tile.updateComplete;
    steps(tile)[0].click();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([{ service: 'set_temperature', data: { entity_id: 'climate.step_one', temperature: 20 } }]);
  });

  it('clamps to max_temp and disables the button at the limit', async () => {
    const { tile, calls } = setup(K, {}, (f) => (f.states[K].attributes.temperature = 29.5));
    await tile.updateComplete;
    const [minus, plus] = steps(tile);
    plus.click();
    await tile.updateComplete;
    expect(text($(tile, '.target'))).toBe('30.0°');
    expect(plus.disabled).toBe(true);
    plus.click();
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toEqual([{ service: 'set_temperature', data: { entity_id: K, temperature: 30 } }]);
    expect(minus.disabled).toBe(false);
  });

  it('clamps to min_temp', async () => {
    const { tile } = setup(K, {}, (f) => (f.states[K].attributes.temperature = 10));
    await tile.updateComplete;
    const [minus] = steps(tile);
    expect(minus.disabled).toBe(true);
  });

  it('sends a pending change when the tile is removed', async () => {
    const { tile, calls } = setup();
    await tile.updateComplete;
    steps(tile)[1].click();
    tile.remove();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([{ service: 'set_temperature', data: { entity_id: K, temperature: 20 } }]);
  });

  it('shows a failed write in the subline, then goes back', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const f = mergeFixtures(allFixtures);
    const hass = makeHass(f, '°C', () => Promise.reject(new Error('Rate limit reached')));
    const tile = document.createElement('liquid-climate-tile') as unknown as AnyEl;
    tile.setConfig({ entity: K });
    tile.hass = hass;
    document.body.append(tile);
    await tile.updateComplete;
    steps(tile)[1].click();
    await vi.advanceTimersByTimeAsync(1500);
    await tile.updateComplete;
    // Visible in the subline, announced by a live region outside the buttons.
    expect(text($(tile, '.sub'))).toBe('Rate limit reached');
    expect(text($(tile, '.sr[aria-live=polite]'))).toBe('Keuken Airco: Rate limit reached');
    expect($(tile, 'button [role=alert]')).toBeNull();
    await vi.advanceTimersByTimeAsync(6100);
    await tile.updateComplete;
    expect(text($(tile, '.sr[aria-live=polite]'))).toBe('');
    expect(text($(tile, '.sub'))).toBe('Heating, 21.0° inside');
  });
});

describe('tile sheet', () => {
  const open = async (tile: AnyEl) => {
    const body = $(tile, 'button.body') as HTMLButtonElement;
    body.focus();
    body.click();
    await tile.updateComplete;
    const sheet = $(tile, 'liquid-climate-sheet') as AnyEl;
    await sheet.updateComplete;
    return { body, sheet, dialog: sheet.shadowRoot!.querySelector('dialog') as HTMLDialogElement };
  };

  it('opens the dial for the same entity and config in a modal dialog', async () => {
    const { tile } = setup(K, { name: 'Living Room', look: { glass: 'light' } });
    await tile.updateComplete;
    const { dialog, sheet } = await open(tile);
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.getAttribute('aria-label')).toBe('Living Room');
    const card = dialog.querySelector('liquid-climate-card') as AnyEl;
    expect(card).not.toBeNull();
    await card.updateComplete;
    expect(card._config.entity).toBe(K);
    expect(card._config.type).toBe('custom:liquid-climate-card');
    expect(card._config.look.glass).toBe('light');
    expect(card._config.tap_action).toBeUndefined();
    expect(card.shadowRoot!.querySelector('h2')!.textContent).toBe('Living Room');
    expect(sheet.isOpen).toBe(true);
  });

  it('paints nothing of its own around the dial: no box, border, shadow or outline on the dialog', () => {
    const css = (LiquidClimateSheet.styles as { cssText: string }[]).map((x) => x.cssText).join(' ');
    const dialogRule = css.slice(css.indexOf('dialog {'), css.indexOf('}', css.indexOf('dialog {')));
    for (const decl of ['padding: 0', 'border: none', 'outline: none', 'box-shadow: none', 'background: transparent']) {
      expect(dialogRule).toContain(decl);
    }
    // The dialog clips overflow, so the dial inside drops its outer shadow instead of showing a square.
    expect(css).toContain('--lc-drop: 0 0 0 transparent');
    expect((LiquidClimateCard.styles as { cssText: string }).cssText).toContain('var(--lc-drop, 0 40px 80px -24px');
    expect(css).toContain('prefers-reduced-transparency');
  });

  it('puts Close inside the dial header next to the power button, 44px with a focus ring', async () => {
    const { tile } = setup();
    await tile.updateComplete;
    const { dialog } = await open(tile);
    const card = dialog.querySelector('liquid-climate-card') as AnyEl;
    await card.updateComplete;
    const close = dialog.querySelector('button.close') as HTMLButtonElement;
    expect(close.parentElement).toBe(card);
    expect(close.getAttribute('slot')).toBe('header-action');
    expect(close.getAttribute('aria-label')).toBe('Close');
    const actions = card.shadowRoot!.querySelector('header .actions')!;
    expect(actions.querySelector('button.power')).not.toBeNull();
    expect(actions.querySelector('slot[name=header-action]')).not.toBeNull();
    expect(dialog.querySelector('.bar')).toBeNull();
    const css = (LiquidClimateSheet.styles as { cssText: string }[]).map((x) => x.cssText).join(' ');
    const closeRule = css.slice(css.indexOf('.close {'), css.indexOf('}', css.indexOf('.close {')));
    expect(closeRule).toContain('width: 44px');
    expect(closeRule).toContain('height: 44px');
    expect(css).toContain('.close:focus-visible');
  });

  it('starts with focus on Close, not on the dial power button', async () => {
    const { tile } = setup(K, {}, (f) => (f.states[K].state = 'off'));
    await tile.updateComplete;
    const { dialog, sheet } = await open(tile);
    const card = dialog.querySelector('liquid-climate-card') as AnyEl;
    await card.updateComplete;
    await vi.advanceTimersByTimeAsync(0);
    expect(tile.shadowRoot!.activeElement).toBe(sheet);
    const active = sheet.shadowRoot!.activeElement as HTMLElement;
    expect(active.matches('button.close')).toBe(true);
    expect(active).not.toBe(card.shadowRoot!.querySelector('button.power'));
  });

  it('removes the dial on Close and Escape even when the close event comes late', async () => {
    const { tile } = setup();
    await tile.updateComplete;
    for (const how of ['button', 'escape'] as const) {
      const { dialog, sheet } = await open(tile);
      // A browser may queue the close event; the dial must go without waiting for it.
      const native = vi.spyOn(dialog, 'close').mockImplementation(() => dialog.removeAttribute('open'));
      if (how === 'button') (dialog.querySelector('button.close') as HTMLButtonElement).click();
      else dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sheet.updateComplete;
      expect(dialog.hasAttribute('open')).toBe(false);
      expect(dialog.querySelector('liquid-climate-card')).toBeNull();
      expect(sheet.isOpen).toBe(false);
      native.mockRestore();
    }
  });

  it('closes with the close button and returns focus to the tile', async () => {
    const { tile } = setup();
    await tile.updateComplete;
    const { dialog, body, sheet } = await open(tile);
    (dialog.querySelector('button.close') as HTMLButtonElement).click();
    await sheet.updateComplete;
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(dialog.querySelector('liquid-climate-card')).toBeNull();
    expect(tile.shadowRoot!.activeElement).toBe(body);
  });

  it('closes on Escape and on a backdrop click, not on a click inside', async () => {
    const { tile } = setup();
    await tile.updateComplete;
    let s = await open(tile);
    s.dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await s.sheet.updateComplete;
    expect(s.dialog.hasAttribute('open')).toBe(false);

    s = await open(tile);
    s.dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    await s.sheet.updateComplete;
    expect(s.dialog.hasAttribute('open')).toBe(false);

    s = await open(tile);
    (s.dialog.querySelector('.frame') as HTMLElement).click();
    expect(s.dialog.hasAttribute('open')).toBe(true);
    s.dialog.click();
    await s.sheet.updateComplete;
    expect(s.dialog.hasAttribute('open')).toBe(false);
    expect(tile.shadowRoot!.activeElement).toBe(s.body);
  });

  it('shares one write queue with the dial in its sheet: one coalesced write, in order', async () => {
    const { tile, calls } = setup();
    await tile.updateComplete;
    steps(tile)[1].click(); // 19.5 -> 20.0, pending
    const { dialog, sheet } = await open(tile);
    const card = dialog.querySelector('liquid-climate-card') as AnyEl;
    await card.updateComplete;
    // The dial opens on the tile's pending value, not the entity's.
    expect(card.shadowRoot!.querySelector('svg.dial')!.getAttribute('aria-valuenow')).toBe('20');
    const cool = [...card.shadowRoot!.querySelectorAll('button.mode')].find((b) => b.textContent!.includes('Cool')) as HTMLButtonElement;
    cool.click();
    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toEqual([]);
    sheet.close();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([
      { service: 'set_hvac_mode', data: { entity_id: K, hvac_mode: 'cool' } },
      { service: 'set_temperature', data: { entity_id: K, temperature: 20 } },
    ]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(2);
    // The tile shows the in-flight mode the dial set.
    await tile.updateComplete;
    expect(text($(tile, '.sub'))).toBe('Cooling, 21.0° inside');
  });

  it('closes the dialog when removed while open, and opens modal again afterwards', async () => {
    const { tile } = setup();
    await tile.updateComplete;
    let s = await open(tile);
    tile.remove();
    expect(s.dialog.hasAttribute('open')).toBe(false);
    document.body.append(tile);
    await tile.updateComplete;
    const modal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    s = await open(tile);
    expect(modal).toHaveBeenCalledTimes(1);
    expect(s.dialog.hasAttribute('open')).toBe(true);
    expect(s.dialog.querySelector('liquid-climate-card')).not.toBeNull();
    modal.mockRestore();
  });

  it('reopens a dialog left open without being modal as a modal one', async () => {
    const { tile } = setup();
    await tile.updateComplete;
    const sheet = $(tile, 'liquid-climate-sheet') as AnyEl;
    await sheet.updateComplete;
    const dialog = sheet.shadowRoot!.querySelector('dialog') as HTMLDialogElement;
    dialog.show();
    const close = vi.spyOn(dialog, 'close');
    const modal = vi.spyOn(dialog, 'showModal');
    const s = await open(tile);
    expect(close).toHaveBeenCalled();
    expect(modal).toHaveBeenCalledTimes(1);
    expect(s.dialog.hasAttribute('open')).toBe(true);
    expect(s.sheet.isOpen).toBe(true);
  });

  it('follows a config change while the sheet is open', async () => {
    const { tile } = setup(K, { name: 'One' });
    await tile.updateComplete;
    const { dialog } = await open(tile);
    tile.setConfig({ entity: K, name: 'Two' });
    const card = dialog.querySelector('liquid-climate-card') as AnyEl;
    await card.updateComplete;
    expect(card.shadowRoot!.querySelector('h2')!.textContent).toBe('Two');
  });

  it('keeps the dial in the sheet up to date while the tile skips renders', async () => {
    const { tile, hass } = setup();
    await tile.updateComplete;
    const { dialog } = await open(tile);
    const card = dialog.querySelector('liquid-climate-card') as AnyEl;
    // A family sensor the tile does not watch: the tile skips, the dial must still get it.
    const next = { ...hass, states: { ...hass.states, 'sensor.keuken_airco_luchtvochtigheid': { ...hass.states['sensor.keuken_airco_luchtvochtigheid'], state: '61' } } };
    tile.hass = next;
    await tile.updateComplete;
    await (tile.shadowRoot!.querySelector('liquid-climate-sheet') as AnyEl).updateComplete;
    expect(card.hass).toBe(next);
  });

  it('sends a change made in the sheet when the sheet closes', async () => {
    const { tile, calls } = setup();
    await tile.updateComplete;
    const { dialog, sheet } = await open(tile);
    const card = dialog.querySelector('liquid-climate-card') as AnyEl;
    await card.updateComplete;
    card._queue.set({ temperature: 23 });
    sheet.close();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([{ service: 'set_temperature', data: { entity_id: K, temperature: 23 } }]);
  });
});

describe('tile tap_action', () => {
  it('more-info fires hass-more-info with the entity id and opens no sheet', async () => {
    const { tile } = setup(K, { tap_action: 'more-info' });
    await tile.updateComplete;
    const seen: unknown[] = [];
    tile.addEventListener('hass-more-info', (e) => seen.push((e as CustomEvent).detail));
    ($(tile, 'button.body') as HTMLButtonElement).click();
    await tile.updateComplete;
    expect(seen).toEqual([{ entityId: K }]);
    const dialog = ($(tile, 'liquid-climate-sheet') as AnyEl).shadowRoot!.querySelector('dialog')!;
    expect(dialog.hasAttribute('open')).toBe(false);
  });

  it('none renders a plain body that is not a button', async () => {
    const { tile } = setup(K, { tap_action: 'none' });
    await tile.updateComplete;
    expect($(tile, 'button.body')).toBeNull();
    expect($(tile, 'div.body')).not.toBeNull();
  });

  it('defaults to sheet, and an unknown value falls back to sheet', async () => {
    const { tile } = setup(K, { tap_action: 'explode' });
    await tile.updateComplete;
    expect($(tile, 'button.body')!.getAttribute('aria-haspopup')).toBe('dialog');
  });
});

describe('tile lovelace api', () => {
  it('rejects a non-climate entity', () => {
    const tile = document.createElement('liquid-climate-tile') as unknown as AnyEl;
    expect(() => tile.setConfig({ entity: 'sensor.x' })).toThrow(/climate entity/);
  });

  it('stamps config_version and offers stub config, grid options and an editor', async () => {
    const hass: HomeAssistant = makeHass(allFixtures);
    expect(LiquidClimateTile.getStubConfig(hass)).toMatchObject({ type: 'custom:liquid-climate-tile', config_version: 1 });
    expect((LiquidClimateTile.getStubConfig(hass).entity as string).startsWith('climate.')).toBe(true);
    const { tile } = setup();
    expect(tile._config.config_version).toBe(1);
    expect(tile.getGridOptions()).toMatchObject({ columns: 12, min_columns: 6 });
    expect((await LiquidClimateTile.getConfigElement()).tagName.toLowerCase()).toBe('liquid-climate-tile-editor');
  });

  it('is registered in the card picker', () => {
    expect(window.customCards!.some((c) => c.type === 'liquid-climate-tile')).toBe(true);
  });

  it('re-renders only for its entity and temperature sensor', async () => {
    const { tile, hass } = setup();
    await tile.updateComplete;
    const render = vi.spyOn(tile as any, 'render');
    tile.hass = { ...hass, states: { ...hass.states, 'climate.no_fan': { ...hass.states['climate.no_fan'], state: 'off' } } };
    await tile.updateComplete;
    expect(render).not.toHaveBeenCalled();
    tile.hass = { ...tile.hass, states: { ...tile.hass.states, [K]: { ...hass.states[K], state: 'cool' } } };
    await tile.updateComplete;
    expect(render).toHaveBeenCalledTimes(1);
  });
});

describe('tile editor', () => {
  it('keeps tap_action and writes it back with the dial setup fields', async () => {
    const editor = document.createElement('liquid-climate-tile-editor') as unknown as AnyEl;
    editor.hass = makeHass(allFixtures);
    editor.setConfig({ type: 'custom:liquid-climate-tile', entity: K, tap_action: 'more-info' });
    document.body.append(editor);
    await editor.updateComplete;
    let saved: any = null;
    editor.addEventListener('config-changed', (e: Event) => (saved = (e as CustomEvent).detail.config));
    const radios = [...editor.shadowRoot!.querySelectorAll('[role=radiogroup][aria-label="Tap on the name"] button')] as HTMLButtonElement[];
    expect(radios.map((b) => b.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    radios[2].click();
    expect(saved.tap_action).toBe('none');
    expect(saved.type).toBe('custom:liquid-climate-tile');
    const name = editor.shadowRoot!.querySelector('input[type=text]') as HTMLInputElement;
    name.value = 'Living Room';
    name.dispatchEvent(new Event('change'));
    expect(saved).toMatchObject({ name: 'Living Room', tap_action: 'none', entity: K });
    expect(editor.shadowRoot!.querySelector('[aria-label="Write delay"]')).not.toBeNull();
    expect(editor.shadowRoot!.querySelector('[aria-label="Glass"]')).not.toBeNull();
  });
});
