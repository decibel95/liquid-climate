import type { HassEntity, HomeAssistant } from '../types';
import en from './locales/en.json';
import nl from './locales/nl.json';
import de from './locales/de.json';
import fr from './locales/fr.json';
import es from './locales/es.json';
import it from './locales/it.json';

type Tree = { [key: string]: string | Tree };
export type Vars = Record<string, string | number>;
/** What the helpers need of hass; a missing hass means English. */
export type I18nHass = Partial<Pick<HomeAssistant, 'locale' | 'language' | 'localize' | 'formatEntityAttributeValue'>> | null | undefined;

/** Nested JSON to dotted keys: { dial: { sending: "x" } } becomes { "dial.sending": "x" }. */
export function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    if (typeof v === 'string') out[prefix + k] = v;
    else Object.assign(out, flatten(v, `${prefix}${k}.`));
  }
  return out;
}

/** One line per language: add a new one here (see CONTRIBUTING-translations.md). */
export const LOCALES: Record<string, Record<string, string>> = {
  en: flatten(en),
  nl: flatten(nl),
  de: flatten(de),
  fr: flatten(fr),
  es: flatten(es),
  it: flatten(it),
};

/** The language tag Home Assistant reports for this user, as written. */
export function rawLanguage(hass: I18nHass): string {
  const l = hass?.locale?.language || hass?.language;
  return typeof l === 'string' && l ? l : 'en';
}

/** The language of our strings: the tag, else its base (nl-BE becomes nl), else en (pt-BR has no pt, so en). */
export function resolveLanguage(hass: I18nHass): string {
  const tag = rawLanguage(hass).toLowerCase().replace(/_/g, '-');
  if (LOCALES[tag]) return tag;
  const base = tag.split('-')[0];
  return LOCALES[base] ? base : 'en';
}

/** The string for `key` in the user's language, then English, then the key itself. {name} placeholders are filled from vars. */
export function t(hass: I18nHass, key: string, vars?: Vars): string {
  const text = LOCALES[resolveLanguage(hass)][key] ?? LOCALES.en[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (m, name: string) => (Object.hasOwn(vars, name) ? String(vars[name]) : m)) : text;
}

// ---- Numbers -------------------------------------------------------------

const formats = new Map<string, Intl.NumberFormat>();

/** The locale tag for Intl, following the user's number format setting when it names one. */
function numberLocale(hass: I18nHass): string | undefined {
  switch (hass?.locale?.number_format) {
    case 'comma_decimal':
      return 'en-US';
    case 'decimal_comma':
      return 'de';
    case 'space_comma':
      return 'fr';
    case 'none':
      return 'en-US';
    case 'system':
      return undefined;
    default:
      return rawLanguage(hass).replace(/_/g, '-');
  }
}

/** A number with a fixed count of decimals, in the user's number format. Never grouped, so 1000 stays 1000. */
export function num(hass: I18nHass, value: number, digits = 1): string {
  digits = Math.min(20, Math.max(0, Math.trunc(digits) || 0));
  const tag = numberLocale(hass);
  const key = `${tag}|${digits}`;
  let f = formats.get(key);
  if (!f) {
    const opts = { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false };
    try {
      f = new Intl.NumberFormat(tag, opts);
    } catch {
      f = new Intl.NumberFormat('en', opts);
    }
    formats.set(key, f);
  }
  return f.format(value);
}

/** Whole numbers stay whole, others get `digits` decimals. */
export const numAuto = (hass: I18nHass, value: number, digits: number): string => num(hass, value, Number.isInteger(value) ? 0 : digits);

// ---- Home Assistant's own translations ---------------------------------------

/** hass.localize, or an empty string when it is missing (tests, dev harness) or knows no such key. */
export function haLocalize(hass: I18nHass, key: string): string {
  try {
    const v = hass?.localize?.(key);
    return typeof v === 'string' ? v : '';
  } catch {
    return '';
  }
}

const CLIMATE = 'component.climate.entity_component._';

/** HA's name for an hvac mode, or an empty string. */
export const haMode = (hass: I18nHass, id: string): string => haLocalize(hass, `${CLIMATE}.state.${id}`);

export type OptionKind = 'fan_mode' | 'swing_mode' | 'swing_horizontal_mode' | 'preset_mode' | 'hvac_action';

/** First letter capitalised, underscores as spaces: the last resort for a value nobody translated. */
export function humanize(v: string): string {
  const s = v.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A value in one case with spaces and dashes as underscores: "Wind Nice" and "wind_nice" are the same value. */
const bare = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, '_');

/**
 * Home Assistant has no translation for a value when it answers nothing, the key it was asked for, the value itself, or the
 * value dressed up (capitalised: "stop" becomes "Stop"). None of these is an answer. A real formatting ("ECO") is kept.
 */
const translated = (text: string | undefined, value: string, key?: string): text is string =>
  !!text && text !== key && text !== value && text !== humanize(value) && text !== value.charAt(0).toUpperCase() + value.slice(1);

/**
 * The name of a fan, swing, preset or hvac action value. Home Assistant's translation wins
 * (through the entity when one is at hand, else the component keys), then ours, then the value
 * made readable. Only a text that differs from the value counts as a translation.
 */
export function optionName(hass: I18nHass, kind: OptionKind, value: string, stateObj?: HassEntity): string {
  const viaEntity = stateObj ? hass?.formatEntityAttributeValue?.(stateObj, kind, value) : '';
  if (translated(viaEntity, value, kind)) return viaEntity;
  const haKey = `${CLIMATE}.state_attributes.${kind}.state.${value}`;
  const ha = haLocalize(hass, haKey);
  if (translated(ha, value, haKey)) return ha;
  const key = bare(value);
  const own = kind === 'hvac_action' ? `hvacAction.${key}` : `option.${key}`;
  const text = LOCALES[resolveLanguage(hass)][own] ?? LOCALES.en[own];
  return text ?? humanize(value);
}
