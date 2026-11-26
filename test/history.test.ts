// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/index';
import { allFixtures, makeHass, mergeFixtures } from './fixtures';
import { materializeConfig } from '../src/detect/materialize';
import { detectSensors } from '../src/detect/roles';
import { defaultConfig, normalizeClusterConfig, normalizeConfig, pruneClusterConfig, roomDialConfig } from '../src/config';
import { ICONS } from '../src/ui/modes';
import { t } from '../src/i18n';
import { openHistory } from '../src/ui/menu';

const K = 'climate.keuken_airco';
type AnyEl = HTMLElement & Record<string, any>;

const f = mergeFixtures(allFixtures);
const $ = (el: AnyEl, sel: string) => el.shadowRoot!.querySelector(sel) as HTMLElement | null;
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

function dial(cfg: Record<string, unknown> = {}, language?: string) {
  const hass = makeHass(f);
  if (language) hass.language = language;
  const card = document.createElement('liquid-climate-card') as unknown as AnyEl;
  const base = materializeConfig(defaultConfig(K), detectSensors(hass, K, f.registry));
  card.setConfig({ ...base, ...cfg, entity: K });
  card.hass = hass;
  document.body.append(card);
  return card;
}

/** Every location-changed on window, with the path at the moment it fired. */
function watchNavigation() {
  const seen: { event: Event; path: string }[] = [];
  const on = (e: Event) => seen.push({ event: e, path: location.pathname + location.search });
  window.addEventListener('location-changed', on);
  return { seen, stop: () => window.removeEventListener('location-changed', on) };
}

let nav: ReturnType<typeof watchNavigation>;
beforeEach(() => {
  history.replaceState(null, '', '/lovelace/0');
  nav = watchNavigation();
});
afterEach(() => {
  nav.stop();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('ICONS.history', () => {
  it('is the Lucide history path from lucide-static 0.460.0, byte for byte', () => {
    expect(ICONS.history).toBe('M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5 M12 7v5l4 2');
  });
});

describe('openHistory', () => {
  it('pushes /history?entity_id=<id> and fires location-changed on window like Home Assistant', () => {
    const push = vi.spyOn(history, 'pushState');
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    openHistory(null, 'climate.keuken_airco');
    // HA's own navigate() state: the history page's back arrow uses history.back() only when `from` is set.
    expect(push).toHaveBeenCalledWith({ from: '/lovelace/0' }, '', '/history?entity_id=climate.keuken_airco');
    expect(history.state).toEqual({ from: '/lovelace/0' });
    expect(nav.seen).toHaveLength(1);
    const { event, path } = nav.seen[0];
    expect(path).toBe('/history?entity_id=climate.keuken_airco');
    expect(dispatch).toHaveBeenCalledWith(event);
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
    expect((event as CustomEvent).detail).toEqual({ replace: false });
  });

  it('encodes the entity id', () => {
    openHistory(document.body, 'sensor.a b&c=d');
    expect(nav.seen[0].path).toBe(`/history?entity_id=${encodeURIComponent('sensor.a b&c=d')}`);
  });
});

describe('dial history button', () => {
  it('is in the header actions by default, before power, with the power button style and a localised label', async () => {
    const card = dial();
    await card.updateComplete;
    const actions = $(card, 'header .actions')!;
    const btn = actions.querySelector('button.history') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.classList.contains('press')).toBe(true);
    expect(btn.getAttribute('aria-label')).toBe('History');
    expect(btn.querySelector('path')!.getAttribute('d')).toBe(ICONS.history);
    expect(btn.nextElementSibling!.matches('button.power')).toBe(true);
    // Same size rule as the power button: no visual values of its own.
    const css = (card.constructor as unknown as { styles: { cssText: string } }).styles.cssText;
    expect(css).toMatch(/\.power,\s*\.history\s*\{\s*width: 44px;\s*height: 44px;/);
  });

  it('lets a long title wrap instead of painting over the header buttons', () => {
    const css = (dial().constructor as unknown as { styles: { cssText: string } }).styles.cssText;
    expect(css).toMatch(/\bh2\s*\{[^}]*overflow-wrap: anywhere;/);
  });

  it('follows the language', async () => {
    const card = dial({}, 'nl');
    await card.updateComplete;
    expect($(card, 'button.history')!.getAttribute('aria-label')).toBe('Geschiedenis');
  });

  it("uses Home Assistant's own word for History in every language", () => {
    const words: Record<string, string> = { en: 'History', nl: 'Geschiedenis', de: 'Verlauf', fr: 'Historique', es: 'Historial', it: 'Storico' };
    for (const [lang, word] of Object.entries(words)) {
      const hass = makeHass(f);
      hass.language = lang;
      expect(t(hass, 'dial.history'), lang).toBe(word);
    }
  });

  it('is not rendered with show_history: false', async () => {
    const card = dial({ show_history: false });
    await card.updateComplete;
    expect($(card, 'button.history')).toBeNull();
    expect($(card, 'header .actions button.power')).not.toBeNull();
  });

  it('show_history defaults to true and only false turns it off', () => {
    expect(defaultConfig(K).show_history).toBe(true);
    expect(normalizeConfig({ entity: K }).show_history).toBe(true);
    expect(normalizeConfig({ entity: K, show_history: false }).show_history).toBe(false);
  });

  it('a cluster passes show_history to the dial a room opens, and saves it only when false', () => {
    const on = normalizeClusterConfig({ type: 'custom:liquid-climate-cluster', entities: [K] });
    expect(roomDialConfig(on, on.entities[0]).show_history).toBe(true);
    expect(pruneClusterConfig(on)).not.toHaveProperty('show_history');
    const off = normalizeClusterConfig({ type: 'custom:liquid-climate-cluster', entities: [K], show_history: false });
    expect(roomDialConfig(off, off.entities[0]).show_history).toBe(false);
    expect(pruneClusterConfig(off).show_history).toBe(false);
  });

  it('a click goes to the history page of the entity without a reload', async () => {
    const card = dial();
    await card.updateComplete;
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    ($(card, 'button.history') as HTMLButtonElement).click();
    expect(nav.seen).toHaveLength(1);
    expect(nav.seen[0].path).toBe(`/history?entity_id=${K}`);
    expect(dispatch).toHaveBeenCalledWith(nav.seen[0].event);
    // The dial is still there: on a dashboard nothing closes.
    expect(card.isConnected).toBe(true);
  });
});

describe('history button in the sheet', () => {
  async function openSheet() {
    const hass = makeHass(f);
    const tile = document.createElement('liquid-climate-tile') as unknown as AnyEl;
    tile.setConfig({ type: 'custom:liquid-climate-tile', entity: K });
    tile.hass = hass;
    document.body.append(tile);
    await tile.updateComplete;
    ($(tile, 'button.body') as HTMLButtonElement).click();
    await tile.updateComplete;
    const sheet = $(tile, 'liquid-climate-sheet') as AnyEl;
    await sheet.updateComplete;
    const dialog = sheet.shadowRoot!.querySelector('dialog') as HTMLDialogElement;
    const card = dialog.querySelector('liquid-climate-card') as AnyEl;
    await card.updateComplete;
    return { tile, sheet, dialog, card };
  }

  it('does not let liquid-climate-close bubble past the sheet', async () => {
    const { sheet, card } = await openSheet();
    const seen: Event[] = [];
    window.addEventListener('liquid-climate-close', (e) => seen.push(e), { once: true });
    card.dispatchEvent(new CustomEvent('liquid-climate-close', { bubbles: true, composed: true }));
    expect(sheet.isOpen).toBe(false);
    expect(seen).toHaveLength(0);
  });

  it('shows in the sheet dial next to power and Close', async () => {
    const { card, dialog } = await openSheet();
    expect($(card, 'header .actions button.history')).not.toBeNull();
    expect(dialog.querySelector('button.close')).not.toBeNull();
  });

  it('closes the sheet first, then navigates to the entity history', async () => {
    const { sheet, dialog, card } = await openSheet();
    const order: string[] = [];
    const close = sheet.close.bind(sheet);
    vi.spyOn(sheet, 'close').mockImplementation(() => {
      order.push('close');
      close();
    });
    window.addEventListener('location-changed', () => order.push(`navigate ${sheet.isOpen ? 'open' : 'closed'}`), { once: true });
    ($(card, 'button.history') as HTMLButtonElement).click();
    expect(order).toEqual(['close', 'navigate closed']);
    expect(sheet.isOpen).toBe(false);
    expect(dialog.open).toBe(false);
    // Closing removed the dial, yet the navigation still arrived with the right id.
    expect(nav.seen).toHaveLength(1);
    expect(nav.seen[0].path).toBe(`/history?entity_id=${K}`);
    await sheet.updateComplete;
    expect(dialog.querySelector('liquid-climate-card')).toBeNull();
  });

  it('a tile with show_history: false opens a sheet without it', async () => {
    const hass = makeHass(f);
    const tile = document.createElement('liquid-climate-tile') as unknown as AnyEl;
    tile.setConfig({ type: 'custom:liquid-climate-tile', entity: K, show_history: false });
    tile.hass = hass;
    document.body.append(tile);
    await tile.updateComplete;
    ($(tile, 'button.body') as HTMLButtonElement).click();
    await tile.updateComplete;
    const sheet = $(tile, 'liquid-climate-sheet') as AnyEl;
    await sheet.updateComplete;
    const card = sheet.shadowRoot!.querySelector('liquid-climate-card') as AnyEl;
    await card.updateComplete;
    expect($(card, 'button.history')).toBeNull();
  });
});

describe('dial editor: History button switch', () => {
  const flush = async (ed: AnyEl) => {
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 0));
      await ed.updateComplete;
    }
  };

  async function editor(config: Record<string, unknown>) {
    const out: Record<string, any>[] = [];
    const ed = document.createElement('liquid-climate-card-editor') as unknown as AnyEl;
    ed.setConfig(config);
    ed.hass = makeHass(f);
    ed.addEventListener('config-changed', (e) => out.push((e as CustomEvent).detail.config));
    document.body.append(ed);
    await flush(ed);
    const tab = [...ed.shadowRoot!.querySelectorAll<HTMLElement>('[role=tab]')].find((t) => text(t) === 'Controls')!;
    tab.click();
    await flush(ed);
    const sw = () => ed.shadowRoot!.querySelector<HTMLButtonElement>('[role=switch][aria-label="History button"]')!;
    return { ed, sw, last: () => out[out.length - 1] };
  }

  it('is on by default; off saves show_history: false, on again drops it (the default)', async () => {
    const { ed, sw, last } = await editor({ type: 'custom:liquid-climate-card', entity: K });
    expect(sw()).not.toBeNull();
    expect(sw().getAttribute('aria-checked')).toBe('true');
    expect(sw().classList.contains('on')).toBe(true);
    // Styled like the other switches on the tab.
    expect(sw().classList.contains('sw')).toBe(true);
    sw().click();
    expect(last().show_history).toBe(false);
    await flush(ed);
    expect(sw().getAttribute('aria-checked')).toBe('false');
    sw().click();
    expect(last()).not.toHaveProperty('show_history');
    await flush(ed);
    expect(sw().getAttribute('aria-checked')).toBe('true');
  });

  it('reads show_history: false from the config', async () => {
    const { sw } = await editor({ type: 'custom:liquid-climate-card', entity: K, show_history: false });
    expect(sw().getAttribute('aria-checked')).toBe('false');
  });
});

describe('history button on an unavailable dial', () => {
  function offline(cfg: Record<string, unknown> = {}, entity = K) {
    const hass = makeHass(f);
    if (hass.states[entity]) hass.states[entity] = { ...hass.states[entity], state: 'unavailable' };
    const card = document.createElement('liquid-climate-card') as unknown as AnyEl;
    card.setConfig({ ...defaultConfig(entity), ...cfg, entity });
    card.hass = hass;
    document.body.append(card);
    return card;
  }

  it('is in the header actions, with the power button style, and goes to the entity history', async () => {
    const card = offline();
    await card.updateComplete;
    expect(text($(card, '.unavailable'))).toBe('Unavailable');
    const btn = $(card, 'header .actions button.history') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.classList.contains('press')).toBe(true);
    expect(btn.getAttribute('aria-label')).toBe('History');
    expect(btn.querySelector('path')!.getAttribute('d')).toBe(ICONS.history);
    expect(text($(card, 'header h2'))).toBe(text($(card, 'h2')));
    btn.click();
    expect(nav.seen).toHaveLength(1);
    expect(nav.seen[0].path).toBe(`/history?entity_id=${K}`);
  });

  it('also shows when the entity is missing from Home Assistant, with the configured id', async () => {
    const gone = 'climate.gone_away';
    const card = offline({}, gone);
    await card.updateComplete;
    expect(text($(card, '.unavailable'))).toContain(gone);
    ($(card, 'button.history') as HTMLButtonElement).click();
    expect(nav.seen).toHaveLength(1);
    expect(nav.seen[0].path).toBe(`/history?entity_id=${gone}`);
  });

  it('is not rendered with show_history: false, and the title stays as before', async () => {
    const card = offline({ show_history: false });
    await card.updateComplete;
    expect($(card, 'button.history')).toBeNull();
    expect($(card, 'header')).toBeNull();
    expect(text($(card, 'section > h2'))).not.toBe('');
  });

  it('is not rendered without a configured entity', async () => {
    const card = offline();
    await card.updateComplete;
    // setConfig refuses a config without an entity; this covers the guard in the render itself.
    card._config = { ...card._config, entity: '' };
    await card.updateComplete;
    expect($(card, 'button.history')).toBeNull();
  });

  async function offlineSheet(cfg: Record<string, unknown> = {}) {
    const hass = makeHass(f);
    hass.states[K] = { ...hass.states[K], state: 'unavailable' };
    const sheet = document.createElement('liquid-climate-sheet') as unknown as AnyEl;
    sheet.hass = hass;
    document.body.append(sheet);
    await sheet.open(normalizeConfig({ entity: K, ...cfg }));
    const card = sheet.shadowRoot!.querySelector('dialog liquid-climate-card') as AnyEl;
    await card.updateComplete;
    return { sheet, card };
  }

  for (const [label, cfg, hasHistory] of [
    ['with the history button', {}, true],
    ['with show_history: false', { show_history: false }, false],
  ] as const) {
    it(`in a sheet ${label}, Close is slotted into the header and has focus after open()`, async () => {
      const { sheet, card } = await offlineSheet(cfg);
      const close = card.querySelector('button.close') as HTMLButtonElement;
      expect(close).not.toBeNull();
      const slot = $(card, 'header .actions slot[name="header-action"]') as HTMLSlotElement;
      expect(slot).not.toBeNull();
      expect(slot.assignedElements()).toContain(close);
      // Close sits in the card's light DOM, inside the sheet's shadow root.
      expect(sheet.shadowRoot!.activeElement).toBe(close);
      expect($(card, 'header .actions button.history') !== null).toBe(hasHistory);
      if (hasHistory) {
        const order = [...$(card, 'header .actions')!.children].map((c) => c.localName + (c.className ? `.${c.className.split(' ').pop()}` : ''));
        expect(order).toEqual(['button.history', 'slot']);
      }
    });
  }

  it('on a dashboard with show_history: false, keeps the bare title markup', async () => {
    const card = offline({ show_history: false });
    await card.updateComplete;
    expect($(card, 'header')).toBeNull();
    expect($(card, 'slot')).toBeNull();
    const kids = [...$(card, 'section')!.children].map((c) => c.localName + (c.className ? `.${c.className}` : ''));
    expect(kids).toEqual(['h2', 'div.unavailable']);
  });

  it('in a sheet, closes the sheet first, then navigates', async () => {
    const hass = makeHass(f);
    hass.states[K] = { ...hass.states[K], state: 'unavailable' };
    const sheet = document.createElement('liquid-climate-sheet') as unknown as AnyEl;
    sheet.hass = hass;
    document.body.append(sheet);
    await sheet.open(normalizeConfig({ entity: K }));
    const dialog = sheet.shadowRoot!.querySelector('dialog') as HTMLDialogElement;
    const card = dialog.querySelector('liquid-climate-card') as AnyEl;
    await card.updateComplete;
    const order: string[] = [];
    const close = sheet.close.bind(sheet);
    vi.spyOn(sheet, 'close').mockImplementation(() => {
      order.push('close');
      close();
    });
    window.addEventListener('location-changed', () => order.push(`navigate ${sheet.isOpen ? 'open' : 'closed'}`), { once: true });
    ($(card, 'button.history') as HTMLButtonElement).click();
    expect(order).toEqual(['close', 'navigate closed']);
    expect(nav.seen[0].path).toBe(`/history?entity_id=${K}`);
  });
});

describe('tile, badge and cluster editors: History button switch', () => {
  const flush = async (ed: AnyEl) => {
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 0));
      await ed.updateComplete;
    }
  };

  /** Each editor, its config, and what follows the switch: the switch sits after the card's own options. */
  const entityHint = 'Opens the history page of this entity';
  const cases: [string, Record<string, unknown>, string, string][] = [
    ['liquid-climate-tile-editor', { type: 'custom:liquid-climate-tile', entity: K }, 'Write delay', entityHint],
    ['liquid-climate-badge-editor', { type: 'custom:liquid-climate-badge', entity: K }, 'Look', entityHint],
    ['liquid-climate-cluster-editor', { type: 'custom:liquid-climate-cluster', entities: [K] }, 'Write delay', 'Opens the history page of the entity of the room you open'],
  ];

  async function editor(tag: string, config: Record<string, unknown>) {
    const out: Record<string, any>[] = [];
    const ed = document.createElement(tag) as unknown as AnyEl;
    ed.setConfig(config);
    ed.hass = makeHass(f);
    ed.addEventListener('config-changed', (e) => out.push((e as CustomEvent).detail.config));
    document.body.append(ed);
    await flush(ed);
    const sw = () => ed.shadowRoot!.querySelector<HTMLButtonElement>('[role=switch][aria-label="History button"]')!;
    return { ed, sw, out, last: () => out[out.length - 1] };
  }

  for (const [tag, config, next, hint] of cases) {
    describe(tag, () => {
      it('uses the dial editor markup and wording, after the card options', async () => {
        const { sw } = await editor(tag, config);
        expect(sw()).not.toBeNull();
        expect(sw().classList.contains('sw')).toBe(true);
        const row = sw().closest('.row')!;
        expect(text(row.querySelector('.name'))).toBe('History button');
        expect(text(row.querySelector('.hint'))).toBe(hint);
        expect(text(row.nextElementSibling)).toContain(next);
      });

      it('is on by default; off saves show_history: false, on again drops it', async () => {
        const { ed, sw, last } = await editor(tag, config);
        expect(sw().getAttribute('aria-checked')).toBe('true');
        expect(sw().classList.contains('on')).toBe(true);
        sw().click();
        expect(last().show_history).toBe(false);
        await flush(ed);
        expect(sw().getAttribute('aria-checked')).toBe('false');
        sw().click();
        expect(last()).not.toHaveProperty('show_history');
        await flush(ed);
        expect(sw().getAttribute('aria-checked')).toBe('true');
      });

      it('reads show_history: false and keeps the other keys', async () => {
        const { sw, last } = await editor(tag, { ...config, show_history: false });
        expect(sw().getAttribute('aria-checked')).toBe('false');
        sw().click();
        expect(last()).not.toHaveProperty('show_history');
        expect(last().type).toBe(config.type);
        if ('entity' in config) expect(last().entity).toBe(K);
        else expect(last().entities).toEqual([K]);
      });
    });
  }
});
