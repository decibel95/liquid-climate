import { describe, expect, it } from 'vitest';
import { CONFIG_VERSION, defaultConfig, normalizeConfig } from '../src/config';
import { migrateConfig } from '../src/migrate';

describe('config migration', () => {
  it('stamps unversioned configs with the current version', () => {
    const out = migrateConfig({ type: 'custom:liquid-climate-card', entity: 'climate.x' });
    expect(out.config_version).toBe(CONFIG_VERSION);
    expect(out.entity).toBe('climate.x');
  });

  it('leaves current configs untouched', () => {
    const cfg = { entity: 'climate.x', config_version: CONFIG_VERSION, write_delay: 3 };
    expect(migrateConfig(cfg)).toEqual(cfg);
  });

  it('does not downgrade configs from the future', () => {
    expect(migrateConfig({ entity: 'climate.x', config_version: 99 }).config_version).toBe(99);
  });

  it('does not mutate its input', () => {
    const input = { entity: 'climate.x' };
    migrateConfig(input);
    expect(input).toEqual({ entity: 'climate.x' });
  });
});

describe('config normalisation', () => {
  it('fills defaults for a minimal config', () => {
    const cfg = normalizeConfig(migrateConfig({ entity: 'climate.x' }));
    expect(cfg).toEqual(defaultConfig('climate.x'));
  });

  it('keeps user overrides and merges nested defaults', () => {
    const cfg = normalizeConfig({
      entity: 'climate.x',
      sensors: { humidity: false, outdoor: 'sensor.out' },
      look: { tint: 0.2 },
      write_delay: 0,
      status_entities: [{ entity: 'input_text.a', name: 'A' }, { bad: true }],
    });
    expect(cfg.sensors).toMatchObject({ humidity: false, outdoor: 'sensor.out', energy: 'auto' });
    expect(cfg.look).toEqual({ glass: 'theme', tint: 0.2, blur: 30, motion: 'rich' });
    expect(cfg.write_delay).toBe(0);
    expect(cfg.status_entities).toEqual([{ entity: 'input_text.a', name: 'A' }]);
  });

  it('rejects a negative write delay', () => {
    expect(normalizeConfig({ entity: 'climate.x', write_delay: -1 }).write_delay).toBe(1.5);
  });
});
