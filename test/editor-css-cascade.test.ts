// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { editorStyles } from '@decibel95/liquid-core';
import type { CSSResultGroup, CSSResultOrNative } from 'lit';
import '../src/index';
import { LiquidClimateCardEditor } from '../src/editor/liquid-climate-card-editor';
import { LiquidClimateClusterEditor } from '../src/editor/liquid-climate-cluster-editor';
import frozenSheet from './fixtures/editor-css-0.12.0.json';
import { AREAS, FLOORS, allFixtures, makeHass, mergeFixtures } from './fixtures';

/**
 * Whether the editor CSS of Liquid Climate can be split into core's editorStyles plus a rest without changing
 * a single rendered style. A rule of the rest that sets a property differently from a rule of editorStyles
 * at equal specificity would depend on the order of the two, and the split changes that order (all of
 * editorStyles first). The test finds every such pair on the elements the four editors render.
 */

type AnyEl = HTMLElement & Record<string, any>;
type Rule = { selector: string; decls: Map<string, string>; text: string };

const flat = (g: CSSResultGroup): string[] =>
  (Array.isArray(g) ? (g as CSSResultGroup[]).flatMap(flat) : [(g as CSSResultOrNative & { cssText?: string }).cssText ?? '']);

/** Top-level style rules (at-rules such as @media are skipped: they only hold transitions). */
function parse(css: string): Rule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open < 0) break;
    const head = src.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < src.length && depth) depth += src[j] === '{' ? 1 : src[j] === '}' ? -1 : 0, j++;
    const body = src.slice(open + 1, j - 1);
    i = j;
    if (head.startsWith('@')) continue;
    const decls = new Map<string, string>();
    for (const d of body.split(';')) {
      const k = d.indexOf(':');
      if (k > 0) decls.set(d.slice(0, k).trim(), d.slice(k + 1).trim().replace(/\s+/g, ' '));
    }
    const normal = head.replace(/\s+/g, ' ');
    rules.push({ selector: normal, decls, text: `${normal}{${[...decls].map(([k, v]) => `${k}:${v}`).join(';')}}` });
  }
  return rules;
}

/** The selectors of a rule, with the specificity of each and a form `matches` can take (state pseudos dropped). */
function selectors(rule: Rule) {
  return rule.selector.split(/,(?![^(]*\))/).map((s) => {
    const sel = s.trim();
    const strip = sel.replace(/:(focus-visible|hover|focus|disabled|active)/g, '');
    const plain = sel.replace(/\[[^\]]*\]/g, 'X').replace(/:not\([^)]*\)/g, 'X');
    const ids = (plain.match(/#[\w-]+/g) ?? []).length;
    const cls = (plain.match(/\.[\w-]+|:(?!:)[\w-]+|X/g) ?? []).length;
    const tags = (plain.replace(/[.#:][\w-]+|X/g, ' ').match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
    return { strip, spec: ids * 10000 + cls * 100 + tags, host: sel.startsWith(':host') };
  });
}

const stylesOf = (c: { styles?: CSSResultGroup }) => parse(flat(c.styles ?? []).join('\n'));

const core = parse(flat(editorStyles).join('\n'));
const coreText = new Set(core.map((r) => r.text));
const sheetsOf = (c: { styles?: CSSResultGroup }) => {
  const all = stylesOf(c);
  return { core: all.filter((r) => coreText.has(r.text)), rest: all.filter((r) => !coreText.has(r.text)) };
};

function matched(el: Element, rule: Rule): number | null {
  let best: number | null = null;
  for (const s of selectors(rule)) {
    if (s.host) continue;
    let hit = false;
    try {
      hit = el.matches(s.strip);
    } catch {
      hit = false;
    }
    if (hit && (best === null || s.spec > best)) best = s.spec;
  }
  return best;
}

async function mount(tag: string, config: Record<string, unknown>, lang = 'en') {
  const f = mergeFixtures(allFixtures);
  const hass = makeHass(f, '°C');
  hass.areas = structuredClone(AREAS);
  hass.floors = structuredClone(FLOORS);
  hass.language = lang;
  const ed = document.createElement(tag) as unknown as AnyEl;
  ed.setConfig(config);
  ed.hass = hass;
  document.body.append(ed);
  await settle(ed);
  return ed;
}
const settle = async (ed: AnyEl) => {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await ed.updateComplete;
  }
};

/** Everything an editor can show: every tab, every reveal button pressed once. */
async function renders(): Promise<{ label: string; ed: AnyEl; klass: { styles?: CSSResultGroup } }[]> {
  const out: { label: string; ed: AnyEl; klass: { styles?: CSSResultGroup } }[] = [];
  const dial = { type: 'custom:liquid-climate-card', entity: 'climate.keuken_airco', status_entities: [{ entity: 'sensor.nowhere' }, { entity: 'sensor.x', actions: ['script.a'] }] };
  for (const tab of ['setup', 'sensors', 'controls', 'look']) {
    const ed = await mount('liquid-climate-card-editor', dial);
    ed._tab = tab;
    await settle(ed);
    for (const b of ed.shadowRoot!.querySelectorAll<HTMLElement>('button.ghost.small')) {
      b.click();
      await settle(ed);
    }
    out.push({ label: `card ${tab}`, ed, klass: LiquidClimateCardEditor });
  }
  for (const [tag, config] of [
    ['liquid-climate-tile-editor', { type: 'custom:liquid-climate-tile', entity: 'climate.keuken_airco' }],
    ['liquid-climate-badge-editor', { type: 'custom:liquid-climate-badge', entity: 'climate.keuken_airco' }],
    ['liquid-climate-cluster-editor', { type: 'custom:liquid-climate-cluster' }],
    ['liquid-climate-cluster-editor', { type: 'custom:liquid-climate-cluster', source: 'list', entities: ['climate.keuken_airco'] }],
  ] as const) {
    const ed = await mount(tag, config as Record<string, unknown>);
    const klass = tag === 'liquid-climate-cluster-editor' ? LiquidClimateClusterEditor : LiquidClimateCardEditor;
    out.push({ label: tag, ed, klass });
  }
  return out;
}

describe('editor CSS cascade: editorStyles plus the rest', () => {
  it('the editor sheet is the 0.12.0 sheet plus .look, and editorStyles keeps the 0.12.0 order', () => {
    const frozen: string[] = (frozenSheet as { rules: string[] }).rules;
    const own = stylesOf(LiquidClimateCardEditor).map((r) => r.text);
    expect([...own].sort()).toEqual([...frozen, '.look{display:contents}'].sort());
    let at = -1;
    for (const r of core.filter((r) => r.selector !== '.look')) {
      const next = frozen.indexOf(r.text, at + 1);
      expect(next, r.text).toBeGreaterThan(at);
      at = next;
    }
  });

  it('no property differs between editorStyles and the rest at equal specificity, on any element of any tab', async () => {
    const all = await renders();
    const conflicts: string[] = [];
    let pairs = 0;
    let elements = 0;
    for (const { label, ed, klass } of all) {
      const { core: c, rest } = sheetsOf(klass);
      for (const el of ed.shadowRoot!.querySelectorAll('*')) {
        elements++;
        const cs = c.map((r) => [r, matched(el, r)] as const).filter(([, s]) => s !== null);
        const rs = rest.map((r) => [r, matched(el, r)] as const).filter(([, s]) => s !== null);
        for (const [a, sa] of cs) {
          for (const [b, sb] of rs) {
            if (sa !== sb) continue;
            pairs++;
            for (const [prop, val] of a.decls) {
              const other = b.decls.get(prop);
              if (other !== undefined && other !== val) conflicts.push(`${label} <${el.localName} class="${el.className}">: ${prop} ${a.selector} (${val}) vs ${b.selector} (${other})`);
            }
          }
        }
      }
    }
    expect(elements).toBeGreaterThan(500);
    expect(pairs, 'sanity: the test sees overlapping rules at equal specificity').toBeGreaterThan(0);
    expect(conflicts).toEqual([]);
  });
});
