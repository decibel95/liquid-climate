import { clusterSource, type ClusterConfig, type ClusterRoom } from '../../config';
import { t, type I18nHass } from '../../i18n';
import type { HomeAssistant } from '../../types';

export interface RoomRef {
  /** The room with its overrides (from `entities`, or from `rooms` in an auto mode). */
  room: ClusterRoom;
  /** Display name: the override, else the area when this is its only unit, else the entity name. */
  name: string;
  entityName: string;
  areaId?: string;
  areaName?: string;
  floorId?: string;
}

export interface RoomGroup {
  id: string;
  /** Floor heading, only when the rooms span more than one group. */
  title: string | null;
  rooms: RoomRef[];
}

type Registries = Pick<HomeAssistant, 'states' | 'entities' | 'devices' | 'areas' | 'floors'>;

/** The entity's own area, else its device's area. */
export function areaOf(hass: Partial<Registries>, entityId: string): string | undefined {
  const e = hass.entities?.[entityId];
  if (e?.area_id) return e.area_id;
  const device = e?.device_id ? hass.devices?.[e.device_id] : undefined;
  return device?.area_id ?? undefined;
}

/** Hidden or disabled in the entity registry. */
export function isHiddenEntity(hass: Partial<Registries>, entityId: string): boolean {
  const e = hass.entities?.[entityId];
  return !!e && (e.hidden === true || !!e.hidden_by || !!e.disabled_by);
}

export function entityName(hass: Partial<Registries>, entityId: string): string {
  return hass.states?.[entityId]?.attributes.friendly_name || hass.entities?.[entityId]?.name || entityId;
}

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

/** Floors with a level first, lowest level first, then by name, then by id. No floor at all goes last. */
function floorOrder(hass: Partial<Registries>, a?: string, b?: string): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const fa = hass.floors?.[a];
  const fb = hass.floors?.[b];
  const la = typeof fa?.level === 'number' ? fa.level : Infinity;
  const lb = typeof fb?.level === 'number' ? fb.level : Infinity;
  if (la !== lb) return la < lb ? -1 : 1;
  return byText(fa?.name ?? a, fb?.name ?? b) || (a < b ? -1 : 1);
}

/** Rooms with an area first, by area name. */
function areaOrder(a: RoomRef, b: RoomRef): number {
  if (!!a.areaName !== !!b.areaName) return a.areaName ? -1 : 1;
  return byText(a.areaName ?? '', b.areaName ?? '') || byText(a.entityName, b.entityName);
}

/**
 * The rooms a cluster shows, in groups. An `entities` list keeps its own order in one group.
 * Otherwise every visible climate entity (only one area or one floor when set) minus `exclude`,
 * ordered by floor level, area name and entity name. Grouping by floor gives one group per
 * floor, with headings once there is more than one.
 */
export function clusterGroups(hass: Registries & I18nHass, cfg: ClusterConfig): RoomGroup[] {
  const source = clusterSource(cfg);
  let rooms: ClusterRoom[];
  if (source === 'list') {
    rooms = cfg.entities.filter((r) => r.entity.startsWith('climate.'));
  } else {
    const overrides = new Map(cfg.rooms.map((r) => [r.entity, r]));
    rooms = Object.keys(hass.states)
      .filter((id) => id.startsWith('climate.') && !isHiddenEntity(hass, id) && !cfg.exclude.includes(id))
      .filter((id) => {
        if (source === 'area') return areaOf(hass, id) === cfg.area;
        if (source === 'floor') {
          const area = areaOf(hass, id);
          return !!area && hass.areas?.[area]?.floor_id === cfg.floor;
        }
        return true;
      })
      .map((id) => overrides.get(id) ?? { entity: id });
  }

  const refs: RoomRef[] = rooms.map((room) => {
    const areaId = areaOf(hass, room.entity);
    const area = areaId ? hass.areas?.[areaId] : undefined;
    return {
      room,
      name: '',
      entityName: entityName(hass, room.entity),
      areaId,
      areaName: area?.name,
      floorId: area?.floor_id ?? undefined,
    };
  });
  // A room is named after its area when it is the only unit there.
  const perArea = new Map<string, number>();
  for (const r of refs) if (r.areaId) perArea.set(r.areaId, (perArea.get(r.areaId) ?? 0) + 1);
  for (const r of refs) {
    const ownArea = r.areaName && perArea.get(r.areaId!) === 1 ? r.areaName : undefined;
    r.name = r.room.name || ownArea || r.entityName;
  }

  if (source === 'list') return [{ id: 'list', title: null, rooms: refs }];
  if (cfg.group_by === 'area' || source !== 'auto') {
    // One area or one floor, or grouped by area: area name, then entity name.
    return [{ id: source, title: null, rooms: [...refs].sort(areaOrder) }];
  }

  const sorted = [...refs].sort((a, b) => floorOrder(hass, a.floorId, b.floorId) || areaOrder(a, b));
  const groups: RoomGroup[] = [];
  for (const r of sorted) {
    const id = r.floorId ?? '';
    let g = groups[groups.length - 1];
    if (!g || g.id !== id) {
      g = { id, title: null, rooms: [] };
      groups.push(g);
    }
    g.rooms.push(r);
  }
  if (groups.length > 1) for (const g of groups) g.title = g.id ? (hass.floors?.[g.id]?.name ?? g.id) : t(hass, 'cluster.other');
  return groups;
}
