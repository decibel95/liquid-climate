import { num, t, type I18nHass } from '../i18n';
import type { HassEntity, HomeAssistant } from '../types';

type StatusHass = Pick<HomeAssistant, 'formatEntityState'> & I18nHass;

export type StatusValue =
  | { kind: 'none' }
  | { kind: 'dot'; on: boolean; text: string }
  | { kind: 'unit'; number: string; unit: string }
  | { kind: 'text'; text: string };

const DOT_DOMAINS = ['binary_sensor', 'input_boolean', 'switch'];

export function formatState(hass: StatusHass, e: HassEntity): string {
  if (hass.formatEntityState) return hass.formatEntityState(e);
  const unit = e.attributes.unit_of_measurement;
  return `${plainNumber(hass, e.state)}${unit ? ` ${unit}` : ''}`;
}

/** Remaining time of an active timer as mm:ss, or null when it cannot be told. */
export function timerRemaining(e: HassEntity, now = Date.now()): string | null {
  if (e.state !== 'active') return null;
  const finishes = e.attributes.finishes_at ? Date.parse(String(e.attributes.finishes_at)) : NaN;
  if (!Number.isFinite(finishes)) return null;
  const sec = Math.max(0, Math.ceil((finishes - now) / 1000));
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

/** A numeric state in the user's number format, keeping the decimals it has; anything else as is. */
function plainNumber(hass: StatusHass, state: string): string {
  const s = state.trim();
  return /^-?\d+(\.\d+)?$/.test(s) ? num(hass, Number(s), s.split('.')[1]?.length ?? 0) : state;
}

/** What a status row shows on the right, by entity domain. */
export function statusValue(hass: StatusHass, e: HassEntity | undefined): StatusValue {
  if (!e || e.state === 'unavailable' || e.state === 'unknown') return { kind: 'none' };
  const domain = e.entity_id.split('.')[0];
  if (DOT_DOMAINS.includes(domain)) {
    const on = e.state === 'on';
    return { kind: 'dot', on, text: formatState(hass, e) || t(hass, on ? 'common.on' : 'common.off') };
  }
  if (domain === 'timer') {
    const left = timerRemaining(e);
    return { kind: 'text', text: left ?? formatState(hass, e) };
  }
  if (domain === 'sensor' && e.attributes.unit_of_measurement) {
    return { kind: 'unit', number: plainNumber(hass, e.state), unit: String(e.attributes.unit_of_measurement) };
  }
  return { kind: 'text', text: formatState(hass, e) };
}

/** Plain-text version of the value, for the title attribute. */
export function statusTitle(v: StatusValue): string {
  return v.kind === 'dot' || v.kind === 'text' ? v.text : v.kind === 'unit' ? `${v.number} ${v.unit}` : '';
}
