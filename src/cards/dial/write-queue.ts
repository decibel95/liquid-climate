import type { WriteCall } from '@decibel95/liquid-core';
import type { Optimistic } from './capabilities';
import { modeInfo } from '../../ui/modes';
import { WATER_HEATER_FEATURE, domainOf, operationList, supports } from '../../domain';
import type { HassEntity } from '../../types';

/**
 * One service call: `domain` (climate when absent; ClimateWriter fills it in), `service`, `data`, and `sets`, what the
 * call sets in Optimistic terms when that differs from its data (set_operation_mode sets hvac_mode).
 */
export type ServiceCall = WriteCall<Optimistic>;

/** What the unit will report once earlier writes land: in-flight values over the entity. */
function expected(stateObj: HassEntity, inflight: Optimistic): { a: Record<string, any>; mode: string } {
  const a: Record<string, any> = { ...stateObj.attributes };
  for (const [k, v] of Object.entries(inflight)) if (k !== 'hvac_mode' && v !== undefined) a[k] = v;
  return { a, mode: inflight.hvac_mode ?? stateObj.state };
}

/**
 * Water heater calls. Power uses turn_on and turn_off when the ON_OFF flag is set, else the
 * operation mode off. Turning on with a mode turns on first, then sets the mode. The setpoint
 * is dropped while the final mode is off, like a climate mode without a setpoint.
 */
function waterHeaterCalls(entityId: string, change: Optimistic, stateObj: HassEntity, inflight: Optimistic): ServiceCall[] {
  const { a, mode: current } = expected(stateObj, inflight);
  const domain = 'water_heater';
  const base = { entity_id: entityId };
  const calls: ServiceCall[] = [];
  const onOff = supports(stateObj, WATER_HEATER_FEATURE.ON_OFF);
  const ops = operationList(stateObj);
  const target = change.hvac_mode;
  const finalMode = target ?? current;
  if (target !== undefined && target !== current) {
    if (target === 'off') {
      calls.push(
        onOff
          ? { domain, service: 'turn_off', data: base, sets: { hvac_mode: 'off' } }
          : { domain, service: 'set_operation_mode', data: { ...base, operation_mode: 'off' }, sets: { hvac_mode: 'off' } },
      );
    } else {
      if (current === 'off' && onOff) calls.push({ domain, service: 'turn_on', data: base, sets: { hvac_mode: target } });
      if (ops.includes(target)) calls.push({ domain, service: 'set_operation_mode', data: { ...base, operation_mode: target }, sets: { hvac_mode: target } });
    }
  }
  if (finalMode !== 'off' && change.temperature !== undefined && change.temperature !== a.temperature) {
    calls.push({ domain, service: 'set_temperature', data: { ...base, temperature: change.temperature } });
  }
  if (change.away_mode !== undefined && change.away_mode !== a.away_mode) {
    calls.push({ domain, service: 'set_away_mode', data: { ...base, away_mode: change.away_mode === 'on' }, sets: { away_mode: change.away_mode } });
  }
  return calls;
}

/**
 * Humidifier calls: turn_on or turn_off, then the mode, then the target humidity. Mode and
 * humidity are dropped when the humidifier ends up off.
 */
function humidifierCalls(entityId: string, change: Optimistic, stateObj: HassEntity, inflight: Optimistic): ServiceCall[] {
  const { a, mode: current } = expected(stateObj, inflight);
  const domain = 'humidifier';
  const base = { entity_id: entityId };
  const calls: ServiceCall[] = [];
  const power = change.hvac_mode;
  const finalPower = power ?? current;
  if (power !== undefined && power !== current) {
    calls.push({ domain, service: power === 'off' ? 'turn_off' : 'turn_on', data: base, sets: { hvac_mode: power } });
  }
  if (finalPower === 'off') return calls;
  if (change.mode !== undefined && change.mode !== a.mode) calls.push({ domain, service: 'set_mode', data: { ...base, mode: change.mode } });
  if (change.humidity !== undefined && change.humidity !== a.humidity) calls.push({ domain, service: 'set_humidity', data: { ...base, humidity: change.humidity } });
  return calls;
}

/**
 * Turn a set of pending changes into the minimum list of climate service calls.
 *
 * - Values equal to what the unit already has, or will have once in-flight writes land, are dropped.
 * - One call per service, whatever number of interactions led to it.
 * - hvac mode goes first so a setpoint lands on the new mode.
 * - Setpoint changes are dropped when the final mode has no setpoint.
 */
export function buildCalls(
  entityId: string,
  change: Optimistic,
  stateObj: HassEntity,
  inflight: Optimistic = {},
): ServiceCall[] {
  const domain = domainOf(entityId);
  if (domain === 'water_heater') return waterHeaterCalls(entityId, change, stateObj, inflight);
  if (domain === 'humidifier') return humidifierCalls(entityId, change, stateObj, inflight);
  const { a, mode: currentMode } = expected(stateObj, inflight);
  const calls: ServiceCall[] = [];
  const base = { entity_id: entityId };

  const finalMode = change.hvac_mode ?? currentMode;
  const modeChanged = change.hvac_mode !== undefined && change.hvac_mode !== currentMode;
  if (modeChanged) calls.push({ service: 'set_hvac_mode', data: { ...base, hvac_mode: change.hvac_mode } });

  if (modeInfo(finalMode).setpoint) {
    const t: Record<string, unknown> = {};
    if (change.temperature !== undefined && change.temperature !== a.temperature) t.temperature = change.temperature;
    const lowChanged = change.target_temp_low !== undefined && change.target_temp_low !== a.target_temp_low;
    const highChanged = change.target_temp_high !== undefined && change.target_temp_high !== a.target_temp_high;
    if (lowChanged || highChanged) {
      // The service wants both ends of a range together.
      t.target_temp_low = change.target_temp_low ?? a.target_temp_low;
      t.target_temp_high = change.target_temp_high ?? a.target_temp_high;
    }
    if (Object.keys(t).length) calls.push({ service: 'set_temperature', data: { ...base, ...t } });
  }

  const simple: [keyof Optimistic, string, string][] = [
    ['fan_mode', 'fan_mode', 'set_fan_mode'],
    ['swing_mode', 'swing_mode', 'set_swing_mode'],
    ['swing_horizontal_mode', 'swing_horizontal_mode', 'set_swing_horizontal_mode'],
    ['preset_mode', 'preset_mode', 'set_preset_mode'],
  ];
  for (const [key, attr, service] of simple) {
    const v = change[key];
    if (v !== undefined && v !== a[attr]) calls.push({ service, data: { ...base, [key]: v } });
  }
  return calls;
}
