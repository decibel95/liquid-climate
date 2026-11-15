import { parseSensor, type LiquidClimateConfig, type SensorSetting } from '../config';
import type { Detection } from './roles';

const one = (list: string[]): SensorSetting | null => (list.length === 0 ? null : list.length === 1 ? list[0] : list);

/**
 * Replace every `auto` sensor role that detection resolved with the concrete entity ids.
 * Roles detection could not settle stay `auto`. Used by the editor so the card never
 * has to look at the registry at runtime.
 */
export function materializeConfig(cfg: LiquidClimateConfig, d: Detection): LiquidClimateConfig {
  const found: Record<keyof LiquidClimateConfig['sensors'], SensorSetting | null> = {
    humidity: d.humidity?.entity_id ?? null,
    outdoor: d.outdoor?.entity_id ?? null,
    cloud_limit: d.cloudLimit?.entity_id ?? null,
    energy: one(d.energy.filter((e) => e.period === 'day' && e.kind).map((e) => e.entity_id)),
    health: one(d.health.map((h) => h.entity_id)),
  };
  const sensors = { ...cfg.sensors };
  for (const key of Object.keys(found) as (keyof typeof found)[]) {
    const f = found[key];
    if (f === null || parseSensor(sensors[key]).mode !== 'auto') continue;
    // A named auto keeps its name on the concrete id (the first one, for a list).
    const name = parseSensor(sensors[key]).name;
    if (!name) sensors[key] = f;
    else if (Array.isArray(f)) sensors[key] = [{ entity: f[0] as string, name }, ...f.slice(1)];
    else sensors[key] = { entity: f as string, name };
  }
  return { ...cfg, sensors };
}
