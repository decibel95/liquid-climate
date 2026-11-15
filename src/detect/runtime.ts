import type { HomeAssistant } from '../types';
import type { Memo } from './cache';
import { getDeviceFamily } from './family';
import { detectSensors, type Detection } from './roles';

export interface RuntimeDetection {
  detection: Detection;
  /** Family entities whose state has not arrived yet; their first state must trigger a render. */
  awaiting: string[];
}

/** Runtime detection for a card, memoised on the registries, the entity and the number of states. */
export function runtimeDetection(hass: HomeAssistant, entity: string, memo: Memo<RuntimeDetection>): RuntimeDetection {
  // States are part of the key: device classes only exist once an entity's state has arrived.
  const key = [hass.entities, hass.devices, entity, Object.keys(hass.states ?? {}).length];
  return memo.get(key, () => ({
    awaiting: getDeviceFamily(hass, entity)
      .entities.filter((e) => !hass.states[e.entity_id])
      .map((e) => e.entity_id),
    detection: detectSensors(hass, entity),
  }));
}
