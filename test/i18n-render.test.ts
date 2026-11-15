// @vitest-environment happy-dom
import { render } from 'lit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/index';
import { LOCALES } from '../src/i18n';
import { forgetModes } from '../src/cards/shared/writer';
import { AREAS, FLOORS, allFixtures, makeHass, mergeFixtures, type Fixture } from './fixtures';
import type { HomeAssistant } from '../src/types';

type AnyEl = HTMLElement & Record<string, any>;
const K = 'climate.keuken_airco';
const S = 'climate.slaapkamer_airco';
const N = 'climate.nagelsalon_airco';
const DUAL = 'climate.dual_setpoint';
const FLAG = 'binary_sensor.keuken_airco_is_in_error_state';

beforeEach(() => {
  vi.useFakeTimers();
  forgetModes();
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

// Names that are not English UI words, so a hit in the render is a leftover literal.
const EXTRA: Record<string, { state: string; attributes?: Record<string, unknown> }> = {
  'input_select.stookstand': { state: 'Zuinig', attributes: { friendly_name: 'Stookstand', options: ['Zuinig', 'Ruim'] } },
  'input_boolean.pauzeknop': { state: 'on', attributes: { friendly_name: 'Pauzeknop' } },
  'script.toepassen': { state: 'off', attributes: { friendly_name: 'Toepassen nu' } },
  'script.lopend': { state: 'on', attributes: { friendly_name: 'Lopend ding' } },
  'script.kapot': { state: 'unavailable', attributes: { friendly_name: 'Kapot ding' } },
  'automation.schema': { state: 'on', attributes: { friendly_name: 'Weekschema', id: '42' } },
  'sensor.vocht': { state: '51.5', attributes: { friendly_name: 'Vochtmeter', unit_of_measurement: '%' } },
};

function hassFor(language: string, tweak?: (f: Fixture) => void, unit = '°C'): HomeAssistant {
  const f = mergeFixtures(allFixtures);
  for (const [id, e] of Object.entries(EXTRA)) f.states[id] = { entity_id: id, state: e.state, attributes: e.attributes ?? {} };
  tweak?.(f);
  const hass = makeHass(f, unit);
  hass.areas = structuredClone(AREAS);
  hass.floors = structuredClone(FLOORS);
  hass.user = { is_admin: true };
  hass.language = language;
  hass.locale = { language, number_format: 'language' };
  // Like the dev harness: Home Assistant knows no key, so our own strings show.
  hass.localize = () => '';
  return hass;
}

async function mount(tag: string, cfg: Record<string, unknown>, hass: HomeAssistant): Promise<AnyEl> {
  const el = document.createElement(tag) as AnyEl;
  el.setConfig({ type: `custom:${tag}`, ...cfg });
  el.hass = hass;
  document.body.append(el);
  await settle(el);
  return el;
}

async function settle(el: AnyEl) {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
    await el.updateComplete;
  }
}

const ATTRS = ['aria-label', 'title', 'placeholder', 'aria-valuetext', 'alt', 'label', 'aria-description'];

/** All visible text and text-bearing attributes of an element, through every shadow root. */
function collect(el: Element, out: string[] = []): string[] {
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      const text = node.textContent?.replace(/\s+/g, ' ').trim();
      if (text) out.push(text);
      return;
    }
    if (node.nodeType !== 1 && node.nodeType !== 11) return;
    if (node.nodeType === 1) {
      const e = node as Element;
      if (['STYLE', 'SCRIPT'].includes(e.tagName)) return;
      for (const a of ATTRS) {
        const v = e.getAttribute(a);
        if (v) out.push(v);
      }
      if (e.shadowRoot) walk(e.shadowRoot);
    }
    node.childNodes.forEach(walk);
  };
  walk(el);
  return out;
}

const word = (piece: string) => new RegExp(`(?<![\\p{L}\\d])${piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\d])`, 'u');

/**
 * The English wording that differs from the language's own, cut at the {placeholders}, in pieces long
 * enough to mean something. A piece the language itself uses as a word somewhere ("Preset" in de, "Page Down")
 * is not a leftover.
 */
function englishPieces(lang: string): { key: string; piece: string }[] {
  const pieces: { key: string; piece: string }[] = [];
  const ownText = Object.values(LOCALES[lang]).join('\n');
  for (const [key, en] of Object.entries(LOCALES.en)) {
    if (LOCALES[lang][key] === en) continue;
    for (const raw of en.split(/\{\w+\}/)) {
      const piece = raw.replace(/^[\s,.:;()°]+|[\s,.:;()°]+$/g, '');
      if (piece.length >= 4 && !word(piece).test(ownText)) pieces.push({ key, piece });
    }
  }
  return pieces;
}

// Proper nouns and units that are the same in every language never come from en.json pieces on their own.
const ALLOWED = ['Daikin', 'Onecta', 'kWh'];

/** Short English UI words ("Off", "Run", "Down") that the language translates, by key. */
function shortWords(lang: string): Map<string, string> {
  const own = new Set(Object.values(LOCALES[lang]));
  const out = new Map<string, string>();
  for (const [key, en] of Object.entries(LOCALES.en)) {
    if (en.length <= 6 && !en.includes('{') && LOCALES[lang][key] !== en && !own.has(en)) out.set(en, key);
  }
  return out;
}

function leftovers(texts: string[], lang = 'nl'): string[] {
  // Entity ids (climate.keuken_airco) are data, not UI text.
  const hay = texts.join('\n').replace(/\b[a-z_]+\.[a-z0-9_*]+/g, '');
  const short = shortWords(lang);
  const exact = [...new Set(texts)].filter((x) => short.has(x)).map((x) => `${short.get(x)}: exactly "${x}"`);
  return [
    ...englishPieces(lang)
      .filter(({ piece }) => !ALLOWED.includes(piece) && word(piece).test(hay))
      .map(({ key, piece }) => `${key}: "${piece}"`),
    ...exact,
  ];
}

const click = (el: Element | null | undefined) => (el as HTMLElement).click();
const q = (el: AnyEl, sel: string) => el.shadowRoot!.querySelector(sel) as HTMLElement | null;
const qa = (el: AnyEl, sel: string) => [...el.shadowRoot!.querySelectorAll(sel)] as HTMLElement[];

describe('the leftover check itself', () => {
  it('finds English literals', () => {
    expect(leftovers(['Turn off', 'Verwarmen'])).toContain('dial.turnOff: "Turn off"');
    expect(leftovers(['Uitzetten'])).toEqual([]);
  });
  it('finds a short English word standing alone, but not inside a longer text', () => {
    expect(leftovers(['Off', 'Run', 'Down'])).toEqual(['option.off: exactly "Off"', 'menu.run: exactly "Run"', 'editor.down: exactly "Down"']);
    expect(leftovers(['Uit', 'Uitvoeren', 'Off the hook'])).not.toContain('option.off: exactly "Off"');
  });
  it('covers a good share of en.json', () => {
    expect(englishPieces('nl').length).toBeGreaterThan(150);
  });
});

describe('dial in nl', () => {
  const STATUS = [
    { entity: 'input_select.stookstand', actions: ['script.toepassen', 'script.lopend', 'automation.schema'] },
    { entity: 'input_boolean.pauzeknop' },
    { entity: 'script.kapot', actions: ['script.nope'] },
    { entity: 'sensor.vocht' },
    { entity: 'climate.nagelsalon_airco', name: 'Naastdeur' },
  ];

  async function dial(cfg: Record<string, unknown>, tweak?: (f: Fixture) => void) {
    // The detected figures need the registry, so they are set the way the editor writes them.
    const sensors = {
      outdoor: 'sensor.keuken_airco_buitentemperatuur',
      energy: ['sensor.keuken_airco_energie_verwarmen_dag'],
      cloud_limit: 'sensor.keuken_airco_gateway_ratelimit_remaining_day',
    };
    return mount('liquid-climate-card', { entity: K, status_entities: STATUS, sensors, ...cfg }, hassFor('nl', tweak));
  }

  it('shows no English UI text: modes, chips, info, status menu, edit links', async () => {
    const card = await dial({});
    click(q(card, '.status .row'));
    await settle(card);
    const texts = collect(card);
    expect(leftovers(texts)).toEqual([]);
    const all = texts.join('\n');
    // It does render our nl strings: header, modes, chips, info labels, menu.
    for (const key of ['modeVerb.heat', 'dial.mode', 'dial.vertical', 'detect.outdoor', 'detect.humidity', 'detect.energy', 'detect.cloud', 'menu.scripts', 'menu.automations', 'menu.details', 'menu.run', 'menu.running', 'menu.unavailable']) {
      expect(all, key).toContain(LOCALES.nl[key].replace(/\{\w+\}/g, '').trim());
    }
    expect(texts.some((x) => x === LOCALES.nl['menu.editLabel'].replace('{name}', 'Toepassen nu'))).toBe(true);
    // Decimal comma.
    expect(all).toContain('19,5');
  });

  it('a problem, a pending change, the off state and the missing and unavailable cards', async () => {
    const card = await dial({}, (f) => (f.states[FLAG].state = 'on'));
    const alert = collect(q(card, '.alert')!).join(' ');
    expect(alert).toContain('meldt een probleem');
    expect(leftovers(collect(card))).toEqual([]);

    // happy-dom matches the lit parts of the dial's big template wrongly from its svg on (the same at the commit
    // before this one), so what follows the svg is rendered on its own: the steppers.
    // The centre (big temperature, the Inside line) follows the svg too, but rendering _renderDial on its own does not help:
    // happy-dom drops the .center div of that template altogether, so those two strings are not render-checked.
    const steps = document.createElement('div');
    render(card._renderSteps(card._context()), steps);
    expect(leftovers(collect(steps))).toEqual([]);
    expect([...steps.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual([LOCALES.nl['common.stepDown'], LOCALES.nl['common.stepUp']]);

    const off = await mount('liquid-climate-card', { entity: N }, hassFor('nl'));
    expect(leftovers(collect(off))).toEqual([]);
    expect(collect(off).join(' ')).toContain('Uit');

    const gone = await mount('liquid-climate-card', { entity: 'climate.nope' }, hassFor('nl'));
    expect(collect(gone).join(' ')).toContain('niet gevonden');
    expect(leftovers(collect(gone))).toEqual([]);

    const dead = await mount('liquid-climate-card', { entity: S }, hassFor('nl', (f) => (f.states[S].state = 'unavailable')));
    expect(collect(dead).join(' ')).toContain(LOCALES.nl['common.unavailable']);
  });

  it('a dual setpoint unit and a unit without a setpoint', async () => {
    const dual = await mount('liquid-climate-card', { entity: DUAL }, hassFor('nl'));
    expect(leftovers(collect(dual))).toEqual([]);
    expect(collect(dual).join(' ')).toContain('Temperatuurbereik');
    const fan = await mount('liquid-climate-card', { entity: 'climate.no_swing' }, hassFor('nl', (f) => (f.states['climate.no_swing'].state = 'fan_only')));
    expect(leftovers(collect(fan))).toEqual([]);
    expect(collect(fan).join(' ')).toContain(LOCALES.nl['dial.noSetpoint']);
  });

  it('the Fahrenheit unit and a card with an unplaceable value show readable names', async () => {
    const card = await mount('liquid-climate-card', { entity: 'climate.fahrenheit' }, hassFor('nl', undefined, '°F'));
    expect(leftovers(collect(card))).toEqual([]);
  });
});

describe('tile in nl', () => {
  it('shows no English UI text, also in the sheet it opens', async () => {
    const tile = await mount('liquid-climate-tile', { entity: K }, hassFor('nl'));
    expect(leftovers(collect(tile))).toEqual([]);
    expect(collect(tile).join(' ')).toContain('binnen');
    click(q(tile, 'button.body'));
    await settle(tile);
    const sheet = q(tile, 'liquid-climate-sheet') as AnyEl;
    await settle(sheet);
    const texts = collect(tile);
    expect(texts).toContain(LOCALES.nl['common.close']);
    expect(leftovers(texts)).toEqual([]);
  });

  it('error, range, off, missing and unavailable', async () => {
    const err = await mount('liquid-climate-tile', { entity: K }, hassFor('nl', (f) => (f.states[FLAG].state = 'on')));
    expect(collect(err).join(' ')).toContain(LOCALES.nl['common.error']);
    const range = await mount('liquid-climate-tile', { entity: DUAL }, hassFor('nl'));
    expect(collect(range).join(' ')).toContain('Doelbereik');
    const off = await mount('liquid-climate-tile', { entity: N }, hassFor('nl'));
    const gone = await mount('liquid-climate-tile', { entity: 'climate.nope' }, hassFor('nl'));
    const dead = await mount('liquid-climate-tile', { entity: S }, hassFor('nl', (f) => (f.states[S].state = 'unavailable')));
    for (const el of [err, range, off, gone, dead]) expect(leftovers(collect(el))).toEqual([]);
    expect(collect(gone).join(' ')).toContain('niet gevonden');
    expect(collect(dead).join(' ')).toContain(LOCALES.nl['common.unavailable']);
  });
});

describe('badge in nl', () => {
  it('error, paused, off, on and unavailable, with their labels', async () => {
    const hass = (tweak?: (f: Fixture) => void) => hassFor('nl', tweak);
    const on = await mount('liquid-climate-badge', { entity: K }, hass());
    const err = await mount('liquid-climate-badge', { entity: K }, hass((f) => (f.states[FLAG].state = 'on')));
    const paused = await mount('liquid-climate-badge', { entity: K, pause_entity: 'input_boolean.pauzeknop' }, hass());
    const off = await mount('liquid-climate-badge', { entity: N }, hass());
    const dead = await mount('liquid-climate-badge', { entity: S }, hass((f) => (f.states[S].state = 'unavailable')));
    const noTemp = await mount('liquid-climate-badge', { entity: K, temperature_sensor: 'sensor.nope' }, hass((f) => delete f.states[K].attributes.current_temperature));
    for (const el of [on, err, paused, off, dead, noTemp]) expect(leftovers(collect(el))).toEqual([]);
    expect(collect(err).join(' ')).toContain(LOCALES.nl['common.error']);
    expect(collect(paused).join(' ')).toContain(LOCALES.nl['common.paused']);
    expect(collect(off).join(' ')).toContain(LOCALES.nl['common.off']);
    expect(collect(noTemp).join(' ')).toContain(LOCALES.nl['modeVerb.heat']);
    expect(collect(on).join(' ')).toContain('21,0°');
  });

  it('the icon-only badge and its sheet', async () => {
    const badge = await mount('liquid-climate-badge', { entity: K, icon_only: true, tap_action: 'sheet' }, hassFor('nl'));
    click(q(badge, 'button.badge'));
    await settle(badge);
    await settle(q(badge, 'liquid-climate-sheet') as AnyEl);
    expect(leftovers(collect(badge))).toEqual([]);
  });
});

describe('cluster in nl', () => {
  it('auto grouping by floor, with every room state and the strip', async () => {
    const hass = hassFor('nl', (f) => {
      f.states[FLAG].state = 'on';
      f.states[S].attributes.hvac_action = 'cooling';
      f.states[N].state = 'off';
    });
    const cluster = await mount('liquid-climate-cluster', { pause_entity: 'input_boolean.pauzeknop' }, hass);
    expect(leftovers(collect(cluster))).toEqual([]);
    expect(collect(cluster).join(' ')).toContain(LOCALES.nl['cluster.title']);
    const rooms = qa(cluster, '.room');
    expect(rooms.length).toBeGreaterThan(2);
    click(rooms[1]);
    await settle(cluster);
    expect(leftovers(collect(cluster))).toEqual([]);
  });

  it('a chosen list with paused, error, unavailable and missing rooms, and the empty cluster', async () => {
    const hass = hassFor('nl', (f) => {
      f.states[FLAG].state = 'on';
      f.states[N].state = 'unavailable';
    });
    const list = await mount(
      'liquid-climate-cluster',
      { entities: [{ entity: K }, { entity: S, pause_entity: 'input_boolean.pauzeknop' }, { entity: N }, { entity: 'climate.nope' }, { entity: DUAL }] },
      hass,
    );
    const texts = collect(list);
    expect(leftovers(texts)).toEqual([]);
    expect(texts.join(' ')).toContain('niet beschikbaar');
    const empty = await mount('liquid-climate-cluster', { entities: [] }, hassFor('nl', (f) => { for (const id of Object.keys(f.states)) if (id.startsWith('climate.')) delete f.states[id]; }));
    expect(collect(empty).join(' ')).toContain(LOCALES.nl['cluster.empty']);
    expect(leftovers(collect(empty))).toEqual([]);
  });

  it('the summary words follow the language', async () => {
    const all = await mount('liquid-climate-cluster', { entities: [{ entity: K }, { entity: S }] }, hassFor('nl'));
    expect(collect(all).join(' ')).toMatch(/2 van 2 aan/);
    const off = await mount('liquid-climate-cluster', { entities: [{ entity: N }] }, hassFor('nl'));
    expect(collect(off).join(' ')).toContain(LOCALES.nl['cluster.allOff']);
  });
});

describe('editors in nl', () => {
  async function editor(tag: string, cfg: Record<string, unknown>, hass = hassFor('nl')) {
    const ed = document.createElement(tag) as AnyEl;
    ed.setConfig({ type: `custom:${tag.replace('-editor', '')}`, ...cfg });
    ed.hass = hass;
    document.body.append(ed);
    await settle(ed);
    return ed;
  }

  const tabs = async (ed: AnyEl) => {
    const seen: string[] = [];
    for (const tab of qa(ed, '[role=tab]')) {
      click(tab);
      await settle(ed);
      seen.push(...collect(ed));
    }
    return seen;
  };

  it('dial editor: every tab, with change panels, status rows and a bad action', async () => {
    const ed = await editor('liquid-climate-card-editor', {
      entity: K,
      status_entities: [{ entity: 'input_select.stookstand', actions: ['script.toepassen', 'script.weg'] }, { entity: 'sensor.weg' }],
    });
    // Setup tab: the whole-degrees note and the cloud note.
    const texts = await tabs(ed);
    expect(leftovers(texts)).toEqual([]);
    // Sensors tab: open a Change panel.
    click(qa(ed, '[role=tab]')[1]);
    await settle(ed);
    click(qa(ed, 'button.ghost.small')[0]);
    await settle(ed);
    // Controls tab: type something that is not a script into Add action.
    click(qa(ed, '[role=tab]')[2]);
    await settle(ed);
    const input = ed.shadowRoot!.querySelector('.actionsbox input') as HTMLInputElement;
    input.value = 'light.nope';
    input.dispatchEvent(new Event('change'));
    await settle(ed);
    const all = collect(ed);
    expect(leftovers(all)).toEqual([]);
    expect(all).toContain(LOCALES.nl['editor.invalidAction']);
    expect(all).toContain(LOCALES.nl['editor.missingEntity']);
    expect(all).toContain(LOCALES.nl['editor.missingAction']);
    // The footer follows the tab body; happy-dom mismatches its part there, so it is rendered on its own.
    const foot = document.createElement('div');
    render(ed._footer(), foot);
    expect(collect(foot)).toEqual([LOCALES.nl['editor.copyDiagnostics']]);
  });

  it('dial editor: limited detection and an entity that does not exist', async () => {
    const ed = await editor('liquid-climate-card-editor', { entity: K });
    click(qa(ed, '[role=tab]')[1]);
    await settle(ed);
    expect(leftovers(collect(ed))).toEqual([]);
    const gone = await editor('liquid-climate-card-editor', { entity: 'climate.nope' });
    click(qa(gone, '[role=tab]')[1]);
    await settle(gone);
    expect(collect(gone)).toContain(LOCALES.nl['editor.pickFirst']);
    expect(leftovers(collect(gone))).toEqual([]);
  });

  it('dial editor: a unit that reports whole degrees', async () => {
    const ed = await editor('liquid-climate-card-editor', { entity: K }, hassFor('nl', (f) => {
      f.states['sensor.kamer_extra'] = { entity_id: 'sensor.kamer_extra', state: '20.6', attributes: { device_class: 'temperature', unit_of_measurement: '°C', friendly_name: 'Kamermeter' } };
    }));
    expect(leftovers(collect(ed))).toEqual([]);
  });

  it('tile and badge editors', async () => {
    const tile = await editor('liquid-climate-tile-editor', { entity: K });
    const badge = await editor('liquid-climate-badge-editor', { entity: K });
    for (const ed of [tile, badge]) expect(leftovers(collect(ed))).toEqual([]);
    expect(collect(tile)).toContain(LOCALES.nl['editor.tapDial']);
    expect(collect(badge)).toContain(LOCALES.nl['editor.pauseEntity']);
  });

  it('cluster editor: every source, grouped and chosen, with an override open', async () => {
    const seen: string[] = [];
    for (const cfg of [{}, { source: 'floor', floor: 'eerste' }, { source: 'area', area: 'keuken' }, { entities: [{ entity: K }, { entity: S }] }]) {
      const ed = await editor('liquid-climate-cluster-editor', cfg);
      click(qa(ed, 'button.ghost.small[aria-controls]')[0]);
      await settle(ed);
      seen.push(...collect(ed));
    }
    const bare = hassFor('nl');
    bare.floors = {};
    bare.areas = {};
    const empty = await editor('liquid-climate-cluster-editor', { source: 'floor' }, bare);
    seen.push(...collect(empty));
    expect(leftovers(seen)).toEqual([]);
    expect(seen).toContain(LOCALES.nl['editor.clusterTitle']);
    expect(seen).toContain(LOCALES.nl['editor.noteList']);
  });
});

describe('every language renders without leftovers of English', () => {
  for (const lang of ['de', 'fr', 'es', 'it']) {
    it(lang, async () => {
      const hass = hassFor(lang);
      const dial = await mount('liquid-climate-card', { entity: K, status_entities: [{ entity: 'input_select.stookstand', actions: ['script.toepassen'] }] }, hass);
      const tile = await mount('liquid-climate-tile', { entity: K }, hass);
      const cluster = await mount('liquid-climate-cluster', {}, hass);
      const ed = await (async () => {
        const e = document.createElement('liquid-climate-card-editor') as AnyEl;
        e.setConfig({ entity: K });
        e.hass = hass;
        document.body.append(e);
        await settle(e);
        return e;
      })();
      expect(leftovers([...collect(dial), ...collect(tile), ...collect(cluster), ...collect(ed)], lang)).toEqual([]);
    });
  }
});

describe('a language change re-renders', () => {
  const texts = (el: AnyEl) => collect(el).join(' | ');

  it('dial, tile, badge and cluster', async () => {
    const en = hassFor('en');
    const nl = { ...en, language: 'nl', locale: { language: 'nl', number_format: 'language' } };
    const els = [
      await mount('liquid-climate-card', { entity: K }, en),
      await mount('liquid-climate-tile', { entity: K }, en),
      await mount('liquid-climate-badge', { entity: K }, en),
      await mount('liquid-climate-cluster', { entities: [{ entity: K }] }, en),
    ];
    const before = els.map(texts);
    expect(before[0]).toContain('Turn off');
    for (const el of els) {
      el.hass = nl;
      await settle(el);
    }
    const after = els.map(texts);
    els.forEach((_, i) => expect(after[i], els[i].tagName).not.toBe(before[i]));
    expect(after[0]).toContain(LOCALES.nl['dial.turnOff']);
    expect(after[0]).not.toContain('Turn off');
    expect(after[1]).toContain('binnen');
    expect(after[3]).toContain(LOCALES.nl['cluster.title']);
  });

  it('only the language object changing (same states) is enough', async () => {
    const en = hassFor('en');
    const card = await mount('liquid-climate-card', { entity: K }, en);
    card.hass = { ...en, locale: { language: 'de', number_format: 'language' }, language: 'de' };
    await settle(card);
    expect(texts(card)).toContain(LOCALES.de['dial.turnOff']);
  });

  it('only the translations arriving later (a new localize) re-render', async () => {
    const withAction = hassFor('nl', (f) => (f.states[K].attributes.hvac_action = 'heating'));
    const tile = await mount('liquid-climate-tile', { entity: K }, withAction);
    expect(texts(tile)).toContain(LOCALES.nl['hvacAction.heating']);
    // Same states, same locale object: only localize is swapped, as Home Assistant does once it has loaded the strings.
    tile.hass = { ...withAction, localize: (key: string) => (key.endsWith('hvac_action.state.heating') ? 'Aan het verwarmen (HA)' : '') };
    await settle(tile);
    expect(texts(tile)).toContain('Aan het verwarmen (HA)');
    expect(texts(tile)).not.toContain(LOCALES.nl['hvacAction.heating']);
  });

  it('editors follow too', async () => {
    const en = hassFor('en');
    const ed = document.createElement('liquid-climate-card-editor') as AnyEl;
    ed.setConfig({ entity: K });
    ed.hass = en;
    document.body.append(ed);
    await settle(ed);
    expect(texts(ed)).toContain('Setup');
    ed.hass = { ...en, language: 'nl', locale: { language: 'nl', number_format: 'language' } };
    await settle(ed);
    expect(texts(ed)).toContain(LOCALES.nl['editor.tabSetup']);
    expect(texts(ed)).not.toContain('Copy diagnostics');
  });
});

describe("Home Assistant's strings win over ours", () => {
  const ha = (key: string) =>
    key.endsWith('hvac_action.state.heating') ? 'Verwarmt (HA)' : key.endsWith('preset_mode.state.boost') ? 'Turbo (HA)' : '';

  it('tile hvac_action text and the dial preset chip', async () => {
    const hass = hassFor('nl', (f) => {
      f.states[K].attributes.hvac_action = 'heating';
      f.states[K].attributes.preset_mode = 'boost';
    });
    hass.localize = ha;
    const tile = await mount('liquid-climate-tile', { entity: K }, hass);
    expect(collect(tile).join(' | ')).toContain('Verwarmt (HA)');
    const dial = await mount('liquid-climate-card', { entity: K }, hass);
    const chip = qa(dial, '.chip').find((c) => c.getAttribute('aria-label') === LOCALES.nl['dial.ariaPreset'].replace('{value}', 'Turbo (HA)'));
    expect(chip, 'preset chip').toBeTruthy();
    expect(chip!.textContent).toContain('Turbo (HA)');
    expect(chip!.textContent).toContain(LOCALES.nl['dial.preset']);
  });
});
