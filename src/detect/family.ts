import type { HassDevice, HassEntityRegistryEntry, HomeAssistant } from '../types';

export interface DeviceFamily {
  /** Device of the climate entity, if it has one. */
  rootDeviceId: string | null;
  /** Root device, its children (transitively) and, when unambiguous, its parent. */
  deviceIds: Set<string>;
  entities: HassEntityRegistryEntry[];
}

export function deviceName(device: HassDevice | undefined): string {
  return device?.name_by_user || device?.name || '';
}

type Registry = Pick<HomeAssistant, 'entities' | 'devices'>;

/**
 * Build the device family of a climate entity.
 *
 * Some integrations (Daikin Onecta) keep the climate entity on a thin parent device and
 * put humidity, outdoor temperature, energy and health sensors on child devices, so the
 * family holds the climate device plus every device linked below it with via_device_id.
 *
 * When the climate entity sits on a child device, its parent joins the family too, unless
 * that parent is a hub with more than one climate child: then the siblings' sensors would
 * leak in, so the search stops at the climate device.
 */
export function getDeviceFamily(hass: Partial<Registry>, climateId: string): DeviceFamily {
  const entities = hass.entities ?? {};
  const devices = hass.devices ?? {};
  const root = entities[climateId]?.device_id ?? null;
  const deviceIds = new Set<string>();
  if (root) {
    deviceIds.add(root);
    const all = Object.values(devices);
    const queue = [root];
    while (queue.length) {
      const parent = queue.shift()!;
      for (const d of all) {
        if (d.via_device_id === parent && !deviceIds.has(d.id)) {
          deviceIds.add(d.id);
          queue.push(d.id);
        }
      }
    }
    const parent = devices[root]?.via_device_id;
    if (parent && devices[parent]) {
      const climateDevices = new Set(
        Object.values(entities)
          .filter((e) => e.entity_id.startsWith('climate.') && e.device_id)
          .map((e) => e.device_id as string),
      );
      const climateChildren = all.filter((d) => d.via_device_id === parent && climateDevices.has(d.id));
      if (climateChildren.length <= 1) deviceIds.add(parent);
    }
  }
  const members = Object.values(entities).filter(
    (e) => e.device_id && deviceIds.has(e.device_id) && e.entity_id !== climateId,
  );
  return { rootDeviceId: root, deviceIds, entities: members };
}
