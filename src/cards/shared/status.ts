import { BATTERY_LOW, type BatteryState } from '../../detect/resolve';
import { humanize, num, optionName, t } from '../../i18n';
import { MODES, domainModeLabel, modeVerb } from '../../ui/modes';
import { actionOf, domainOf } from '../../domain';
import type { HassEntity, HomeAssistant } from '../../types';

/**
 * Status word for a subline: the action when the entity reports one (hvac_action, or a humidifier's
 * action), else the mode: a water heater's operation mode, a humidifier's mode or On.
 */
export function statusWord(hass: HomeAssistant, s: HassEntity, mode: string, modeChanging: boolean, subMode?: string | null): string {
  if (mode === 'off') return modeVerb(hass, 'off');
  const domain = domainOf(s.entity_id);
  // A humidifier mode that is pending wins over the action the entity still reports for the old one.
  const subPending = domain === 'humidifier' && !!subMode && subMode !== s.attributes.mode;
  const action = actionOf(s);
  if (!modeChanging && !subPending && action) return optionName(hass, domain === 'humidifier' ? 'action' : 'hvac_action', action, s);
  if (domain === 'humidifier') {
    const sub = subMode ?? s.attributes.mode;
    return typeof sub === 'string' && sub ? domainModeLabel(hass, domain, sub) : t(hass, 'common.on');
  }
  if (domain === 'water_heater') return domainModeLabel(hass, domain, mode);
  if (MODES.some((m) => m.id === mode)) return modeVerb(hass, mode);
  return (mode === s.state && hass.formatEntityState?.(s)) || humanize(mode);
}

/** Heating right now: hvac_action says so, or the unit is in heat mode and reports no action. */
export function activelyHeating(s: HassEntity, mode: string, modeChanging: boolean): boolean {
  if (mode === 'off') return false;
  const action = actionOf(s);
  if (!modeChanging && action) return action === 'heating' || action === 'preheating';
  return mode === 'heat';
}

/** Actions that read as "doing it": a sentence like "Heating to 20.0°" fits them. */
const DOING = ['heating', 'preheating', 'cooling', 'drying', 'humidifying'];

/**
 * The status word reads as an activity ("Heating to 20°") rather than a state ("Idle, target 20°").
 * A water heater or humidifier without an action names its mode, a state: "Eco, target 50°".
 */
export function readsAsActivity(s: HassEntity, mode: string, modeChanging: boolean, subMode?: string | null): boolean {
  if (mode === 'off') return true;
  // A pending humidifier mode makes the reported action stale, as a pending climate mode does.
  const subPending = !!subMode && subMode !== s.attributes.mode;
  const action = modeChanging || subPending ? undefined : actionOf(s);
  if (!action) return domainOf(s.entity_id) === 'climate';
  return DOING.includes(action);
}

/** An active mode whose hvac_action says idle (or off): a valve that has reached its target. */
export function isResting(s: HassEntity, mode: string, modeChanging: boolean): boolean {
  const action = actionOf(s);
  return mode !== 'off' && !modeChanging && !!action && ['idle', 'off'].includes(action);
}

/** "Battery low" or "Battery low, 12%": the attention text of a low battery, same on every card. */
export function batteryText(hass: HomeAssistant, battery: BatteryState): string {
  return battery.percent != null && battery.percent < BATTERY_LOW
    ? t(hass, 'common.batteryLowValue', { value: num(hass, Math.round(battery.percent), 0) })
    : t(hass, 'common.batteryLow');
}
