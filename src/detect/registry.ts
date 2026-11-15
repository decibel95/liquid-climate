import type { HomeAssistant } from '../types';
import type { RegistryExtra, RegistryInfo } from './roles';

interface RawEntry {
  entity_id?: string;
  unique_id?: string | null;
  original_name?: string | null;
  error?: unknown;
}

const toExtra = (e: RawEntry): RegistryExtra => ({ unique_id: e.unique_id ?? null, original_name: e.original_name ?? null });

/**
 * Fetch unique_id and original_name for the given entities over the websocket. Needs an
 * admin user. Tries the full list first; entities it returns without a unique_id are
 * re-fetched with get_entries, then one by one with `config/entity_registry/get`.
 * Resolves to what could be fetched, never rejects.
 */
export async function fetchRegistry(hass: HomeAssistant, entityIds: string[]): Promise<RegistryInfo> {
  const out: RegistryInfo = {};
  const ws = hass.callWS?.bind(hass);
  if (!ws) return out;
  const want = new Set(entityIds);
  const missing = () => entityIds.filter((id) => !out[id]?.unique_id);

  try {
    const list = await ws<RawEntry[]>({ type: 'config/entity_registry/list' });
    for (const e of Array.isArray(list) ? list : []) {
      if (e.entity_id && want.has(e.entity_id)) out[e.entity_id] = toExtra(e);
    }
  } catch {
    /* not an admin, or the command is unavailable */
  }

  if (missing().length) {
    try {
      const res = await ws<Record<string, RawEntry>>({
        type: 'config/entity_registry/get_entries',
        entity_ids: missing(),
      });
      for (const [id, e] of Object.entries(res ?? {})) if (e && !e.error) out[id] = toExtra(e);
    } catch {
      /* fall through to per-entity reads */
    }
  }

  const rest = missing();
  if (rest.length) {
    const results = await Promise.allSettled(
      rest.map((entity_id) => ws<RawEntry>({ type: 'config/entity_registry/get', entity_id })),
    );
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value) out[rest[i]] = toExtra(r.value);
    });
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v.unique_id || v.original_name));
}
