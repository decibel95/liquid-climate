// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import '../src/index';
import { defaultConfig, normalizeConfig, parseSensor, pruneDefaults, withSensorEntity, withSensorName } from '../src/config';
import { migrateConfig } from '../src/migrate';
import { resolveSensors } from '../src/detect/resolve';
import { detectSensors } from '../src/detect/roles';
import { materializeConfig } from '../src/detect/materialize';
import { allFixtures, makeHass, mergeFixtures } from './fixtures';

const K = 'climate.keuken_airco';
type AnyEl = HTMLElement & Record<string, any>;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('sensor settings with a display name', () => {
  it('parses ids, auto, false, lists and {entity, name} entries', () => {
    expect(parseSensor('auto')).toMatchObject({ mode: 'auto', ids: [] });
    expect(parseSensor(false)).toMatchObject({ mode: 'off', ids: [] });
    expect(parseSensor('sensor.a')).toMatchObject({ mode: 'set', ids: ['sensor.a'] });
    expect(parseSensor('sensor.a').name).toBeUndefined();
    expect(parseSensor({ entity: 'sensor.a', name: 'Room' })).toMatchObject({ mode: 'set', ids: ['sensor.a'], name: 'Room' });
    expect(parseSensor({ entity: 'auto', name: 'Room' })).toMatchObject({ mode: 'auto', name: 'Room' });
    expect(parseSensor(['sensor.a', { entity: 'sensor.b', name: 'B' }])).toMatchObject({ mode: 'set', ids: ['sensor.a', 'sensor.b'], names: { 'sensor.b': 'B' }, name: 'B' });
  });

  it('old configs stay valid and keep config_version 1', () => {
    const cfg = normalizeConfig(migrateConfig({ entity: K, sensors: { humidity: 'sensor.h', energy: ['sensor.e1', 'sensor.e2'], health: false } }));
    expect(cfg.config_version).toBe(1);
    expect(parseSensor(cfg.sensors.humidity).ids).toEqual(['sensor.h']);
    expect(parseSensor(cfg.sensors.energy).ids).toEqual(['sensor.e1', 'sensor.e2']);
    expect(parseSensor(cfg.sensors.health).mode).toBe('off');
  });

  it('sets and clears a name without losing the entity, and keeps the name when the entity changes', () => {
    expect(withSensorName('auto', 'Room')).toEqual({ entity: 'auto', name: 'Room' });
    expect(withSensorName('sensor.a', 'Room')).toEqual({ entity: 'sensor.a', name: 'Room' });
    expect(withSensorName({ entity: 'sensor.a', name: 'Room' }, '')).toBe('sensor.a');
    expect(withSensorName(['sensor.a', 'sensor.b'], 'Both')).toEqual([{ entity: 'sensor.a', name: 'Both' }, 'sensor.b']);
    expect(withSensorName(false, 'x')).toBe(false);
    expect(withSensorEntity({ entity: 'sensor.a', name: 'Room' }, 'sensor.b')).toEqual({ entity: 'sensor.b', name: 'Room' });
    expect(withSensorEntity({ entity: 'sensor.a', name: 'Room' }, '')).toEqual({ entity: 'auto', name: 'Room' });
    expect(withSensorEntity('sensor.a', '')).toBe('auto');
  });

  it('uses the name as the label in the dial info row', () => {
    const hass = makeHass(mergeFixtures(allFixtures));
    const cfg = normalizeConfig({
      entity: K,
      sensors: { humidity: { entity: 'sensor.keuken_airco_luchtvochtigheid', name: 'Kitchen humidity' }, outdoor: { entity: 'auto', name: 'Garden' } },
    });
    const d = detectSensors(hass, K, allFixtures.registry);
    const info = resolveSensors(hass, cfg, d).info;
    expect(info.find((i) => i.key === 'humidity')!.label).toBe('Kitchen humidity');
    expect(info.find((i) => i.key === 'outdoor')!.label).toBe('Garden');
  });

  it('materializes a named auto into a named concrete id', () => {
    const hass = makeHass(mergeFixtures(allFixtures));
    const cfg = { ...defaultConfig(K), sensors: { ...defaultConfig(K).sensors, outdoor: { entity: 'auto', name: 'Garden' } } };
    const out = materializeConfig(cfg, detectSensors(hass, K, allFixtures.registry));
    expect(out.sensors.outdoor).toEqual({ entity: 'sensor.keuken_airco_buitentemperatuur', name: 'Garden' });
  });

  it('shows the name in the dial card', async () => {
    const card = document.createElement('liquid-climate-card') as unknown as AnyEl;
    card.setConfig({ entity: K, sensors: { humidity: { entity: 'sensor.keuken_airco_luchtvochtigheid', name: 'Kitchen humidity' } } });
    card.hass = makeHass(mergeFixtures(allFixtures));
    document.body.append(card);
    await card.updateComplete;
    expect(card.shadowRoot!.querySelector('.info')!.textContent).toContain('Kitchen humidity');
  });
});

describe('pruning defaults out of the saved config', () => {
  it('drops values equal to the defaults, keeps type, entity, config_version and real changes', () => {
    const cfg = { ...defaultConfig(K), name: 'Living', write_delay: 3, look: { ...defaultConfig(K).look, glass: 'dark' as const } };
    expect(pruneDefaults(cfg, defaultConfig(K) as unknown as Record<string, unknown>)).toEqual({
      type: 'custom:liquid-climate-card',
      entity: K,
      config_version: 1,
      name: 'Living',
      write_delay: 3,
      look: { glass: 'dark' },
    });
  });

  it('the editor saves only what differs, with materialized sensor ids', async () => {
    const hass = makeHass(allFixtures);
    const list = Object.entries(allFixtures.registry).map(([entity_id, x]) => ({ entity_id, ...x }));
    (hass as any).callWS = async (m: any) => (m.type === 'config/entity_registry/list' ? list : []);
    const editor = document.createElement('liquid-climate-card-editor') as unknown as AnyEl;
    editor.hass = hass;
    editor.setConfig({ entity: K });
    document.body.append(editor);
    await editor.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await editor.updateComplete;
    let saved: any = null;
    editor.addEventListener('config-changed', (e: Event) => (saved = (e as CustomEvent).detail.config));
    const name = editor.shadowRoot!.querySelector('input[type=text]') as HTMLInputElement;
    name.value = 'Living';
    name.dispatchEvent(new Event('change'));
    expect(Object.keys(saved).sort()).toEqual(['config_version', 'entity', 'name', 'sensors', 'type']);
    expect(saved.sensors.humidity).toBe('sensor.keuken_airco_luchtvochtigheid');
    expect(Object.values(saved.sensors)).not.toContain('auto');
  });

  it('the editor has a name field per sensor that writes {entity, name}', async () => {
    const editor = document.createElement('liquid-climate-card-editor') as unknown as AnyEl;
    editor.hass = makeHass(allFixtures);
    editor.setConfig({ entity: K, sensors: { humidity: 'sensor.keuken_airco_luchtvochtigheid' } });
    document.body.append(editor);
    await editor.updateComplete;
    (editor.shadowRoot!.querySelectorAll('[role=tab]')[1] as HTMLButtonElement).click();
    await editor.updateComplete;
    const change = [...editor.shadowRoot!.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Change') as HTMLButtonElement;
    change.click();
    await editor.updateComplete;
    let saved: any = null;
    editor.addEventListener('config-changed', (e: Event) => (saved = (e as CustomEvent).detail.config));
    const input = editor.shadowRoot!.querySelector('input[aria-label="Humidity name"]') as HTMLInputElement;
    input.value = 'Kitchen humidity';
    input.dispatchEvent(new Event('change'));
    expect(saved.sensors.humidity).toEqual({ entity: 'sensor.keuken_airco_luchtvochtigheid', name: 'Kitchen humidity' });
    await editor.updateComplete;
    expect(editor.shadowRoot!.textContent).toContain('Kitchen humidity');
  });
});
