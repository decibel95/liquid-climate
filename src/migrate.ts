import { CONFIG_VERSION } from './config';

type RawConfig = Record<string, any>;

/**
 * Upgrade steps, keyed by the version they upgrade FROM. Add an entry here
 * whenever the config schema changes in a way old configs cannot satisfy.
 */
const STEPS: Record<number, (c: RawConfig) => RawConfig> = {
  // 0 -> 1: configs written before versioning existed only get stamped.
  0: (c) => ({ ...c, config_version: 1 }),
};

/** The cluster's own steps, so a dial migration never touches a cluster config. */
const CLUSTER_STEPS: Record<number, (c: RawConfig) => RawConfig> = {
  0: (c) => ({ ...c, config_version: 1 }),
};

export function migrateConfig(raw: RawConfig): RawConfig {
  let cfg: RawConfig = { ...raw };
  const steps = cfg.type === 'custom:liquid-climate-cluster' ? CLUSTER_STEPS : STEPS;
  let version = typeof cfg.config_version === 'number' ? cfg.config_version : 0;
  while (version < CONFIG_VERSION) {
    const step = steps[version];
    if (!step) break;
    cfg = step(cfg);
    version = typeof cfg.config_version === 'number' ? cfg.config_version : version + 1;
  }
  return cfg;
}
