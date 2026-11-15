import { allFixtures, makeHass, mergeFixtures, type Fixture } from './fixtures';
import { demoIntegration } from './fixtures/demo-integration';
import type { HomeAssistant } from '../src/types';

export type AnyEl = HTMLElement & Record<string, any>;
export type Call = { service: string; data: any };

export interface DemoHassOptions {
  /** The HA unit system. Metric by default. */
  system?: '°C' | '°F';
  language?: string;
  /** Also load the Daikin and generic fixtures, to prove the two kinds of install do not mix. */
  withDaikin?: boolean;
  tweak?: (f: Fixture) => void;
}

/** A hass holding the demo integration's climate entities, and the service calls made on it. */
export function demoHass(o: DemoHassOptions = {}) {
  const system = o.system ?? '°C';
  const f = o.withDaikin ? mergeFixtures(allFixtures, demoIntegration(system)) : demoIntegration(system);
  o.tweak?.(f);
  const calls: Call[] = [];
  const hass: HomeAssistant = makeHass(f, system, (domain, service, data) => void calls.push({ service: `${domain}.${service}`, data: data as any }));
  if (o.language) {
    hass.language = o.language;
    hass.locale = { language: o.language, number_format: 'language' };
    // Like the dev harness: Home Assistant knows no key, so our own strings show.
    hass.localize = () => '';
  }
  return { f, hass, calls };
}

export async function settle(el: AnyEl) {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
    await el.updateComplete;
  }
}

export async function mount(tag: string, cfg: Record<string, unknown>, hass: HomeAssistant): Promise<AnyEl> {
  const el = document.createElement(tag) as AnyEl;
  el.setConfig({ type: `custom:${tag}`, ...cfg });
  el.hass = hass;
  document.body.append(el);
  await settle(el);
  return el;
}

export const $ = (el: AnyEl, sel: string) => el.shadowRoot!.querySelector(sel) as HTMLElement | null;
export const $$ = (el: AnyEl, sel: string) => [...el.shadowRoot!.querySelectorAll(sel)] as HTMLElement[];
export const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

/** Every card tag with a config for one entity. */
export const CARDS = [
  ['dial', 'liquid-climate-card'],
  ['tile', 'liquid-climate-tile'],
  ['badge', 'liquid-climate-badge'],
  ['cluster', 'liquid-climate-cluster'],
] as const;

/** The config that shows one entity in a card: the cluster takes a list. */
export const configFor = (tag: string, entity: string, extra: Record<string, unknown> = {}) =>
  tag === 'liquid-climate-cluster' ? { entities: [entity], ...extra } : { entity, ...extra };
