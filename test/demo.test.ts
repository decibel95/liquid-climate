import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HomeAssistant } from '../src/types';
import { createDemo, type Demo, type DemoOptions } from '../src/demo/service';

describe('demo service', () => {
  let demo: Demo;
  afterEach(() => {
    demo?.dispose();
    vi.useRealTimers();
  });

  function start(onCall?: DemoOptions['onCall']) {
    vi.useFakeTimers();
    demo = createDemo({ delay: 400, onCall });
    const seen: HomeAssistant[] = [];
    demo.subscribe((h) => seen.push(h));
    return seen;
  }

  it('applies set_temperature after the delay and publishes a new hass', async () => {
    const seen = start();
    const before = demo.hass;
    const done = demo.hass.callService('climate', 'set_temperature', { entity_id: 'climate.keuken_airco', temperature: 22 });
    expect(seen).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(400);
    await done;
    expect(seen).toHaveLength(1);
    expect(demo.hass).not.toBe(before);
    expect(demo.hass.states['climate.keuken_airco'].attributes.temperature).toBe(22);
  });

  it('applies set_hvac_mode', async () => {
    start();
    void demo.hass.callService('climate', 'set_hvac_mode', { entity_id: 'climate.keuken_airco', hvac_mode: 'cool' });
    await vi.advanceTimersByTimeAsync(400);
    expect(demo.hass.states['climate.keuken_airco'].state).toBe('cool');
  });

  it('applies select_option on the helper entities and calls onCall at once', async () => {
    const calls: string[] = [];
    start((domain, service) => calls.push(`${domain}.${service}`));
    void demo.hass.callService('input_select', 'select_option', { entity_id: 'input_select.heating_mode', option: 'Eco' });
    expect(calls).toEqual(['input_select.select_option']);
    await vi.advanceTimersByTimeAsync(400);
    expect(demo.hass.states['input_select.heating_mode'].state).toBe('Eco');
  });

  it('lets a script fall back to off', async () => {
    start();
    void demo.hass.callService('script', 'turn_on', { entity_id: 'script.apply_heating' });
    await vi.advanceTimersByTimeAsync(400);
    expect(demo.hass.states['script.apply_heating'].state).toBe('on');
    await vi.advanceTimersByTimeAsync(1500);
    expect(demo.hass.states['script.apply_heating'].state).toBe('off');
  });

  it('keeps every instance on its own state', async () => {
    start();
    const other = createDemo({ delay: 400 });
    void demo.hass.callService('climate', 'set_temperature', { entity_id: 'climate.keuken_airco', temperature: 19 });
    await vi.advanceTimersByTimeAsync(400);
    expect(other.hass.states['climate.keuken_airco'].attributes.temperature).not.toBe(19);
    other.dispose();
  });

  it('publishes language and dark mode changes', () => {
    const seen = start();
    demo.setLanguage('nl');
    demo.setDark(true);
    expect(seen).toHaveLength(2);
    expect(demo.hass.locale?.language).toBe('nl');
    expect(demo.hass.language).toBe('nl');
    expect((demo.hass.themes as { darkMode: boolean }).darkMode).toBe(true);
  });

  it('resolves pending calls on dispose without applying them, and ignores later calls', async () => {
    const seen = start();
    const before = demo.hass.states['climate.keuken_airco'].attributes.temperature;
    const pending = demo.hass.callService('climate', 'set_temperature', { entity_id: 'climate.keuken_airco', temperature: 17 });
    demo.dispose();
    await expect(pending).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(2000);
    expect(demo.hass.states['climate.keuken_airco'].attributes.temperature).toBe(before);
    const late = demo.hass.callService('climate', 'set_temperature', { entity_id: 'climate.keuken_airco', temperature: 16 });
    await expect(late).resolves.toBeUndefined();
    demo.setLanguage('nl');
    demo.setDark(true);
    expect(seen).toHaveLength(0);
    expect(demo.hass.language).not.toBe('nl');
  });
});

describe('shipped bundle', () => {
  it('does not import the demo folder', () => {
    const sources = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const files = Object.keys(sources).filter((f) => !f.startsWith('../src/demo/'));
    expect(files.length).toBeGreaterThan(10);
    const importsDemo = /from\s+['"][^'"]*\/demo(\/|['"])/;
    const offenders = files.filter((f) => importsDemo.test(sources[f]));
    expect(offenders).toEqual([]);
  });
});
