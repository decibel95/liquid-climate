// Look-section snapshot for test/editor-look.test.ts: the Look section of the four editors (dial, tile, badge,
// cluster) and their History button switch, in English and Dutch, with the default look and a changed one; plus the
// config each of those controls sends (editorHandlers).
//
// Normalised DOM, one line per element, text run or closing tag: Lit's comment markers are dropped, attributes are
// sorted, an input's `value` property is written as `.value`, adjacent text is joined, trimmed and its white space
// collapsed, and a `div.look` wrapper (liquid-core's lookFields) is replaced by its children.
//
// happy-dom 15 drops Lit's `<?lit$...$>` marker when it sits at the top level of a template, where a browser parses it
// as the comment `<!--?lit$...$-->`. A template that starts with an expression (the editors' `_look`) then binds every
// value one part off, a DOM no browser shows. The shim below hands happy-dom that comment, as a browser would read it,
// so the snapshot is the real DOM before and after the move to liquid-core's lookFields.
import '../src/index';
import { t } from '../src/i18n';
import type { HomeAssistant } from '../src/types';
import { AREAS, FLOORS, allFixtures, makeHass, mergeFixtures } from './fixtures';

const templateHtml = Object.getOwnPropertyDescriptor(HTMLTemplateElement.prototype, 'innerHTML')!;
Object.defineProperty(HTMLTemplateElement.prototype, 'innerHTML', {
  ...templateHtml,
  set(this: HTMLTemplateElement, html: string) {
    templateHtml.set!.call(this, String(html).replace(/<\?(lit\$\d+\$)>/g, '<!--?$1-->'));
  },
});

type AnyEl = HTMLElement & Record<string, any>;

const K = 'climate.keuken_airco';

export const EDITORS = {
  dial: { tag: 'liquid-climate-card-editor', config: { type: 'custom:liquid-climate-card', entity: K } },
  tile: { tag: 'liquid-climate-tile-editor', config: { type: 'custom:liquid-climate-tile', entity: K } },
  badge: { tag: 'liquid-climate-badge-editor', config: { type: 'custom:liquid-climate-badge', entity: K } },
  cluster: { tag: 'liquid-climate-cluster-editor', config: { type: 'custom:liquid-climate-cluster', entities: [K] } },
} as const;

export const LANGUAGES = ['en', 'nl'] as const;

/** The default look with History on, and every look option changed with History off. */
export const VARIANTS: Record<string, Record<string, unknown>> = {
  default: {},
  changed: { look: { glass: 'light', tint: 0.12, blur: 24, motion: 'subtle' }, show_history: false },
};

function hassFor(language: string): HomeAssistant {
  const hass = makeHass(mergeFixtures(allFixtures), '°C');
  hass.areas = structuredClone(AREAS);
  hass.floors = structuredClone(FLOORS);
  hass.language = language;
  hass.locale = { language, number_format: 'language' };
  return hass;
}

async function settle(el: AnyEl) {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
  }
}

/** A deep copy with every `div.look` replaced by its children. */
function unwrapLook(el: Element): Element {
  const copy = el.cloneNode(true) as Element;
  for (const look of [...copy.querySelectorAll('div.look')]) look.replaceWith(...look.childNodes);
  return copy;
}

function serialize(el: Element, depth: number, out: string[]) {
  const pad = '  '.repeat(depth);
  const attrs = [...el.attributes].map((a) => `${a.name}="${a.value}"`).sort();
  if (el.localName === 'input') attrs.push(`.value="${(el as HTMLInputElement).value}"`);
  out.push(`${pad}<${el.localName}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`);
  // Text runs are joined across Lit's markers ("9" + "%" is "9%" on screen), then trimmed and collapsed.
  let run = '';
  const flush = () => {
    const s = run.replace(/\s+/g, ' ').trim();
    if (s) out.push(`${pad}  ${s}`);
    run = '';
  };
  for (const c of el.childNodes) {
    if (c.nodeType === 3) run += c.textContent;
    else if (c.nodeType === 1) {
      flush();
      serialize(c as Element, depth + 1, out);
    }
  }
  flush();
  out.push(`${pad}</${el.localName}>`);
}

function lines(nodes: Element[]): string[] {
  const out: string[] = [];
  for (const n of nodes) serialize(n, 0, out);
  return out;
}

/** The Look section: its heading with the help link, the fields, and the reduced-motion hint that ends it. */
function lookSection(ed: AnyEl, editor: keyof typeof EDITORS): Element[] {
  const root = ed.shadowRoot!;
  const body = unwrapLook(root.querySelector('.body')!);
  if (editor === 'dial') {
    // Tabbed: the Look tab's help link sits in the tab row; the body holds only the Look fields.
    return [root.querySelector('.tabrow > a.help')!.cloneNode(true) as Element, ...body.children];
  }
  const kids = [...body.children];
  const start = kids.findIndex((k) => k.matches('div.lblrow') && !!k.querySelector('a.help[href$="-look"]'));
  const end = kids.findIndex((k, i) => i > start && k.matches('span.hint'));
  if (start < 0 || end < 0) throw new Error(`editor look: no Look section in ${editor}`);
  return kids.slice(start, end + 1);
}

/** The History button switch. */
function historyButton(ed: AnyEl, hass: HomeAssistant, editor: keyof typeof EDITORS): HTMLButtonElement {
  const label = t(hass, 'editor.historyButton');
  const sw = [...ed.shadowRoot!.querySelectorAll<HTMLButtonElement>('button.sw[role=switch]')].find((b) => b.getAttribute('aria-label') === label);
  if (!sw) throw new Error(`editor look: no History switch in ${editor}`);
  return sw;
}

/** The History button switch row. */
function historyRow(ed: AnyEl, hass: HomeAssistant, editor: keyof typeof EDITORS): Element[] {
  return [unwrapLook(historyButton(ed, hass, editor).closest('.row')!)];
}

async function selectTab(ed: AnyEl, hass: HomeAssistant, key: string) {
  const name = t(hass, key);
  const tab = [...ed.shadowRoot!.querySelectorAll<HTMLElement>('[role=tab]')].find((b) => b.textContent!.trim() === name);
  if (!tab) throw new Error(`editor look: no tab ${name}`);
  tab.click();
  await settle(ed);
}

export interface LookSnapshot {
  look: string[];
  history: string[];
}

/** Every editor, language and variant: editor -> language -> variant -> { look, history }. */
export async function editorLook(): Promise<Record<string, Record<string, Record<string, LookSnapshot>>>> {
  const out: Record<string, Record<string, Record<string, LookSnapshot>>> = {};
  for (const [editor, { tag, config }] of Object.entries(EDITORS) as [keyof typeof EDITORS, (typeof EDITORS)[keyof typeof EDITORS]][]) {
    out[editor] = {};
    for (const lang of LANGUAGES) {
      out[editor][lang] = {};
      for (const [variant, extra] of Object.entries(VARIANTS)) {
        document.body.innerHTML = '';
        const hass = hassFor(lang);
        const ed = document.createElement(tag) as AnyEl;
        ed.setConfig({ ...config, ...extra });
        ed.hass = hass;
        document.body.append(ed);
        await settle(ed);
        let history: string[];
        if (editor === 'dial') {
          await selectTab(ed, hass, 'editor.tabControls');
          history = lines(historyRow(ed, hass, editor));
          await selectTab(ed, hass, 'editor.tabLook');
        } else {
          history = lines(historyRow(ed, hass, editor));
        }
        out[editor][lang][variant] = { look: lines(lookSection(ed, editor)), history };
      }
    }
  }
  document.body.innerHTML = '';
  return out;
}

/** One control used once on a freshly mounted editor, and the config it sent (null when it sent none). */
export interface HandlerRecord {
  action: string;
  config: Record<string, unknown> | null;
}

/** JSON with sorted keys, so a record never depends on the order a handler builds the config in. */
function sorted(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sorted);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])]));
  return v;
}

async function mountEditor(tag: string, config: Record<string, unknown>, hass: HomeAssistant): Promise<{ ed: AnyEl; sent: Record<string, unknown>[] }> {
  document.body.innerHTML = '';
  const ed = document.createElement(tag) as AnyEl;
  const sent: Record<string, unknown>[] = [];
  ed.addEventListener('config-changed', (e: Event) => sent.push((e as CustomEvent).detail.config));
  ed.setConfig(config);
  ed.hass = hass;
  document.body.append(ed);
  await settle(ed);
  return { ed, sent };
}

function radios(ed: AnyEl, group: string): HTMLButtonElement[] {
  const g = [...ed.shadowRoot!.querySelectorAll('[role=radiogroup]')].find((r) => r.getAttribute('aria-label') === group);
  if (!g) throw new Error(`editor look: no radio group ${group}`);
  return [...g.querySelectorAll<HTMLButtonElement>('[role=radio]')];
}

function range(ed: AnyEl, label: string): HTMLInputElement {
  const field = [...ed.shadowRoot!.querySelectorAll('label.field')].find((f) => f.querySelector('.lbl.range > span')?.textContent?.trim() === label);
  const input = field?.querySelector<HTMLInputElement>('input[type=range]');
  if (!input) throw new Error(`editor look: no range ${label}`);
  return input;
}

/**
 * The handlers behind the Look controls and the History switch, in English: every glass and motion choice, the tint and
 * blur sliders, and the switch from on and from off, each on a fresh editor. A control wired to the wrong key shows
 * here although its DOM is right.
 */
export async function editorHandlers(): Promise<Record<string, HandlerRecord[]>> {
  const out: Record<string, HandlerRecord[]> = {};
  const hass = hassFor('en');
  const label = (key: string) => t(hass, key);
  for (const [editor, { tag, config }] of Object.entries(EDITORS) as [keyof typeof EDITORS, (typeof EDITORS)[keyof typeof EDITORS]][]) {
    const records: HandlerRecord[] = [];
    const run = async (action: string, variant: string, tab: string | null, use: (ed: AnyEl) => void) => {
      const { ed, sent } = await mountEditor(tag, { ...config, ...VARIANTS[variant] }, hass);
      if (editor === 'dial' && tab) await selectTab(ed, hass, tab);
      use(ed);
      await settle(ed);
      records.push({ action, config: sent.length ? (sorted(sent[sent.length - 1]) as Record<string, unknown>) : null });
    };
    const look = editor === 'dial' ? 'editor.tabLook' : null;
    const controls = editor === 'dial' ? 'editor.tabControls' : null;
    for (const group of ['editor.glass', 'editor.motion']) {
      const { ed } = await mountEditor(tag, config, hass);
      if (look) await selectTab(ed, hass, look);
      const names = radios(ed, label(group)).map((b) => b.textContent!.trim());
      for (const [i, name] of names.entries()) {
        await run(`${label(group)}: ${name}`, 'default', look, (e) => radios(e, label(group))[i].click());
      }
    }
    for (const [key, value] of [['editor.tint', '20'], ['editor.blur', '45']] as const) {
      await run(`${label(key)}: ${value}`, 'default', look, (e) => {
        const input = range(e, label(key));
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    const historySwitch = (e: AnyEl) => historyButton(e, hass, editor).click();
    await run(`${label('editor.historyButton')}: from on`, 'default', controls, historySwitch);
    await run(`${label('editor.historyButton')}: from off`, 'changed', controls, historySwitch);
    out[editor] = records;
  }
  document.body.innerHTML = '';
  return out;
}
