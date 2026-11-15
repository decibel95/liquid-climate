// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/index';
import { allFixtures, makeHass, mergeFixtures, type Fixture } from './fixtures';
import { materializeConfig } from '../src/detect/materialize';
import { detectSensors } from '../src/detect/roles';
import { defaultConfig } from '../src/config';
import { LiquidClimateBadge } from '../src/cards/badge/liquid-climate-badge';
import { STATUS_COLORS } from '../src/ui/modes';

const K = 'climate.keuken_airco';
const N = 'climate.nagelsalon_airco';
type AnyEl = HTMLElement & Record<string, any>;

function setup(entity = K, cfg: Record<string, unknown> = {}, tweak?: (f: Fixture) => void) {
  const f = mergeFixtures(allFixtures);
  f.states['input_boolean.window'] = { entity_id: 'input_boolean.window', state: 'off', attributes: {} };
  tweak?.(f);
  const hass = makeHass(f);
  // The concrete sensor config an editor would have written, as for the dial.
  const base = materializeConfig(defaultConfig(entity), detectSensors(hass, entity, f.registry));
  const badge = document.createElement('liquid-climate-badge') as unknown as AnyEl;
  badge.setConfig({ ...base, type: 'custom:liquid-climate-badge', entity, ...cfg });
  badge.hass = hass;
  document.body.append(badge);
  return { badge, hass, f };
}

const root = (b: AnyEl) => b.shadowRoot!.querySelector('.badge') as HTMLElement;
const value = (b: AnyEl) => b.shadowRoot!.querySelector('.v')?.textContent?.trim();
const pause = { pause_entity: 'input_boolean.window' };
const raiseError = (f: Fixture) => (f.states['binary_sensor.keuken_airco_is_in_error_state'].state = 'on');
const paused = (f: Fixture) => (f.states['input_boolean.window'].state = 'on');

afterEach(() => {
  document.body.innerHTML = '';
});

describe('badge value priority', () => {
  it('on: the room temperature, with the mode colour and icon', async () => {
    const { badge } = setup(K, { name: 'Living Room' });
    await badge.updateComplete;
    expect(value(badge)).toBe('21.0°');
    expect(root(badge).getAttribute('aria-label')).toBe('Living Room: 21.0°');
    expect(root(badge).className).toContain('k-on');
    expect(badge.shadowRoot!.querySelector('.ic')!.getAttribute('style')).toMatch(/rgba\(255,\s*148,\s*71,\s*0\.3\)/);
  });

  it('honours the temperature_sensor override', async () => {
    const { badge } = setup(K, { temperature_sensor: 'sensor.room' }, (f) => {
      f.states['sensor.room'] = { entity_id: 'sensor.room', state: '17.3', attributes: {} };
    });
    await badge.updateComplete;
    expect(value(badge)).toBe('17.3°');
  });

  it('off beats the temperature', async () => {
    const { badge } = setup(N);
    await badge.updateComplete;
    expect(value(badge)).toBe('Off');
    expect(root(badge).className).toContain('k-off');
  });

  it('paused beats off', async () => {
    const { badge } = setup(N, { ...pause, look: { glass: 'dark' } }, paused);
    await badge.updateComplete;
    expect(value(badge)).toBe('Paused');
    expect(STATUS_COLORS.paused).toBe('#facc15');
    expect(badge.shadowRoot!.querySelector('.ic')!.getAttribute('style')).toMatch(/rgba\(250,\s*204,\s*21,\s*0\.3\)/);
    // Light glass draws a darker amber so the state stays readable.
    const light = setup(N, { ...pause, look: { glass: 'light' } }, paused);
    await light.badge.updateComplete;
    expect(light.badge.shadowRoot!.querySelector('.ic')!.getAttribute('style')).toMatch(/rgba\(180,\s*83,\s*9,\s*0\.3\)/);
  });

  it('error beats paused', async () => {
    const { badge } = setup(K, pause, (f) => {
      paused(f);
      raiseError(f);
    });
    await badge.updateComplete;
    expect(value(badge)).toBe('Error');
    expect(root(badge).className).toContain('k-error');
  });

  it('error codes alone do not raise Error while the problem flags are off', async () => {
    // Slaapkamer reports U0-00 while healthy.
    const { badge } = setup('climate.slaapkamer_airco');
    await badge.updateComplete;
    expect(value(badge)).toBe('24.0°');
  });

  it('health: false switches the Error state off', async () => {
    const { badge } = setup(K, { sensors: { health: false } }, raiseError);
    await badge.updateComplete;
    expect(value(badge)).toBe('21.0°');
  });

  it('updates when the pause entity changes', async () => {
    const { badge, hass } = setup(K, pause);
    await badge.updateComplete;
    expect(value(badge)).toBe('21.0°');
    badge.hass = { ...hass, states: { ...hass.states, 'input_boolean.window': { entity_id: 'input_boolean.window', state: 'on', attributes: {} } } };
    await badge.updateComplete;
    expect(value(badge)).toBe('Paused');
  });

  it('unavailable shows -- without a dot', async () => {
    const { badge } = setup(K, { icon_only: true }, (f) => (f.states[K].state = 'unavailable'));
    await badge.updateComplete;
    expect(root(badge).getAttribute('aria-label')).toBe('Keuken Airco: --');
    expect(badge.shadowRoot!.querySelector('.dot')).toBeNull();
  });
});

describe('badge icon only', () => {
  const dot = (b: AnyEl) => b.shadowRoot!.querySelector('.dot');

  it('is round, has no text, and keeps the full aria-label', async () => {
    const { badge } = setup(K, { icon_only: true });
    await badge.updateComplete;
    expect(root(badge).className).toContain('round');
    expect(badge.shadowRoot!.querySelector('.txt')).toBeNull();
    expect(root(badge).getAttribute('aria-label')).toBe('Keuken Airco: 21.0°');
  });

  it('shows the pulsing dot only for error and paused', async () => {
    const on = setup(K, { icon_only: true });
    const off = setup(N, { icon_only: true });
    const p = setup(N, { icon_only: true, ...pause }, paused);
    const e = setup(K, { icon_only: true }, raiseError);
    for (const x of [on, off, p, e]) await x.badge.updateComplete;
    expect(dot(on.badge)).toBeNull();
    expect(dot(off.badge)).toBeNull();
    expect(dot(p.badge)).not.toBeNull();
    expect(dot(e.badge)).not.toBeNull();
    expect(dot(e.badge)!.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('badge tap_action', () => {
  it('defaults to more-info', async () => {
    const { badge } = setup();
    await badge.updateComplete;
    const seen: unknown[] = [];
    badge.addEventListener('hass-more-info', (e) => seen.push((e as CustomEvent).detail));
    (root(badge) as HTMLButtonElement).click();
    expect(seen).toEqual([{ entityId: K }]);
  });

  it('sheet opens the dial sheet and returns focus on close', async () => {
    const { badge } = setup(K, { tap_action: 'sheet' });
    await badge.updateComplete;
    const btn = root(badge) as HTMLButtonElement;
    expect(btn.getAttribute('aria-haspopup')).toBe('dialog');
    btn.focus();
    btn.click();
    const sheet = badge.shadowRoot!.querySelector('liquid-climate-sheet') as AnyEl;
    await sheet.updateComplete;
    const dialog = sheet.shadowRoot!.querySelector('dialog')!;
    expect(dialog.hasAttribute('open')).toBe(true);
    const card = dialog.querySelector('liquid-climate-card') as AnyEl;
    expect(card._config.entity).toBe(K);
    expect(card._config.pause_entity).toBeUndefined();
    sheet.close();
    await sheet.updateComplete;
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(badge.shadowRoot!.activeElement).toBe(btn);
  });

  it('none renders a non-interactive element with a name', async () => {
    const { badge } = setup(K, { tap_action: 'none' });
    await badge.updateComplete;
    expect(root(badge).tagName).toBe('DIV');
    expect(root(badge).getAttribute('role')).toBe('img');
    expect(root(badge).getAttribute('aria-label')).toBe('Keuken Airco: 21.0°');
  });
});

describe('badge glass and api', () => {
  it('follows look.glass like the dial', async () => {
    const { badge, hass } = setup();
    badge.hass = { ...hass, themes: { darkMode: true } };
    await badge.updateComplete;
    expect(root(badge).className).toContain('g-dark');
    badge.hass = { ...hass, themes: { darkMode: false } };
    await badge.updateComplete;
    expect(root(badge).className).toContain('g-light');
  });

  it('sizes like an HA badge through the HA theme tokens', () => {
    const css = (LiquidClimateBadge.styles as { cssText: string }[]).map((s) => s.cssText).join('\n');
    for (const token of [
      'height: var(--_size)',
      '--_size: var(--ha-badge-size, 36px)',
      'border-radius: var(--ha-badge-border-radius, calc(var(--ha-badge-size, 36px) / 2))',
      'padding: 0 12px',
      'gap: var(--ha-space-2, 8px)',
      'width: var(--ha-badge-icon-size, 18px)',
      'font-size: var(--ha-font-size-xs, 10px)',
      'font-weight: var(--ha-font-weight-medium, 500)',
      'font-size: var(--ha-badge-font-size, var(--ha-font-size-s, 12px))',
      'line-height: var(--ha-line-height-condensed, 1.2)',
      'letter-spacing: 0.1px',
    ]) {
      expect(css).toContain(token);
    }
    expect(css).not.toContain('44px');
  });

  it('has no pointer-follow light', async () => {
    const { badge } = setup();
    await badge.updateComplete;
    expect(badge.shadowRoot!.querySelector('.glow')).toBeNull();
  });

  it('is registered as a view badge and as a card', () => {
    expect(window.customBadges!.some((b) => b.type === 'liquid-climate-badge')).toBe(true);
    expect(window.customCards!.some((c) => c.type === 'liquid-climate-badge')).toBe(true);
  });

  it('offers stub config, grid options and an editor, and rejects non-climate entities', async () => {
    const hass = makeHass(allFixtures);
    expect(LiquidClimateBadge.getStubConfig(hass)).toMatchObject({ type: 'custom:liquid-climate-badge', config_version: 1 });
    expect((await LiquidClimateBadge.getConfigElement()).tagName.toLowerCase()).toBe('liquid-climate-badge-editor');
    const { badge } = setup();
    expect(badge.getGridOptions()).toMatchObject({ rows: 1 });
    expect(badge._config.config_version).toBe(1);
    expect(() => badge.setConfig({ entity: 'sensor.x' })).toThrow(/climate entity/);
  });

  it('skips renders for unrelated entities', async () => {
    const { badge, hass } = setup(K, pause);
    await badge.updateComplete;
    const render = vi.spyOn(badge as any, 'render');
    badge.hass = { ...hass, states: { ...hass.states, 'climate.no_fan': { ...hass.states['climate.no_fan'], state: 'off' } } };
    await badge.updateComplete;
    expect(render).not.toHaveBeenCalled();
  });
});

describe('badge editor', () => {
  it('edits pause_entity, icon_only and tap_action and keeps the type', async () => {
    const editor = document.createElement('liquid-climate-badge-editor') as unknown as AnyEl;
    editor.hass = makeHass(allFixtures);
    editor.setConfig({ type: 'custom:liquid-climate-badge', entity: K });
    document.body.append(editor);
    await editor.updateComplete;
    let saved: any = null;
    editor.addEventListener('config-changed', (e: Event) => (saved = (e as CustomEvent).detail.config));

    const pauseInput = editor.shadowRoot!.querySelector('input[list=lc-pause-ids]') as HTMLInputElement;
    pauseInput.value = 'binary_sensor.window';
    pauseInput.dispatchEvent(new Event('change'));
    expect(saved).toMatchObject({ type: 'custom:liquid-climate-badge', entity: K, pause_entity: 'binary_sensor.window', config_version: 1 });
    // Defaults stay out of the YAML.
    expect(saved).not.toHaveProperty('tap_action');
    expect(saved).not.toHaveProperty('icon_only');
    expect(saved).not.toHaveProperty('write_delay');
    expect(saved).not.toHaveProperty('look');
    expect(saved).not.toHaveProperty('controls');

    (editor.shadowRoot!.querySelector('[role=switch][aria-label="Icon only"]') as HTMLButtonElement).click();
    expect(saved.icon_only).toBe(true);

    const taps = [...editor.shadowRoot!.querySelectorAll('[role=radiogroup][aria-label=Tap] button')] as HTMLButtonElement[];
    taps[1].click();
    expect(saved.tap_action).toBe('sheet');
    expect(saved.pause_entity).toBe('binary_sensor.window');

    // Look controls, as on the dial.
    const dark = [...editor.shadowRoot!.querySelectorAll('[role=radiogroup][aria-label=Glass] button')] as HTMLButtonElement[];
    dark[1].click();
    expect(saved.look).toEqual({ glass: 'dark' });
  });
});
