import { BATTERY_LOW, type BatteryState } from '../../detect/resolve';
import { humanize, num, optionName, t } from '../../i18n';
import { MODES, modeVerb } from '../../ui/modes';
import type { HassEntity, HomeAssistant } from '../../types';

/** Status word for a subline: hvac_action when the entity reports one, else the mode. */
export function statusWord(hass: HomeAssistant, s: HassEntity, mode: string, modeChanging: boolean): string {
  if (mode === 'off') return modeVerb(hass, 'off');
  const action = s.attributes.hvac_action;
  if (!modeChanging && typeof action === 'string' && action) return optionName(hass, 'hvac_action', action, s);
  if (MODES.some((m) => m.id === mode)) return modeVerb(hass, mode);
  return (mode === s.state && hass.formatEntityState?.(s)) || humanize(mode);
}

/** Heating right now: hvac_action says so, or the unit is in heat mode and reports no action. */
export function activelyHeating(s: HassEntity, mode: string, modeChanging: boolean): boolean {
  if (mode === 'off') return false;
  const action = s.attributes.hvac_action;
  if (!modeChanging && typeof action === 'string' && action) return action === 'heating' || action === 'preheating';
  return mode === 'heat';
}

/** Actions that read as "doing it": a sentence like "Heating to 20.0°" fits them. */
const DOING = ['heating', 'preheating', 'cooling', 'drying'];

/** The status word reads as an activity ("Heating to 20°") rather than a state ("Idle, target 20°"). */
export function readsAsActivity(s: HassEntity, mode: string, modeChanging: boolean): boolean {
  const action = s.attributes.hvac_action;
  if (modeChanging || mode === 'off' || typeof action !== 'string' || !action) return true;
  return DOING.includes(action);
}

/** An active mode whose hvac_action says idle (or off): a valve that has reached its target. */
export function isResting(s: HassEntity, mode: string, modeChanging: boolean): boolean {
  const action = s.attributes.hvac_action;
  return mode !== 'off' && !modeChanging && typeof action === 'string' && ['idle', 'off'].includes(action);
}

/** "Battery low" or "Battery low, 12%": the attention text of a low battery, same on every card. */
export function batteryText(hass: HomeAssistant, battery: BatteryState): string {
  return battery.percent != null && battery.percent < BATTERY_LOW
    ? t(hass, 'common.batteryLowValue', { value: num(hass, Math.round(battery.percent), 0) })
    : t(hass, 'common.batteryLow');
}
