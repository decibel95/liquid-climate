import { createI18n, flatten, haLocalize, humanize, translated, type I18nHass } from '@decibel95/liquid-core';
import type { HassEntity } from '../types';
import en from './locales/en.json';
import nl from './locales/nl.json';
import de from './locales/de.json';
import fr from './locales/fr.json';
import es from './locales/es.json';
import it from './locales/it.json';
import pl from './locales/pl.json';

export { flatten, rawLanguage, num, numAuto, haLocalize, humanize } from '@decibel95/liquid-core';
export type { Vars, I18nHass } from '@decibel95/liquid-core';

/**
 * liquid-core has no Polish yet, so Liquid Climate carries its `core.*` strings. Delete PL_CORE and
 * PL_CORE_LAYER once liquid-core ships Polish, otherwise ours override core's.
 */
const PL_CORE = {
  close: 'Zamknij',
  history: 'Historia',
  off: 'Wył.',
  unavailable: 'Niedostępny',
  percent: '{value}%',
  editor: {
    help: 'Pomoc: {section}',
    glass: 'Szkło',
    glassAuto: 'Auto',
    glassDark: 'Ciemne',
    glassLight: 'Jasne',
    tint: 'Kolor trybu',
    blur: 'Rozmycie',
    motion: 'Animacja',
    motionRich: 'Rozbudowana',
    motionSubtle: 'Subtelna',
    motionMinimal: 'Minimalna',
    reducedMotion: 'Systemowe ograniczenie animacji ma pierwszeństwo.'
  }
};

/** One line per language: add a new one here (see CONTRIBUTING-translations.md). */
export const LC_LAYER: Record<string, Record<string, string>> = {
  en: flatten(en),
  nl: flatten(nl),
  de: flatten(de),
  fr: flatten(fr),
  es: flatten(es),
  it: flatten(it),
  pl: flatten(pl),
};

/** Under LC_LAYER, which stays free of `core.*` keys (a test checks that). */
const PL_CORE_LAYER = { pl: flatten({ core: PL_CORE }) };

const i18n = createI18n([PL_CORE_LAYER, LC_LAYER]);

/** Our strings merged over liquid-core's `core.*` strings (mutable: a test may add a key). */
export const LOCALES = i18n.locales;
/** The language of our strings: the tag, else its base (nl-BE becomes nl), else en (pt-BR has no pt, so en). */
export const resolveLanguage = i18n.resolveLanguage;
/** The string for `key` in the user's language, then English, then the key itself. {name} placeholders are filled from vars. */
export const t = i18n.t;

// ---- Home Assistant's own translations ---------------------------------------

const CLIMATE = 'component.climate.entity_component._';

/** HA's name for an hvac mode, or an empty string. */
export const haMode = (hass: I18nHass, id: string): string => haLocalize(hass, `${CLIMATE}.state.${id}`);

/** `action` is a humidifier's action attribute; its values share our hvacAction strings. */
export type OptionKind = 'fan_mode' | 'swing_mode' | 'swing_horizontal_mode' | 'preset_mode' | 'hvac_action' | 'action';

/** A value in one case with spaces and dashes as underscores: "Wind Nice" and "wind_nice" are the same value. */
const bare = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, '_');

/**
 * The name of a fan, swing, preset or hvac action value. Home Assistant's translation wins
 * (through the entity when one is at hand, else the component keys), then ours, then the value
 * made readable. Only a text that differs from the value counts as a translation.
 */
export function optionName(hass: I18nHass, kind: OptionKind, value: string, stateObj?: HassEntity): string {
  const viaEntity = stateObj ? hass?.formatEntityAttributeValue?.(stateObj, kind, value) : '';
  if (translated(viaEntity, value, kind)) return viaEntity;
  const component = kind === 'action' ? 'component.humidifier.entity_component._' : CLIMATE;
  const haKey = `${component}.state_attributes.${kind}.state.${value}`;
  const ha = haLocalize(hass, haKey);
  if (translated(ha, value, haKey)) return ha;
  const key = bare(value);
  const own = kind === 'hvac_action' || kind === 'action' ? `hvacAction.${key}` : `option.${key}`;
  const text = LOCALES[resolveLanguage(hass)][own] ?? LOCALES.en[own];
  return text ?? humanize(value);
}
