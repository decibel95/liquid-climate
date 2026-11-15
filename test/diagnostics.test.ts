// @vitest-environment happy-dom
import { render } from 'lit';
import pkg from '../package.json';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/index';
import { buildDiagnostics, diagnosticsText, stripSecrets } from '../src/diagnostics';
import { DOCS_URL, VERSION } from '../src/const';
import { LOCALES, optionName } from '../src/i18n';
import { fanShortLabels, modeLabel } from '../src/ui/modes';
import { litFanSegments } from '../src/ui/geometry';
import type { HomeAssistant } from '../src/types';
import { AREAS, FLOORS, allFixtures, makeHass, mergeFixtures } from './fixtures';
import { TRV, trvFixtures } from './fixtures/trv';

const K = 'climate.keuken_airco';
type AnyEl = HTMLElement & Record<string, any>;

/** A realistic hass with everything that must never leak sitting in it. */
function hassFor(): HomeAssistant {
  const f = mergeFixtures(allFixtures);
  f.states['sensor.status_probe'] = { entity_id: 'sensor.status_probe', state: '4242.5', attributes: { friendly_name: 'Probe Friendly' } } as never;
  const hass = makeHass(f, '°C');
  Object.assign(hass, {
    areas: structuredClone(AREAS),
    floors: structuredClone(FLOORS),
    language: 'nl',
    locale: { language: 'nl' },
    themes: { darkMode: true },
    user: { id: 'u1', name: 'Zoë Geheim', is_admin: true },
  });
  Object.assign(hass.config, { version: '2025.11.1', latitude: 52.123456, longitude: 4.654321, location_name: 'Thuisadres 7', time_zone: 'Europe/Amsterdam' });
  return hass;
}

const DIAL_CONFIG = {
  type: 'custom:liquid-climate-card',
  entity: K,
  name: 'Eigen naam',
  api_token: 'abc123',
  password: 'hunter2',
  sensors: { humidity: false, outdoor: 'sensor.my_outdoor', secret_x: 'nope' },
  status_entities: [
    {
      entity: 'sensor.status_probe',
      name: 'Probe',
      Secret_X: 'nope',
      nested: { Access_Token: 'nope', ok: 1 },
      authorization: 'Bearer nope-header',
      webhook_id: 'nope-hook',
      note: 'Bearer nope-value',
      link: 'https://example.org/x?token=nope-url',
    },
    { entity: 'input_boolean.missing' },
  ],
};

describe('stripSecrets', () => {
  it('drops token, password, key and secret names at any depth, in any case', () => {
    expect(stripSecrets({ a: 1, API_KEY: 'x', n: { MyPassword: 'x', list: [{ secret_x: 1, ok: 2 }] }, t: 'x', Token_2: 'y' })).toEqual({
      a: 1,
      n: { list: [{ ok: 2 }] },
      t: 'x',
    });
  });
  it('drops the wider credential names and the whole word pin', () => {
    expect(
      stripSecrets({ authorization: 'x', webhook_id: 'x', Cookie: 'x', client_credentials: 'x', signature: 'x', jwt: 'x', pin: '1', door_pin: '1', pwd: 'x', passwd: 'x', pause_entity: 'p', ok: 1 }),
    ).toEqual({ pause_entity: 'p', ok: 1 });
  });
  it('redacts string values that look secret, at any depth', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc-DEF_123';
    const out = JSON.stringify(
      stripSecrets({
        a: 'Bearer abc.def',
        b: { c: [jwt, 'https://x.example/api?token=zzz', 'https://x.example/p?a=1&api_key=zzz', 'https://x.example/ok?page=2', 'sensor.fine'] },
      }),
    );
    for (const leak of ['abc.def', jwt, 'zzz']) expect(out).not.toContain(leak);
    expect(out).toContain('https://x.example/ok?page=2');
    expect(out).toContain('sensor.fine');
    expect(out.match(/\[redacted\]/g)).toHaveLength(4);
  });
  it('no field of the real config schema is dropped', () => {
    const cfg = {
      type: 't', entity: 'e', name: 'n', temperature_sensor: 's', write_delay: 1, config_version: 1, tap_action: 'sheet', pause_entity: 'p', icon_only: false,
      sensors: { humidity: 'auto', outdoor: 'auto', energy: 'auto', cloud_limit: 'auto', health: 'auto' },
      controls: { modes: [], fan: true, swing: true, swing_horizontal: true, presets: true },
      status_entities: [{ entity: 'e', name: 'n', icon: 'i', actions: [], menu: true }],
      look: { glass: 'theme', tint: 1, blur: 1, motion: 'rich' },
      source: 'auto', entities: [], area: 'a', floor: 'f', group_by: 'floor', exclude: [], rooms: [], title: 't',
    };
    expect(stripSecrets(cfg)).toEqual(cfg);
  });
});

describe('VERSION', () => {
  it('is the package.json version', () => {
    expect(VERSION).toBe(pkg.version);
  });
});

describe('buildDiagnostics', () => {
  const d = buildDiagnostics({ cardType: 'custom:liquid-climate-card', config: DIAL_CONFIG, hass: hassFor(), registry: allFixtures.registry as never }) as Record<string, any>;
  const json = diagnosticsText(d);

  it('has versions, card type, language, theme and user agent', () => {
    expect(d.card_version).toBe(VERSION);
    expect(d.card_type).toBe('liquid-climate-card');
    expect(d.ha_version).toBe('2025.11.1');
    expect(d.language).toBe('nl');
    expect(d.dark_mode).toBe(true);
    expect(d.user_agent).toBe(navigator.userAgent);
  });

  it('keeps the config as configured, without secrets', () => {
    expect(d.config.name).toBe('Eigen naam');
    expect(d.config.sensors).toEqual({ humidity: false, outdoor: 'sensor.my_outdoor' });
    expect(d.config.status_entities[0]).toEqual({ entity: 'sensor.status_probe', name: 'Probe', nested: { ok: 1 }, note: '[redacted]', link: '[redacted]' });
    for (const secret of ['api_token', 'abc123', 'password', 'hunter2', 'secret_x', 'Secret_X', 'Access_Token', 'nope', 'authorization', 'webhook_id']) expect(json).not.toContain(secret);
  });

  it('says how each sensor role was found', () => {
    expect(d.sensors.humidity).toEqual({ source: 'hidden', entities: [] });
    expect(d.sensors.outdoor).toEqual({ source: 'override', entities: ['sensor.my_outdoor'] });
    expect(d.sensors.energy.source).toBe('auto');
    expect(d.sensors.energy.entities.length).toBeGreaterThan(0);
    expect(d.sensors.health.source).toBe('auto');
    expect(d.sensors.room_temperature).toEqual({ source: 'auto', entities: [K], via: 'current_temperature' });
  });

  it('lists the climate capabilities and nothing else of the entity', () => {
    const a = hassFor().states[K].attributes;
    expect(d.entity).toBe(K);
    expect(Object.keys(d.climate).sort()).toEqual([
      'exists', 'fan_modes', 'hvac_modes', 'max_temp', 'min_temp', 'preset_modes', 'supported_features',
      'swing_horizontal_modes', 'swing_modes', 'target_temp_step', 'temperature_unit',
    ]);
    expect(d.climate.hvac_modes).toEqual(a.hvac_modes);
    expect(d.climate.fan_modes).toEqual(a.fan_modes);
    expect(d.climate.swing_modes).toEqual(a.swing_modes);
    expect(d.climate.preset_modes).toEqual(a.preset_modes ?? []);
    expect(d.climate.min_temp).toBe(a.min_temp);
    expect(d.climate.max_temp).toBe(a.max_temp);
    expect(d.climate.temperature_unit).toBe('°C');
  });

  it('reports status rows by domain and existence, never a value', () => {
    expect(d.status_rows).toEqual([
      { domain: 'sensor', exists: true },
      { domain: 'input_boolean', exists: false },
    ]);
    expect(json).not.toContain('4242.5');
  });

  it('leaves out history, states, names, users and location', () => {
    const a = hassFor().states[K].attributes;
    const needles = [
      'current_temperature":', 'friendly_name', 'Probe Friendly', 'Zoë', 'Geheim', '"user"', '52.123456', '4.654321',
      'latitude', 'longitude', 'Thuisadres', 'location_name', 'Europe/Amsterdam', 'last_changed', 'history',
    ];
    for (const needle of needles) expect(json).not.toContain(needle);
    expect(json).not.toContain(String(a.friendly_name));
  });

  it('runs per room for a cluster', () => {
    const c = buildDiagnostics({
      cardType: 'custom:liquid-climate-cluster',
      config: { type: 'custom:liquid-climate-cluster', entities: [K, { entity: 'climate.nagelsalon_airco', token: 'x' }], api_key: 'x' },
      hass: hassFor(),
    }) as Record<string, any>;
    expect(c.card_type).toBe('liquid-climate-cluster');
    expect(c.rooms.map((r: any) => r.entity)).toEqual([K, 'climate.nagelsalon_airco']);
    expect(c.rooms[0].sensors.outdoor.source).toBe('auto');
    expect(Object.keys(c.rooms[0].sensors).sort()).toEqual(['battery', 'cloud_limit', 'energy', 'health', 'outdoor', 'room_temperature', 'valve', 'window']);
    expect(c.rooms[0].status_rows).toBeUndefined();
    expect(c.rooms[0].climate.hvac_modes.length).toBeGreaterThan(0);
    expect(diagnosticsText(c)).not.toContain('api_key');
    expect(diagnosticsText(c)).not.toContain('"token"');
  });

  it('names no area or floor of the house', () => {
    const hass = hassFor();
    Object.assign(hass, {
      areas: { a1: { area_id: 'a1', name: 'Thuisadres 7', floor_id: 'f1' } },
      floors: { f1: { floor_id: 'f1', name: 'Thuisadres 7 verdieping' } },
    });
    const c = buildDiagnostics({ cardType: 'custom:liquid-climate-cluster', config: { type: 'custom:liquid-climate-cluster', source: 'auto', group_by: 'area' }, hass });
    expect(diagnosticsText(c)).not.toContain('Thuisadres');
  });

  it('tile and badge report only the roles they read: health, battery, the window (badge) and the room temperature', () => {
    const roles: Record<string, string[]> = {
      'custom:liquid-climate-tile': ['battery', 'health', 'room_temperature'],
      'custom:liquid-climate-badge': ['battery', 'health', 'room_temperature', 'window'],
    };
    for (const cardType of Object.keys(roles)) {
      const x = buildDiagnostics({ cardType, config: { entity: K }, hass: hassFor() }) as Record<string, any>;
      expect(Object.keys(x.sensors).sort()).toEqual(roles[cardType]);
      expect(x.status_rows).toBeUndefined();
    }
  });

  it('a lone opening contact is the window only when the valve role resolves', () => {
    const f = mergeFixtures(allFixtures, trvFixtures);
    delete f.states['binary_sensor.trv_sonoff_window_open'];
    f.states['binary_sensor.o'] = { entity_id: 'binary_sensor.o', state: 'on', attributes: { device_class: 'opening' } } as never;
    f.entities['binary_sensor.o'] = { entity_id: 'binary_sensor.o', platform: 'mqtt', device_id: 'dev_trv_sonoff', translation_key: null };
    const windowOf = (sensors: Record<string, unknown>) =>
      (buildDiagnostics({ cardType: 'custom:liquid-climate-badge', config: { entity: TRV.sonoff, sensors }, hass: makeHass(f), registry: f.registry as never }) as Record<string, any>).sensors.window.entities;
    expect(windowOf({ valve: false })).toEqual([]);
    expect(windowOf({ valve: 'auto' })).toEqual(['binary_sensor.o']);
  });

  it('survives a missing entity and a bare hass', () => {
    const bare = { states: {}, entities: {}, devices: {}, config: { unit_system: { temperature: '°C' } }, callService: () => undefined } as unknown as HomeAssistant;
    const x = buildDiagnostics({ cardType: 'liquid-climate-card', config: { entity: 'climate.nope' }, hass: bare }) as Record<string, any>;
    expect(x.climate).toEqual({ exists: false });
    expect(x.language).toBeNull();
    expect(x.ha_version).toBeNull();
  });
});

// ---- Editors --------------------------------------------------------------

const EDITORS = [
  { tag: 'liquid-climate-card-editor', type: 'custom:liquid-climate-card', card: 'dial' },
  { tag: 'liquid-climate-tile-editor', type: 'custom:liquid-climate-tile', card: 'tile' },
  { tag: 'liquid-climate-badge-editor', type: 'custom:liquid-climate-badge', card: 'badge' },
  { tag: 'liquid-climate-cluster-editor', type: 'custom:liquid-climate-cluster', card: 'cluster' },
] as const;

async function editor(tag: string, type: string, lang = 'en') {
  const hass = hassFor();
  Object.assign(hass, { language: lang, locale: { language: lang } });
  const ed = document.createElement(tag) as AnyEl;
  ed.setConfig({ type, entity: tag === 'liquid-climate-cluster-editor' ? undefined : K, api_token: 'zzz' });
  ed.hass = hass;
  document.body.append(ed);
  await ed.updateComplete;
  return ed;
}
const $ = (ed: AnyEl, sel: string) => ed.shadowRoot!.querySelector(sel) as HTMLElement | null;
const $$ = (ed: AnyEl, sel: string) => [...ed.shadowRoot!.querySelectorAll(sel)] as HTMLElement[];
const settle = async (ed: AnyEl) => {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await ed.updateComplete;
  }
};
/**
 * The footer rendered on its own: happy-dom mismatches the parts of the Look section above it
 * (the same reason test/i18n-render.test.ts does this), so the editor's own footer is not found.
 */
const foot = (ed: AnyEl) => {
  const box = document.createElement('div');
  render(ed._footer(), box);
  return box.querySelector('button') as HTMLButtonElement;
};
const label = (ed: AnyEl) => foot(ed).textContent!.trim();
const setClipboard = (v: unknown) => Object.defineProperty(navigator, 'clipboard', { value: v, configurable: true });

afterEach(() => {
  document.body.innerHTML = '';
  setClipboard(undefined);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.each(EDITORS)('$card editor: copy diagnostics', ({ tag, type, card }) => {
  it('copies the JSON and confirms', async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    setClipboard({ writeText });
    const ed = await editor(tag, type);
    const btn = foot(ed);
    expect(btn.textContent!.trim()).toBe('Copy diagnostics');
    btn.click();
    await settle(ed);
    expect(writeText).toHaveBeenCalledTimes(1);
    const sent = writeText.mock.calls[0][0];
    expect(sent).toBe(JSON.stringify(JSON.parse(sent), null, 2));
    expect(JSON.parse(sent).card_type).toBe(type.replace('custom:', ''));
    expect(sent).not.toContain('zzz');
    expect(sent).not.toContain('api_token');
    expect(label(ed)).toBe('Copied');
  });

  it('goes back to the label after a moment', async () => {
    setClipboard({ writeText: async () => undefined });
    const ed = await editor(tag, type);
    vi.useFakeTimers();
    (foot(ed)).click();
    await vi.advanceTimersByTimeAsync(10);
    await ed.updateComplete;
    expect(label(ed)).toBe('Copied');
    await vi.advanceTimersByTimeAsync(2100);
    await ed.updateComplete;
    expect(label(ed)).toBe('Copy diagnostics');
  });

  it('falls back to a hidden textarea without a clipboard', async () => {
    setClipboard(undefined);
    const exec = vi.fn(() => true);
    (document as any).execCommand ??= () => false;
    vi.spyOn(document, 'execCommand').mockImplementation(exec);
    const ed = await editor(tag, type);
    (foot(ed)).click();
    await settle(ed);
    expect(exec).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
    expect(label(ed)).toBe('Copied');
  });

  it('shows an error text when nothing works, in the language', async () => {
    setClipboard({ writeText: async () => Promise.reject(new Error('no')) });
    (document as any).execCommand ??= () => false;
    vi.spyOn(document, 'execCommand').mockReturnValue(false);
    const ed = await editor(tag, type, 'nl');
    (foot(ed)).click();
    await settle(ed);
    expect(label(ed)).toBe(LOCALES.nl['editor.diagnosticsFailed']);
  });

  it('announces the result in a status region and ends it when the editor goes away', async () => {
    setClipboard({ writeText: async () => undefined });
    const ed = await editor(tag, type);
    // The footer rendered on its own, as foot() does.
    const status = () => {
      const box = document.createElement('div');
      render(ed._footer(), box);
      return box.querySelector('[role=status]')?.textContent?.trim();
    };
    expect(status()).toBe('');
    foot(ed).click();
    await settle(ed);
    expect(status()).toBe('Copied');
    ed.remove();
    expect(ed._copy).toBe('idle');
  });

  it('does not touch a removed editor when the copy finishes late', async () => {
    let done!: () => void;
    setClipboard({ writeText: () => new Promise<void>((r) => (done = r)) });
    const ed = await editor(tag, type);
    foot(ed).click();
    ed.remove();
    done();
    await new Promise((r) => setTimeout(r, 0));
    expect(ed._copy).toBe('idle');
  });

  it('has touch targets of at least 44px', async () => {
    const ed = await editor(tag, type);
    const css = [(ed.constructor as any).styles].flat(5).map((s: any) => s.cssText ?? '').join('\n');
    expect(css).toMatch(/\.foot button\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.help\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.lblrow\s*\{[^}]*min-height:\s*44px/);
    expect(css).not.toMatch(/\.help\s*\{[^}]*margin:\s*-/);
  });

  it('keeps the help links out of labels and tablists', async () => {
    const ed = await editor(tag, type);
    for (const a of $$(ed, 'a.help')) {
      expect(a.closest('label')).toBeNull();
      expect(a.closest('[role=tablist]')).toBeNull();
    }
    if (card === 'badge') {
      const input = $(ed, 'input[list=lc-pause-ids]')!;
      expect(input.closest('label')).toBeNull();
      expect(input.getAttribute('aria-labelledby')).toBe('lc-pause-label');
      expect($(ed, '#lc-pause-label')?.textContent?.trim()).toBe(LOCALES.en['editor.pauseEntity']);
    }
  });
});

const ANCHORS: Record<string, string[]> = {
  dial: ['entity', 'sensors', 'controls', 'look', 'status-rows', 'write-delay', 'write-hold'],
  tile: ['entity', 'tap-action', 'write-delay', 'write-hold', 'look'],
  badge: ['entity', 'pause', 'tap-action', 'look'],
  cluster: ['source', 'rooms', 'write-delay', 'write-hold', 'look'],
};

describe.each(EDITORS)('$card editor: help links', ({ tag, type, card }) => {
  async function links(ed: AnyEl) {
    // The dial shows one tab at a time: visit all of them.
    const seen = new Map<string, HTMLAnchorElement>();
    const tabs = $$(ed, '[role=tab]');
    for (let i = 0; i < Math.max(1, tabs.length); i++) {
      if (tabs.length) tabs[i].click();
      await settle(ed);
      for (const a of $$(ed, 'a.help') as HTMLAnchorElement[]) seen.set(a.getAttribute('href')!, a);
    }
    return seen;
  }

  it('links every section to its docs anchor', async () => {
    const ed = await editor(tag, type);
    const seen = await links(ed);
    const want = ANCHORS[card].map((slug) => `${DOCS_URL}/cards/${card}#${card}-${slug}`);
    expect([...seen.keys()].sort()).toEqual([...want].sort());
    for (const a of seen.values()) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
      expect(a.getAttribute('aria-label')).toMatch(/^Help: \S/);
    }
  });

  it('translates the aria-label in every language', async () => {
    for (const lang of Object.keys(LOCALES)) {
      const ed = await editor(tag, type, lang);
      const a = $(ed, 'a.help')!;
      const prefix = LOCALES[lang]['editor.help'].split('{section}')[0];
      expect(a.getAttribute('aria-label')!.startsWith(prefix)).toBe(true);
      expect(a.getAttribute('aria-label')).not.toContain('{section}');
      ed.remove();
    }
  });
});

// ---- Swing, fan and preset names ---------------------------------------------

describe('option names fall back to ours when Home Assistant has none', () => {
  const VALUES = [
    'stop', 'fixed', 'swing', 'vertical', 'horizontal', 'both', 'auto', 'none', 'eco', 'boost', 'away', 'comfort', 'home',
    'sleep', 'activity', 'quiet', 'silence', 'low', 'medium', 'high', 'middle', 'diffuse', 'focus', 'top', 'on', 'off',
  ];
  const STOP: Record<string, string> = { en: 'Fixed', nl: 'Vast', de: 'Fest', fr: 'Fixe', es: 'Fijo', it: 'Fisso' };
  const NONE: Record<string, string> = { en: 'None', nl: 'Geen', de: 'Keine', fr: 'Aucun', es: 'Ninguno', it: 'Nessuno' };
  const entity = { entity_id: K, state: 'cool', attributes: {} };

  describe.each(Object.keys(LOCALES))('%s', (lang) => {
    const base = { language: lang };
    const variants: [string, any][] = [
      ['localize returns an empty string', { ...base, localize: () => '' }],
      ['no localize at all', base],
      [
        'formatEntityAttributeValue echoes the value, capitalised',
        { ...base, localize: () => '', formatEntityAttributeValue: (_s: unknown, _k: string, v: string) => v.charAt(0).toUpperCase() + v.slice(1) },
      ],
      ['localize returns the key', { ...base, localize: (k: string) => k }],
    ];
    it.each(variants)('%s', (_name, hass) => {
      expect(optionName(hass, 'swing_mode', 'stop', entity)).toBe(STOP[lang]);
      expect(optionName(hass, 'swing_mode', 'Stop', entity)).toBe(STOP[lang]);
      expect(optionName(hass, 'preset_mode', 'none', entity)).toBe(NONE[lang]);
      for (const v of VALUES) {
        const label = optionName(hass, 'fan_mode', v, entity);
        expect(label, `${lang} ${v}`).toBe(LOCALES[lang][`option.${v}`] ?? LOCALES.en[`option.${v}`]);
        expect(label).not.toBe('');
      }
    });

    it('a real Home Assistant translation still wins', () => {
      const hass = { ...base, localize: (k: string) => (k.endsWith('.swing_mode.state.stop') ? 'Van HA' : '') };
      expect(optionName(hass, 'swing_mode', 'stop')).toBe('Van HA');
    });

    it('a distinct formatting from Home Assistant is kept', () => {
      const hass = { ...base, localize: () => '', formatEntityAttributeValue: () => 'Van HA' };
      expect(optionName(hass, 'swing_mode', 'stop', entity)).toBe('Van HA');
      const eco = { ...base, localize: () => '', formatEntityAttributeValue: () => 'ECO' };
      expect(optionName(eco, 'preset_mode', 'eco', entity)).toBe('ECO');
      const viaKey = { ...base, localize: (k: string) => (k.endsWith('.preset_mode.state.eco') ? 'ECO' : '') };
      expect(optionName(viaKey, 'preset_mode', 'eco')).toBe('ECO');
    });

    it('unknown values stay readable', () => {
      expect(optionName(base, 'preset_mode', 'wind_free')).toBe('Wind free');
      expect(optionName(base, 'swing_mode', '3')).toBe('3');
    });
  });

  it('every language has every known option', () => {
    for (const lang of Object.keys(LOCALES)) for (const v of VALUES) expect(LOCALES[lang][`option.${v}`], `${lang} option.${v}`).toBeTruthy();
  });
});

// ---- Mode buttons and fan letters --------------------------------------------

describe.each(Object.keys(LOCALES))('%s: auto and heat_cool', (lang) => {
  it('have different compact labels and names when both are offered', () => {
    const hass = { language: lang } as never;
    const modes = ['off', 'heat_cool', 'auto'];
    const compact = modes.map((m) => modeLabel(hass, m, true, modes));
    const names = modes.map((m) => modeLabel(hass, m, false, modes));
    expect(new Set(compact).size, compact.join(',')).toBe(3);
    expect(new Set(names).size, names.join(',')).toBe(3);
  });
});

describe('dial mode buttons', () => {
  it.each(Object.keys(LOCALES))('%s: unique visible labels and aria-labels', async (lang) => {
    const hass = hassFor();
    Object.assign(hass, { language: lang, locale: { language: lang } });
    hass.states['climate.ecobee'] = {
      entity_id: 'climate.ecobee',
      state: 'heat_cool',
      attributes: { hvac_modes: ['heat_cool', 'auto', 'heat', 'cool', 'off'], min_temp: 7, max_temp: 35, target_temp_step: 0.5, current_temperature: 21, target_temp_low: 20, target_temp_high: 24, supported_features: 2 | 1 | 384 },
    } as never;
    const el = document.createElement('liquid-climate-card') as AnyEl;
    el.setConfig({ type: 'custom:liquid-climate-card', entity: 'climate.ecobee' });
    el.hass = hass;
    document.body.append(el);
    await el.updateComplete;
    const buttons = [...el.shadowRoot!.querySelectorAll('.modes button')] as HTMLElement[];
    expect(buttons.length).toBe(5);
    const visible = buttons.map((b) => b.textContent!.trim());
    const aria = buttons.map((b) => b.getAttribute('aria-label'));
    expect(new Set(visible).size, visible.join(',')).toBe(5);
    expect(new Set(aria).size, aria.join(',')).toBe(5);
  });
});

describe('fan ring letters for on_low, on_high, auto_low, auto_high, off', () => {
  const VALUES = ['on_low', 'on_high', 'auto_low', 'auto_high', 'off'];
  it.each(Object.keys(LOCALES))('%s: unique letters', (lang) => {
    const names = VALUES.map((v) => optionName({ language: lang } as never, 'fan_mode', v));
    const letters = fanShortLabels(VALUES, names);
    expect(new Set(letters).size, letters.join(',')).toBe(VALUES.length);
  });
  it('off lights no segment, even as the top of the ring', () => {
    expect(litFanSegments(4, 5, false, 4)).toEqual([false, false, false, false, false]);
    expect(litFanSegments(2, 3, false, 0)).toEqual([false, true, true]);
    expect(litFanSegments(4, 5, false)).toEqual([true, true, true, true, true]);
  });
});
