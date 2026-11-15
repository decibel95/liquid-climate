// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/index';
import { cleanActions, hasMenu, normalizeConfig } from '../src/config';
import { allFixtures, makeHass, mergeFixtures } from './fixtures';
import { MENU_STRINGS } from './menu-strings';

const K = 'climate.keuken_airco';
type AnyEl = HTMLElement & Record<string, any>;
type Call = { domain: string; service: string; data: any };

const EXTRA: Record<string, { state: string; attributes?: Record<string, unknown> }> = {
  'input_select.mode': { state: 'Comfort', attributes: { friendly_name: 'Mode', options: ['Auto', 'Comfort', 'Eco'] } },
  'select.sched': { state: 'night', attributes: { friendly_name: 'Schedule', options: ['day', 'night'] } },
  'input_boolean.pause': { state: 'off', attributes: { friendly_name: 'Pause' } },
  'switch.fan': { state: 'on', attributes: { friendly_name: 'Fan switch' } },
  'sensor.plain': { state: 'ok', attributes: { friendly_name: 'Plain' } },
  'script.apply': { state: 'off', attributes: { friendly_name: 'Apply' } },
  'automation.sched': { state: 'on', attributes: { friendly_name: 'Schedule auto', id: '1234' } },
  'automation.noid': { state: 'off', attributes: { friendly_name: 'No id' } },
  'script.dead': { state: 'unavailable', attributes: { friendly_name: 'Dead script' } },
  'input_select.off': { state: 'unavailable', attributes: { friendly_name: 'Offline select' } },
  'sensor.unk': { state: 'unknown', attributes: { friendly_name: 'Unknown sensor' } },
  'automation.long': {
    state: 'on',
    attributes: { friendly_name: 'A very long automation name that must wrap to two lines and then ellipsize gracefully', id: '77' },
  },
};

async function mount(
  status: Record<string, unknown>[],
  opts: { admin?: boolean; fail?: boolean; hold?: boolean; motion?: string } = {},
) {
  const f = mergeFixtures(allFixtures);
  for (const [id, e] of Object.entries(EXTRA)) f.states[id] = { entity_id: id, state: e.state, attributes: e.attributes ?? {} };
  const calls: Call[] = [];
  let release: (() => void) | undefined;
  const hass = makeHass(f, '°C', (domain, service, data) => {
    calls.push({ domain, service, data });
    if (opts.fail) return Promise.reject(new Error('nope'));
    if (opts.hold) return new Promise<void>((r) => (release = r));
  });
  if (opts.admin) hass.user = { is_admin: true };
  const card = document.createElement('liquid-climate-card') as unknown as AnyEl;
  card.setConfig({ entity: K, status_entities: status, look: { motion: opts.motion ?? 'rich' } });
  card.hass = hass;
  document.body.append(card);
  await card.updateComplete;
  return { card, hass, calls, release: () => release?.() };
}

const root = (c: AnyEl) => c.shadowRoot as ShadowRoot;
const rowBtn = (c: AnyEl, i = 0) => root(c).querySelectorAll('.status .row')[i] as HTMLButtonElement;
const panel = (c: AnyEl, i = 0) => root(c).querySelectorAll('.mpanel')[i] as HTMLElement;
const items = (c: AnyEl, i = 0) => [...panel(c, i).querySelectorAll('.mitem')] as HTMLButtonElement[];
const byText = (c: AnyEl, t: string, i = 0) => items(c, i).find((b) => b.textContent!.replace(/\s+/g, ' ').trim().startsWith(t))!;
const flush = async (c: AnyEl) => {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
    await c.updateComplete;
  }
};
const open = async (c: AnyEl, i = 0) => {
  rowBtn(c, i).click();
  await c.updateComplete;
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('status config', () => {
  it('keeps only unique script and automation ids and drops the rest', () => {
    expect(cleanActions(['script.a', 'light.x', 'script.a', 5, 'automation.b', 'script.', ' script.c '])).toEqual([
      'script.a',
      'automation.b',
      'script.c',
    ]);
    const cfg = normalizeConfig({
      entity: K,
      status_entities: [{ entity: 'sensor.x', actions: ['light.x'], menu: 'yes' }, { entity: 'sensor.y', actions: ['script.a'], menu: false }],
    });
    expect(cfg.status_entities[0]).toEqual({ entity: 'sensor.x' });
    expect(cfg.status_entities[1]).toEqual({ entity: 'sensor.y', actions: ['script.a'], menu: false });
  });

  it('turns the menu on for selectable domains and actions, and menu false forces it off', () => {
    for (const d of ['input_select', 'select', 'input_boolean', 'switch']) expect(hasMenu({ entity: `${d}.x` })).toBe(true);
    expect(hasMenu({ entity: 'sensor.x' })).toBe(false);
    expect(hasMenu({ entity: 'sensor.x', actions: ['script.a'] })).toBe(true);
    expect(hasMenu({ entity: 'input_select.x', menu: false })).toBe(false);
    expect(hasMenu({ entity: 'sensor.x', menu: true })).toBe(true);
  });
});

describe('status menu', () => {
  it('opens as an inline disclosure with aria-expanded and aria-controls', async () => {
    const { card } = await mount([{ entity: 'input_select.mode' }]);
    const b = rowBtn(card);
    expect(b.getAttribute('aria-expanded')).toBe('false');
    expect(b.getAttribute('aria-controls')).toBe(panel(card).id);
    expect(panel(card).hasAttribute('inert')).toBe(true);
    await open(card);
    expect(b.getAttribute('aria-expanded')).toBe('true');
    expect(panel(card).hasAttribute('inert')).toBe(false);
    await open(card);
    expect(b.getAttribute('aria-expanded')).toBe('false');
  });

  it('input_select: radio list with the current option checked, select_option payload', async () => {
    const { card, calls } = await mount([{ entity: 'input_select.mode' }]);
    await open(card);
    const radios = items(card).filter((x) => x.getAttribute('role') === 'radio');
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    expect(panel(card).querySelector('[role=radiogroup]')).not.toBeNull();
    radios[2].click();
    expect(calls).toEqual([{ domain: 'input_select', service: 'select_option', data: { entity_id: 'input_select.mode', option: 'Eco' } }]);
  });

  it('select: calls select.select_option', async () => {
    const { card, calls } = await mount([{ entity: 'select.sched' }]);
    await open(card);
    byText(card, 'day').click();
    expect(calls[0]).toEqual({ domain: 'select', service: 'select_option', data: { entity_id: 'select.sched', option: 'day' } });
  });

  it('input_boolean and switch: one switch that turns on or off', async () => {
    const { card, calls } = await mount([{ entity: 'input_boolean.pause' }, { entity: 'switch.fan' }]);
    await open(card, 0);
    const sw0 = items(card, 0).find((x) => x.getAttribute('role') === 'switch')!;
    expect(sw0.getAttribute('aria-checked')).toBe('false');
    sw0.click();
    await open(card, 1);
    const sw1 = items(card, 1).find((x) => x.getAttribute('role') === 'switch')!;
    expect(sw1.getAttribute('aria-checked')).toBe('true');
    sw1.click();
    expect(calls).toEqual([
      { domain: 'input_boolean', service: 'turn_on', data: { entity_id: 'input_boolean.pause' } },
      { domain: 'switch', service: 'turn_off', data: { entity_id: 'switch.fan' } },
    ]);
  });

  it('script action: button calls script.turn_on and shows Running while on', async () => {
    const { card, hass, calls } = await mount([{ entity: 'sensor.plain', actions: ['script.apply'] }]);
    await open(card);
    expect(panel(card).textContent).toContain(MENU_STRINGS.scripts);
    expect(byText(card, 'Apply').textContent).toContain('Run');
    byText(card, 'Apply').click();
    expect(calls).toEqual([{ domain: 'script', service: 'turn_on', data: { entity_id: 'script.apply' } }]);
    card.hass = { ...hass, states: { ...hass.states, 'script.apply': { entity_id: 'script.apply', state: 'on', attributes: { friendly_name: 'Apply' } } } };
    await card.updateComplete;
    expect(byText(card, 'Apply').textContent).toContain('Running');
  });

  it('automation action: switch calls automation.turn_off when on, turn_on when off', async () => {
    const { card, calls } = await mount([{ entity: 'sensor.plain', actions: ['automation.sched', 'automation.noid'] }]);
    await open(card);
    const sws = items(card).filter((x) => x.getAttribute('role') === 'switch');
    expect(sws.map((s) => s.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    sws[0].click();
    sws[1].click();
    expect(calls.map((c) => [c.domain, c.service, c.data.entity_id])).toEqual([
      ['automation', 'turn_off', 'automation.sched'],
      ['automation', 'turn_on', 'automation.noid'],
    ]);
  });

  it('shows an unavailable linked entity aria-disabled with a hint, and ignores clicks', async () => {
    const { card, calls } = await mount([{ entity: 'sensor.plain', actions: ['script.dead', 'script.apply'] }]);
    await open(card);
    const b = byText(card, 'Dead script');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.disabled).toBe(false);
    expect(b.textContent).toContain(MENU_STRINGS.unavailable);
    b.focus();
    expect(root(card).activeElement).toBe(b);
    b.click();
    expect(calls).toHaveLength(0);
  });

  it('skips an action id that does not exist: no disabled item for it', async () => {
    const { card } = await mount([{ entity: 'sensor.plain', actions: ['script.missing', 'automation.gone', 'script.apply'] }]);
    await open(card);
    const labels = items(card).map((b) => b.textContent!.replace(/\s+/g, ' ').trim());
    expect(labels.some((t) => t.includes('script.missing') || t.includes('automation.gone'))).toBe(false);
    expect(panel(card).textContent).not.toContain(MENU_STRINGS.unavailable);
    expect(panel(card).textContent).not.toContain(MENU_STRINGS.automations);
    expect(labels.some((t) => t.startsWith('Apply'))).toBe(true);
  });

  it('labels the panel as options and keeps the row name on the radiogroup, hint outside it', async () => {
    const { card } = await mount([{ entity: 'input_select.mode' }]);
    await open(card);
    expect(panel(card).getAttribute('aria-label')).toBe('Mode options');
    expect(panel(card).querySelector('[role=radiogroup]')!.getAttribute('aria-label')).toBe('Mode');
  });

  it('an unavailable select without options and without actions stays a plain row with its muted value', async () => {
    const { card } = await mount([{ entity: 'input_select.off' }]);
    expect(root(card).querySelector('.mpanel')).toBeNull();
    expect(rowBtn(card).hasAttribute('aria-expanded')).toBe(false);
    expect(rowBtn(card).querySelector('.muted')).not.toBeNull();
  });

  it('an unavailable select with actions keeps a menu with the actions and no empty radiogroup', async () => {
    const { card } = await mount([{ entity: 'input_select.off', actions: ['script.apply'] }]);
    await open(card);
    expect(panel(card).querySelector('[role=radiogroup]')).toBeNull();
    expect(byText(card, 'Apply')).toBeTruthy();
  });

  it('an automation row gets a switch and a script row a Run button in the value section', async () => {
    const { card, calls } = await mount([{ entity: 'automation.sched', menu: true }, { entity: 'script.apply', menu: true }]);
    await open(card, 0);
    const sw = items(card, 0).find((x) => x.getAttribute('role') === 'switch')!;
    expect(sw.getAttribute('aria-checked')).toBe('true');
    sw.click();
    await open(card, 1);
    byText(card, 'Apply', 1).click();
    expect(calls.map((c) => [c.domain, c.service, c.data.entity_id])).toEqual([
      ['automation', 'turn_off', 'automation.sched'],
      ['script', 'turn_on', 'script.apply'],
    ]);
  });

  it('menu true on a plain sensor without actions has only Details, so it falls back to more-info', async () => {
    const { card } = await mount([{ entity: 'sensor.plain', menu: true }]);
    expect(root(card).querySelector('.mpanel')).toBeNull();
    expect(rowBtn(card).hasAttribute('aria-expanded')).toBe(false);
    const seen: string[] = [];
    card.addEventListener('hass-more-info', (e: Event) => seen.push((e as CustomEvent).detail.entityId));
    rowBtn(card).click();
    expect(seen).toEqual(['sensor.plain']);
  });

  it('the footer holds only Details', async () => {
    const { card } = await mount([{ entity: 'switch.fan', actions: ['script.apply', 'automation.sched'] }], { admin: true });
    await open(card);
    const foot = panel(card).querySelector('.mfoot')!;
    expect([...foot.querySelectorAll('button')].map((b) => b.textContent!.trim())).toEqual([MENU_STRINGS.details]);
  });

  it('Details opens more-info for the row entity', async () => {
    const { card } = await mount([{ entity: 'input_select.mode' }]);
    const seen: string[] = [];
    card.addEventListener('hass-more-info', (e: Event) => seen.push((e as CustomEvent).detail.entityId));
    await open(card);
    byText(card, MENU_STRINGS.details).click();
    expect(seen).toEqual(['input_select.mode']);
  });
});

describe('fallback to more-info', () => {
  it('a plain sensor row has no disclosure and opens more-info', async () => {
    const { card } = await mount([{ entity: 'sensor.plain' }]);
    expect(root(card).querySelector('.mpanel')).toBeNull();
    expect(rowBtn(card).hasAttribute('aria-expanded')).toBe(false);
    const seen: string[] = [];
    card.addEventListener('hass-more-info', (e: Event) => seen.push((e as CustomEvent).detail.entityId));
    rowBtn(card).click();
    expect(seen).toEqual(['sensor.plain']);
  });

  it('menu false keeps more-info even for an input_select with actions', async () => {
    const { card } = await mount([{ entity: 'input_select.mode', actions: ['script.apply'], menu: false }]);
    expect(root(card).querySelector('.mpanel')).toBeNull();
    const seen: string[] = [];
    card.addEventListener('hass-more-info', (e: Event) => seen.push((e as CustomEvent).detail.entityId));
    rowBtn(card).click();
    expect(seen).toEqual(['input_select.mode']);
  });
});

describe('keyboard, focus and outside click', () => {
  const key = (el: HTMLElement, k: string) => {
    const e = new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true });
    el.dispatchEvent(e);
    return e;
  };

  it('a radio group is one Tab stop; arrows move within it and never call the service', async () => {
    const { card, calls } = await mount([{ entity: 'input_select.mode', actions: ['script.apply'] }]);
    await open(card);
    const radios = items(card).filter((x) => x.getAttribute('role') === 'radio');
    expect(radios.map((r) => r.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
    key(rowBtn(card), 'ArrowDown');
    expect(root(card).activeElement).toBe(radios[1]);
    key(radios[1], 'ArrowDown');
    expect(root(card).activeElement).toBe(radios[2]);
    key(radios[2], 'ArrowDown');
    expect(root(card).activeElement).toBe(radios[0]);
    expect(radios.map((r) => r.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    key(radios[0], 'End');
    expect(root(card).activeElement).toBe(radios[2]);
    key(radios[2], 'Home');
    expect(root(card).activeElement).toBe(radios[0]);
    expect(calls).toHaveLength(0);
    // Outside the group, arrows move across the panel's stops: Run button after the group.
    const run = byText(card, 'Apply');
    run.focus();
    key(run, 'ArrowUp');
    // The group counts once, at its current Tab stop (the last radio focused).
    expect(root(card).activeElement).toBe(radios[0]);
  });

  it('Escape closes the panel and returns focus to the row button', async () => {
    const { card } = await mount([{ entity: 'input_select.mode' }]);
    await open(card);
    const first = items(card)[0];
    first.focus();
    key(first, 'Escape');
    await card.updateComplete;
    expect(rowBtn(card).getAttribute('aria-expanded')).toBe('false');
    expect(root(card).activeElement).toBe(rowBtn(card));
  });

  it('a press outside closes it, a press inside does not, and focus returns to the row button', async () => {
    const { card } = await mount([{ entity: 'input_select.mode' }]);
    await open(card);
    items(card)[0].dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    await card.updateComplete;
    expect(rowBtn(card).getAttribute('aria-expanded')).toBe('true');
    items(card)[0].focus();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    await card.updateComplete;
    expect(rowBtn(card).getAttribute('aria-expanded')).toBe('false');
    expect(root(card).activeElement).toBe(rowBtn(card));
  });

  it('closes when detached and stays closed on reattach, and the outside listener is gone', async () => {
    const { card } = await mount([{ entity: 'input_select.mode' }]);
    await open(card);
    card.remove();
    document.body.append(card);
    await card.updateComplete;
    expect(rowBtn(card).getAttribute('aria-expanded')).toBe('false');
    await open(card);
    expect(rowBtn(card).getAttribute('aria-expanded')).toBe('true');
  });

  it('closes on a config change while open', async () => {
    const { card } = await mount([{ entity: 'input_select.mode' }]);
    await open(card);
    card.setConfig({ entity: K, status_entities: [{ entity: 'input_select.mode' }] });
    await card.updateComplete;
    expect(rowBtn(card).getAttribute('aria-expanded')).toBe('false');
  });

  it('duplicate entities are separate rows: opening one leaves the other closed', async () => {
    const { card } = await mount([{ entity: 'input_select.mode' }, { entity: 'input_select.mode' }]);
    await open(card, 1);
    expect(rowBtn(card, 0).getAttribute('aria-expanded')).toBe('false');
    expect(rowBtn(card, 1).getAttribute('aria-expanded')).toBe('true');
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    await card.updateComplete;
    expect(rowBtn(card, 1).getAttribute('aria-expanded')).toBe('false');
  });

  it('only one panel is open at a time', async () => {
    const { card } = await mount([{ entity: 'input_select.mode' }, { entity: 'switch.fan' }]);
    await open(card, 0);
    await open(card, 1);
    expect(rowBtn(card, 0).getAttribute('aria-expanded')).toBe('false');
    expect(rowBtn(card, 1).getAttribute('aria-expanded')).toBe('true');
  });
});

describe('Edit icon buttons (admin only)', () => {
  const rows = [{ entity: 'switch.fan', actions: ['automation.sched', 'script.apply', 'automation.noid'] }];
  const edits = (c: AnyEl, i = 0) => items(c, i).filter((b) => b.classList.contains('medit'));

  it('is hidden for non-admins', async () => {
    const { card } = await mount(rows);
    await open(card);
    expect(edits(card)).toHaveLength(0);
    expect(items(card).some((b) => b.getAttribute('aria-label')?.startsWith('Edit '))).toBe(false);
  });

  it('is a pencil ha-icon button per item with the right path, omitting an automation without id', async () => {
    const push = vi.spyOn(history, 'pushState');
    const located = vi.fn();
    window.addEventListener('location-changed', located);
    const { card } = await mount(rows, { admin: true });
    await open(card);
    const list = edits(card);
    // Scripts come before automations in the menu.
    expect(list.map((b) => b.getAttribute('aria-label'))).toEqual([MENU_STRINGS.editLabel('Apply'), MENU_STRINGS.editLabel('Schedule auto')]);
    for (const b of list) {
      expect(b.querySelector('ha-icon')!.getAttribute('icon')).toBe('mdi:pencil');
      expect(b.title).toBe(b.getAttribute('aria-label'));
    }
    // Each sits in the same row as its item.
    expect(list[0].parentElement!.classList.contains('mrow')).toBe(true);
    expect(list[0].parentElement!.textContent).toContain('Apply');
    expect(list[1].parentElement!.textContent).toContain('Schedule auto');
    list[0].click();
    list[1].click();
    expect(push.mock.calls.map((c) => c[2])).toEqual(['/config/script/edit/apply', '/config/automation/edit/1234']);
    expect(located).toHaveBeenCalledTimes(2);
    window.removeEventListener('location-changed', located);
  });

  it('is 44px wide and tall in the styles', async () => {
    const { card } = await mount(rows, { admin: true });
    const css = (card.constructor as any).styles.cssText as string;
    expect(css).toMatch(/\.mitem\.medit\s*{[^}]*width:\s*44px/);
    expect(css).toMatch(/\.mitem\s*{[^}]*min-height:\s*44px/);
  });

  it('is its own Tab stop and part of the arrow navigation', async () => {
    const { card } = await mount([{ entity: 'switch.fan', actions: ['script.apply'] }], { admin: true });
    await open(card);
    const edit = edits(card)[0];
    expect(edit.getAttribute('tabindex')).toBeNull();
    const run = byText(card, 'Apply');
    run.focus();
    run.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, composed: true, cancelable: true }));
    expect(root(card).activeElement).toBe(edit);
  });

  it('a script row gets its button next to its Run button, an automation row next to its switch', async () => {
    const { card } = await mount([{ entity: 'script.apply', menu: true }, { entity: 'automation.sched', menu: true }], { admin: true });
    await open(card, 0);
    expect(edits(card, 0).map((b) => b.getAttribute('aria-label'))).toEqual(['Edit Apply']);
    await open(card, 1);
    expect(edits(card, 1).map((b) => b.getAttribute('aria-label'))).toEqual(['Edit Schedule auto']);
    expect(edits(card, 1)[0].parentElement!.querySelector('[role=switch]')).not.toBeNull();
  });

  it('a row name overrides the label in the aria-label of the row entity', async () => {
    const { card } = await mount([{ entity: 'script.apply', name: 'Heat now', menu: true }], { admin: true });
    await open(card);
    expect(edits(card).map((b) => b.getAttribute('aria-label'))).toEqual(['Edit Heat now']);
  });

  it('long item names keep the full name in the title and the aria-label, and clamp to two lines', async () => {
    const { card } = await mount([{ entity: 'switch.fan', actions: ['automation.long'] }], { admin: true });
    await open(card);
    const full = EXTRA['automation.long'].attributes!.friendly_name as string;
    expect(panel(card).querySelector('.mrow .mlabel')!.getAttribute('title')).toBe(full);
    expect(edits(card)[0].getAttribute('aria-label')).toBe(`Edit ${full}`);
    const css = (card.constructor as any).styles.cssText as string;
    expect(css).toMatch(/\.mlabel\s*{[^}]*-webkit-line-clamp:\s*2/);
  });
});

describe('Run and section styling', () => {
  it('Run is a pill with a play icon, Running a separate filled state, a dead script a plain hint', async () => {
    const { card, hass } = await mount([{ entity: 'sensor.plain', actions: ['script.apply', 'script.dead'] }]);
    await open(card);
    const run = byText(card, 'Apply').querySelector('.mrun')!;
    expect(run.textContent!.trim()).toBe(MENU_STRINGS.run);
    expect(run.querySelector('svg.mplay')).not.toBeNull();
    expect(run.classList.contains('running')).toBe(false);
    expect(byText(card, 'Dead script').querySelector('.mrun')).toBeNull();
    card.hass = { ...hass, states: { ...hass.states, 'script.apply': { entity_id: 'script.apply', state: 'on', attributes: { friendly_name: 'Apply' } } } };
    await card.updateComplete;
    const running = byText(card, 'Apply').querySelector('.mrun')!;
    expect(running.classList.contains('running')).toBe(true);
    expect(running.querySelector('svg.mplay')).toBeNull();
    expect(running.textContent).toContain(MENU_STRINGS.running);
  });

  it('section headers use the head token and the switch the on and off tokens, not the mode colour', async () => {
    const { card } = await mount([{ entity: 'sensor.plain', actions: ['script.apply'] }]);
    const css = (card.constructor as any).styles.cssText as string;
    expect(css).toMatch(/\.mhead\s*{[^}]*var\(--lc-menu-head\)/);
    expect(css).toMatch(/\.mitem\[aria-checked='true'\] \.mtrack\s*{[^}]*var\(--lc-menu-on-track\)/);
    expect(css).toMatch(/\.mitem\[aria-checked='true'\] \.mthumb\s*{[^}]*translateX\(16px\)/);
    expect(css).toContain('--lc-menu-off-track');
    expect(css).not.toMatch(/\.mtrack[^}]*--lc-mode/);
  });
});

describe('nothing that is not configured is rendered', () => {
  it('hides a status row whose entity does not exist', async () => {
    const { card } = await mount([{ entity: 'sensor.nope' }, { entity: 'sensor.plain' }, { entity: 'input_select.nope', actions: ['script.apply'] }]);
    const rows = root(card).querySelectorAll('.status .row');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('Plain');
    expect(root(card).querySelector('.mpanel')).toBeNull();
  });

  it('keeps a row whose entity exists but is unavailable or unknown, with a muted --', async () => {
    const { card } = await mount([{ entity: 'input_select.off' }, { entity: 'sensor.unk' }]);
    const rows = [...root(card).querySelectorAll('.status .row')];
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.querySelector('.val')!.textContent!.trim())).toEqual(['--', '--']);
  });

  it('keeps the config index for panels when an earlier row is hidden', async () => {
    const { card } = await mount([{ entity: 'sensor.nope' }, { entity: 'input_select.mode' }]);
    const b = rowBtn(card, 0);
    expect(b.getAttribute('aria-controls')).toBe(panel(card, 0).id);
    expect(panel(card, 0).id).toBe('lc-menu-1');
    await open(card, 0);
    expect(b.getAttribute('aria-expanded')).toBe('true');
    expect(items(card).some((x) => x.getAttribute('role') === 'radio')).toBe(true);
  });

  it('a row with a menu but nothing to show (all actions missing, no value control) is a plain more-info row', async () => {
    const { card } = await mount([{ entity: 'sensor.plain', actions: ['script.missing', 'automation.gone'] }]);
    expect(root(card).querySelector('.mpanel')).toBeNull();
    expect(rowBtn(card).hasAttribute('aria-expanded')).toBe(false);
    const seen: string[] = [];
    card.addEventListener('hass-more-info', (e: Event) => seen.push((e as CustomEvent).detail.entityId));
    rowBtn(card).click();
    expect(seen).toEqual(['sensor.plain']);
  });

  it('a value row keeps its menu even when all its actions are missing', async () => {
    const { card } = await mount([{ entity: 'switch.fan', actions: ['script.missing'] }]);
    expect(root(card).querySelectorAll('.mpanel')).toHaveLength(1);
  });

  it('renders no status wrapper or divider when every row is missing', async () => {
    const { card } = await mount([{ entity: 'sensor.nope' }, { entity: 'switch.nope', actions: ['script.apply'] }]);
    expect(root(card).querySelector('.status')).toBeNull();
    expect(root(card).querySelector('.srow')).toBeNull();
  });

  it('keeps focus on the row when the focused menu row stops being a menu row', async () => {
    const { card, hass } = await mount([{ entity: 'sensor.plain', actions: ['script.apply'] }]);
    await open(card);
    byText(card, 'Apply').focus();
    const states = { ...hass.states };
    delete states['script.apply'];
    card.hass = { ...hass, states };
    await card.updateComplete;
    await card.updateComplete;
    expect(root(card).activeElement).toBe(rowBtn(card));
    expect(rowBtn(card).getAttribute('data-index')).toBe('0');
  });

  it('moves focus to a focusable element of the card when the focused row entity disappears', async () => {
    const { card, hass } = await mount([{ entity: 'input_select.mode' }]);
    await open(card);
    items(card)[0].focus();
    const states = { ...hass.states };
    delete states['input_select.mode'];
    card.hass = { ...hass, states };
    await card.updateComplete;
    await card.updateComplete;
    expect(root(card).querySelector('.status')).toBeNull();
    expect(root(card).activeElement).not.toBeNull();
    expect(root(card).activeElement!.tagName).toBe('BUTTON');
  });

  it('announces Running in a persistent polite status when a script starts, and nothing when it stops', async () => {
    const { card, hass } = await mount([{ entity: 'sensor.plain', actions: ['script.apply'] }]);
    const live = () => root(card).querySelectorAll('.mclip > .vh[role=status]')[0]!;
    expect(live().getAttribute('aria-live')).toBe('polite');
    expect(live().textContent).toBe('');
    const set = (state: string) => {
      card.hass = { ...hass, states: { ...hass.states, 'script.apply': { entity_id: 'script.apply', state, attributes: { friendly_name: 'Apply' } } } };
    };
    set('on');
    await card.updateComplete;
    expect(live().textContent).toBe(MENU_STRINGS.runningAnnounce);
    set('off');
    await card.updateComplete;
    expect(live().textContent).toBe('');
  });

  it('has a forced-colors rule for the switch', async () => {
    const { card } = await mount([{ entity: 'switch.fan' }]);
    const css = (card.constructor as any).styles.cssText as string;
    expect(css).toMatch(/forced-colors: active\)[\s\S]*Highlight[\s\S]*ButtonText/);
  });

  it('closes an open menu when its actions disappear', async () => {
    const { card, hass } = await mount([{ entity: 'sensor.plain', actions: ['script.apply'] }]);
    await open(card);
    const states = { ...hass.states };
    delete states['script.apply'];
    card.hass = { ...hass, states };
    await card.updateComplete;
    expect(root(card).querySelector('.mpanel')).toBeNull();
    expect(root(card).querySelector('.status .row')!.hasAttribute('aria-expanded')).toBe(false);
  });
});

describe('pending and error state', () => {
  it('disables the control while the call is in flight and re-enables it after', async () => {
    const { card, calls, release } = await mount([{ entity: 'input_select.mode' }], { hold: true });
    await open(card);
    const eco = byText(card, 'Eco');
    eco.click();
    await card.updateComplete;
    expect(eco.getAttribute('aria-busy')).toBe('true');
    expect(eco.getAttribute('aria-disabled')).toBe('true');
    expect(panel(card).getAttribute('aria-busy')).toBe('true');
    eco.click();
    expect(calls).toHaveLength(1);
    release();
    await flush(card);
    expect(byText(card, 'Eco').getAttribute('aria-busy')).toBe('false');
    expect(panel(card).getAttribute('aria-busy')).toBe('false');
  });

  it('shows a polite error line when the call rejects, and clears it after a successful retry', async () => {
    let fail = true;
    const f = mergeFixtures(allFixtures);
    f.states['input_select.mode'] = { entity_id: 'input_select.mode', state: 'Comfort', attributes: { options: ['Auto', 'Comfort', 'Eco'] } };
    const hass = makeHass(f, '°C', () => (fail ? Promise.reject(new Error('nope')) : Promise.resolve()));
    const card = document.createElement('liquid-climate-card') as unknown as AnyEl;
    card.setConfig({ entity: K, status_entities: [{ entity: 'input_select.mode' }, { entity: 'input_select.mode' }] });
    card.hass = hass;
    document.body.append(card);
    await card.updateComplete;
    await open(card, 0);
    const err = () => panel(card, 0).querySelector('.merr')!;
    expect(err().getAttribute('role')).toBe('status');
    expect(err().getAttribute('aria-live')).toBe('polite');
    expect(err().textContent).toBe('');
    byText(card, 'Eco').click();
    await flush(card);
    expect(err().textContent).toBe(MENU_STRINGS.error);
    // The duplicate row has its own state.
    expect(panel(card, 1).querySelector('.merr')!.textContent).toBe('');
    fail = false;
    byText(card, 'Eco').click();
    await flush(card);
    expect(err().textContent).toBe('');
  });

  it('clears the error when the row is closed and opened again', async () => {
    const { card } = await mount([{ entity: 'input_select.mode' }], { fail: true });
    await open(card);
    byText(card, 'Eco').click();
    await flush(card);
    expect(panel(card).querySelector('.merr')!.textContent).toBe(MENU_STRINGS.error);
    await open(card);
    await open(card);
    expect(panel(card).querySelector('.merr')!.textContent).toBe('');
  });

  it('adds hidden Updating text while a control is pending', async () => {
    const { card, release } = await mount([{ entity: 'input_select.mode' }], { hold: true });
    await open(card);
    byText(card, 'Eco').click();
    await card.updateComplete;
    expect(byText(card, 'Eco').querySelector('.vh')!.textContent).toBe(MENU_STRINGS.updating);
    release();
    await flush(card);
    expect(byText(card, 'Eco').querySelector('.vh')).toBeNull();
  });
});

describe('motion and live region styles', () => {
  it('the card motion class decides, and reduced motion removes the transition in the styles', async () => {
    const { card } = await mount([{ entity: 'input_select.mode' }], { motion: 'minimal' });
    expect(root(card).querySelector('.lc')!.classList.contains('m-minimal')).toBe(true);
    const css = (card.constructor as any).styles.cssText as string;
    expect(css).toContain('.m-minimal .mwrap');
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*{\s*\.mwrap/);
    // m-subtle drives the duration through a variable, so it also wins while open.
    expect(css).toMatch(/\.m-subtle \.mwrap\s*{\s*--mdur/);
    // The error line is collapsed, never display:none, so it stays a live region.
    expect(css).not.toMatch(/\.merr:empty\s*{[^}]*display:\s*none/);
  });
});

describe('card editor: actions', () => {
  const edit = (status: Record<string, unknown>[]) => {
    const f = mergeFixtures(allFixtures);
    for (const [id, e] of Object.entries(EXTRA)) f.states[id] = { entity_id: id, state: e.state, attributes: e.attributes ?? {} };
    const ed = document.createElement('liquid-climate-card-editor') as unknown as AnyEl;
    ed.setConfig({ entity: K, status_entities: status });
    ed._tab = 'controls';
    ed.hass = makeHass(f, '°C');
    const out: any[] = [];
    ed.addEventListener('config-changed', (e: Event) => out.push((e as CustomEvent).detail.config));
    document.body.append(ed);
    return { ed, out };
  };
  const q = (ed: AnyEl, sel: string) => ed.shadowRoot!.querySelector(sel) as HTMLElement;

  it('normalises what is added: only script and automation ids are kept', async () => {
    const { ed, out } = edit([{ entity: 'sensor.plain' }]);
    await ed.updateComplete;
    const input = q(ed, '.actionsbox input') as HTMLInputElement;
    input.value = 'light.kitchen';
    input.dispatchEvent(new Event('change'));
    expect(out).toHaveLength(0);
    input.value = 'script.apply';
    input.dispatchEvent(new Event('change'));
    expect(out.at(-1).status_entities).toEqual([{ entity: 'sensor.plain', actions: ['script.apply'] }]);
  });

  it('removes an action with an accessible button and drops the empty list', async () => {
    const { ed, out } = edit([{ entity: 'sensor.plain', actions: ['script.apply'] }]);
    await ed.updateComplete;
    (q(ed, '[aria-label="Remove script.apply"]') as HTMLButtonElement).click();
    expect(out.at(-1).status_entities).toEqual([{ entity: 'sensor.plain' }]);
  });

  it('writes menu only when it differs from the default', async () => {
    const { ed, out } = edit([{ entity: 'input_select.mode' }]);
    await ed.updateComplete;
    const toggle = () => q(ed, '.actionsbox [role=switch]') as HTMLButtonElement;
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    toggle().click();
    expect(out.at(-1).status_entities).toEqual([{ entity: 'input_select.mode', menu: false }]);
    await ed.updateComplete;
    toggle().click();
    expect(out.at(-1).status_entities).toEqual([{ entity: 'input_select.mode' }]);
  });

  it('keeps an invalid id, flags it with aria-invalid and a hint, and clears the flag when typing', async () => {
    const { ed, out } = edit([{ entity: 'sensor.plain' }]);
    await ed.updateComplete;
    const input = q(ed, '.actionsbox input') as HTMLInputElement;
    input.value = 'light.kitchen';
    input.dispatchEvent(new Event('change'));
    await ed.updateComplete;
    expect(input.value).toBe('light.kitchen');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(q(ed, '.actionsbox .hint')!.textContent).toBe(MENU_STRINGS.editorInvalidAction);
    expect(out).toHaveLength(0);
    input.dispatchEvent(new Event('input'));
    await ed.updateComplete;
    expect(input.getAttribute('aria-invalid')).toBe('false');
  });

  it('labels the actions box as a group and the input with a real label', async () => {
    const { ed } = edit([{ entity: 'sensor.plain', name: 'Plain row' }]);
    await ed.updateComplete;
    expect(q(ed, '.actionsbox')!.getAttribute('role')).toBe('group');
    expect(q(ed, '.actionsbox')!.getAttribute('aria-label')).toContain('Plain row');
    const input = q(ed, '.actionsbox input') as HTMLInputElement;
    expect(q(ed, `label[for="${input.id}"]`)!.textContent).toBe(MENU_STRINGS.editorAddAction);
    expect(input.getAttribute('placeholder')).toBe(MENU_STRINGS.editorActionPlaceholder);
  });

  it('keeps the Name input when the entity of the same row changes', async () => {
    const { ed } = edit([{ entity: 'sensor.plain', name: 'A' }]);
    await ed.updateComplete;
    const nameBefore = ed.shadowRoot!.querySelector('input[aria-label="Status name"]');
    const entity = ed.shadowRoot!.querySelector('input[aria-label="Status entity"]') as HTMLInputElement;
    entity.value = 'switch.fan';
    entity.dispatchEvent(new Event('change'));
    await ed.updateComplete;
    expect(ed.shadowRoot!.querySelector('input[aria-label="Status name"]')).toBe(nameBefore);
  });

  it('clears stale Add action text and the invalid flag when an action is removed', async () => {
    const { ed } = edit([{ entity: 'sensor.plain', actions: ['script.apply'] }]);
    await ed.updateComplete;
    const input = q(ed, '.actionsbox input') as HTMLInputElement;
    input.value = 'light.kitchen';
    input.dispatchEvent(new Event('change'));
    await ed.updateComplete;
    (q(ed, '[aria-label="Remove script.apply"]') as HTMLButtonElement).click();
    await ed.updateComplete;
    expect(q(ed, '.actionsbox input')!.getAttribute('aria-invalid')).toBe('false');
  });

  it('warns about a status row entity that does not exist, not about an empty or existing one', async () => {
    const { ed } = edit([{ entity: 'sensor.nope' }, { entity: '' }, { entity: 'sensor.plain' }]);
    await ed.updateComplete;
    const warns = [...ed.shadowRoot!.querySelectorAll('.statusrow > .hint.warn')];
    expect(warns).toHaveLength(1);
    expect(warns[0].textContent).toContain(MENU_STRINGS.editorMissingEntity);
    expect((warns[0].closest('.statusrow')!.querySelector('input') as HTMLInputElement).value).toBe('sensor.nope');
  });

  it('warns next to an action that does not exist, and only that one', async () => {
    const { ed } = edit([{ entity: 'sensor.plain', actions: ['script.apply', 'script.missing'] }]);
    await ed.updateComplete;
    const rows = [...ed.shadowRoot!.querySelectorAll('.actionrow')].filter((r) => r.querySelector('.actionid'));
    expect(rows.map((r) => r.querySelector('.actionid')!.textContent)).toEqual(['script.apply', 'script.missing']);
    expect(rows[0].querySelector('.hint.warn')).toBeNull();
    expect(rows[1].querySelector('.hint.warn')!.textContent).toContain(MENU_STRINGS.editorMissingAction);
  });

  it('drops a redundant menu flag when the entity changes, and keeps a deliberate false when the last action goes', async () => {
    // Intended exception to default-free YAML: "Add entity" writes { entity: '' } as a draft row the user fills in.
    const { ed, out } = edit([{ entity: 'sensor.plain', menu: true, actions: ['script.apply'] }]);
    await ed.updateComplete;
    const entity = q(ed, 'input[aria-label="Status entity"]') as HTMLInputElement;
    entity.value = 'switch.fan';
    entity.dispatchEvent(new Event('change'));
    expect(out.at(-1).status_entities[0]).toEqual({ entity: 'switch.fan', actions: ['script.apply'] });
    await ed.updateComplete;
    // A deliberate menu false survives removing the last action and adding one back.
    (q(ed, '.actionsbox [role=switch]') as HTMLButtonElement).click();
    expect(out.at(-1).status_entities[0]).toEqual({ entity: 'switch.fan', actions: ['script.apply'], menu: false });
    await ed.updateComplete;
    (q(ed, '[aria-label="Remove script.apply"]') as HTMLButtonElement).click();
    expect(out.at(-1).status_entities[0]).toEqual({ entity: 'switch.fan', menu: false });
    await ed.updateComplete;
    const input = q(ed, '.actionsbox input') as HTMLInputElement;
    input.value = 'script.apply';
    input.dispatchEvent(new Event('change'));
    expect(out.at(-1).status_entities[0]).toEqual({ entity: 'switch.fan', actions: ['script.apply'], menu: false });
  });

  it('links the missing-entity and missing-action warnings to their controls without a live role', async () => {
    const { ed } = edit([{ entity: 'sensor.nope', actions: ['script.missing'] }]);
    await ed.updateComplete;
    const input = q(ed, 'input[aria-label="Status entity"]') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const warn = ed.shadowRoot!.getElementById(input.getAttribute('aria-describedby')!)!;
    expect(warn.textContent).toContain(MENU_STRINGS.editorMissingEntity);
    expect(warn.hasAttribute('role')).toBe(false);
    expect(warn.querySelector('ha-icon')!.getAttribute('icon')).toBe('mdi:alert-outline');
    const remove = q(ed, '[aria-label="Remove script.missing"]') as HTMLButtonElement;
    const actionWarn = ed.shadowRoot!.getElementById(remove.getAttribute('aria-describedby')!)!;
    expect(actionWarn.textContent).toContain(MENU_STRINGS.editorMissingAction);
    expect(actionWarn.hasAttribute('role')).toBe(false);
  });

  it('writes no empty keys: no empty name or icon, no empty actions list, no menu at its default', async () => {
    const { ed, out } = edit([{ entity: 'input_select.mode', name: 'Mode', icon: 'mdi:x', actions: ['script.apply'], menu: false }]);
    await ed.updateComplete;
    for (const label of ['Status name', 'Status icon']) {
      const input = q(ed, `input[aria-label="${label}"]`) as HTMLInputElement;
      input.value = '';
      input.dispatchEvent(new Event('change'));
    }
    await ed.updateComplete;
    (q(ed, '[aria-label="Remove script.apply"]') as HTMLButtonElement).click();
    await ed.updateComplete;
    // menu was false, which is not the default for an input_select: switch it back on.
    (q(ed, '.actionsbox [role=switch]') as HTMLButtonElement).click();
    const row = out.at(-1).status_entities[0];
    expect(row).toEqual({ entity: 'input_select.mode' });
    expect(Object.keys(row)).toEqual(['entity']);
  });
});
