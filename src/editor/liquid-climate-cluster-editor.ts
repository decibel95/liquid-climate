import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import {
  clusterSource,
  compactRoom,
  normalizeClusterConfig,
  roomDialConfig,
  pruneClusterConfig,
  type ClusterConfig,
  type ClusterRoom,
  type ClusterSource,
  type LiquidClimateConfig,
} from '../config';
import { migrateConfig } from '../migrate';
import { getDeviceFamily } from '../detect/family';
import { fetchRegistry } from '../detect/registry';
import { materializeConfig } from '../detect/materialize';
import { detectSensors, type RegistryInfo } from '../detect/roles';
import { clusterGroups, type RoomRef } from '../cards/cluster/grouping';
import { LiquidClimateCardEditor } from './liquid-climate-card-editor';

const PAUSE_DOMAINS = ['binary_sensor.', 'input_boolean.', 'switch.'];
type RoomField = 'name' | 'temperature_sensor' | 'pause_entity';

interface Row {
  ref: RoomRef;
  shown: boolean;
}

/**
 * Cluster editor: where the rooms come from, which show, their names and overrides, and the
 * shared write delay and look. The cluster config sits in the dial editor's `_config` slot so
 * its look and write delay sections work unchanged; `_fire` saves it the cluster way.
 */
@customElement('liquid-climate-cluster-editor')
export class LiquidClimateClusterEditor extends LiquidClimateCardEditor {
  protected override _card = 'cluster';
  @state() private _open: string | null = null;
  private _detected = new Set<string>();
  private _detecting = false;

  override setConfig(raw: Record<string, unknown>): void {
    this._config = normalizeClusterConfig(migrateConfig(raw ?? {})) as unknown as LiquidClimateConfig;
  }

  protected override willUpdate(): void {
    const cfg = this._cluster;
    if (!cfg || !this.hass || this._detecting) return;
    const ids = this._allRefs(cfg)
      .map((r) => r.room.entity)
      .filter((id) => !this._detected.has(id) && this.hass.states[id]);
    if (!ids.length) return;
    this._detecting = true;
    ids.forEach((id) => this._detected.add(id));
    // Admin-only: unique_id and original_name let detection resolve roles by meaning.
    const family = ids.flatMap((id) => getDeviceFamily(this.hass, id).entities.map((e) => e.entity_id));
    void fetchRegistry(this.hass, [...new Set(family)]).then((info) => {
      this._detecting = false;
      this._applyDetected(ids, info);
    });
  }

  /**
   * Whatever the registry resolves for outdoor, energy and cloud limit becomes a per-room
   * override, only where it differs from what the card finds by itself. The card never reads
   * the registry at runtime. A room's own setting is never replaced.
   */
  private _applyDetected(ids: string[], info: RegistryInfo) {
    const cfg = this._cluster;
    if (!cfg) return;
    const found = new Map<string, NonNullable<ClusterRoom['sensors']>>();
    for (const id of ids) {
      const room = [...cfg.entities, ...cfg.rooms].find((r) => r.entity === id) ?? { entity: id };
      const dial = roomDialConfig(cfg, room);
      const withReg = materializeConfig(dial, detectSensors(this.hass, id, info)).sensors;
      const without = materializeConfig(dial, detectSensors(this.hass, id)).sensors;
      const diff: NonNullable<ClusterRoom['sensors']> = {};
      for (const key of ['outdoor', 'energy', 'cloud_limit'] as const) {
        if (JSON.stringify(withReg[key]) !== JSON.stringify(without[key])) (diff as Record<string, unknown>)[key] = withReg[key];
      }
      if (Object.keys(diff).length) found.set(id, diff);
    }
    if (!found.size) return;
    const merge = (r: ClusterRoom): ClusterRoom => {
      const diff = found.get(r.entity);
      return diff ? { ...r, sensors: { ...diff, ...(r.sensors ?? {}) } } : r;
    };
    this._set((c) => {
      if (clusterSource(c) === 'list') return { ...c, entities: c.entities.map(merge) };
      const rooms = c.rooms.map(merge);
      for (const [entity, diff] of found) if (!rooms.some((r) => r.entity === entity)) rooms.push({ entity, sensors: diff });
      return { ...c, rooms };
    });
  }

  /** The rooms the current source shows. */
  private _allRefs(cfg: ClusterConfig): RoomRef[] {
    return this._roomRows(cfg)
      .filter((r) => r.shown)
      .map((r) => r.ref);
  }

  protected override _savedConfig(): Record<string, unknown> {
    return pruneClusterConfig(this._cluster!);
  }

  protected override _registryInfo(): undefined {
    return undefined;
  }

  /** Segmented choice where an option can be disabled. */
  protected override _seg<T>(label: string, opts: [T, string, boolean?][], current: T, pick: (v: T) => void, help?: unknown) {
    return html`
      <div class="field">
        ${help ? html`<div class="lblrow"><span class="lbl">${label}</span>${help}</div>` : html`<span class="lbl">${label}</span>`}
        <div class="seg" role="radiogroup" aria-label=${label}>
          ${opts.map(
            ([v, l, off]) => html`<button
              role="radio"
              aria-checked=${current === v ? 'true' : 'false'}
              class=${current === v ? 'on' : ''}
              ?disabled=${off}
              @click=${() => pick(v)}
            >
              ${l}
            </button>`,
          )}
        </div>
      </div>
    `;
  }

  private get _cluster(): ClusterConfig | undefined {
    return this._config as unknown as ClusterConfig | undefined;
  }

  protected override _fire(patch: Partial<LiquidClimateConfig> | ((c: LiquidClimateConfig) => LiquidClimateConfig)) {
    if (!this._config) return;
    const next = typeof patch === 'function' ? patch(this._config) : { ...this._config, ...patch };
    this._config = next;
    const config = pruneClusterConfig(next as unknown as ClusterConfig);
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }));
  }

  private _set(patch: Partial<ClusterConfig> | ((c: ClusterConfig) => ClusterConfig)) {
    this._fire((c) => {
      const cur = c as unknown as ClusterConfig;
      return (typeof patch === 'function' ? patch(cur) : { ...cur, ...patch }) as unknown as LiquidClimateConfig;
    });
  }

  // ---- Source ----------------------------------------------------------

  private _areas() {
    return Object.values(this.hass.areas ?? {}).sort((a, b) => a.name.localeCompare(b.name));
  }

  private _floors() {
    return Object.values(this.hass.floors ?? {}).sort(
      (a, b) => (a.level ?? Infinity) - (b.level ?? Infinity) || a.name.localeCompare(b.name),
    );
  }

  /** Every room the auto modes would show for this config, excluded ones included. */
  private _autoRefs(cfg: ClusterConfig): RoomRef[] {
    return clusterGroups(this.hass, { ...cfg, entities: [], exclude: [] }).flatMap((g) => g.rooms);
  }

  /** Switching source keeps the rooms and their overrides. */
  private _setSource(to: ClusterSource) {
    const cfg = this._cluster!;
    const from = clusterSource(cfg);
    if (to === from) return;
    if (to === 'list') {
      const shown = clusterGroups(this.hass, cfg).flatMap((g) => g.rooms.map((r) => r.room));
      this._set({ source: 'list', entities: shown, rooms: [], exclude: [], area: undefined, floor: undefined });
      return;
    }
    const rooms = from === 'list' ? cfg.entities.filter((r) => typeof compactRoom(r) !== 'string') : cfg.rooms;
    this._set({
      source: to,
      entities: [],
      rooms,
      exclude: from === 'list' ? [] : cfg.exclude,
      area: to === 'area' ? (cfg.area ?? this._areas()[0]?.area_id) : undefined,
      floor: to === 'floor' ? (cfg.floor ?? this._floors()[0]?.floor_id) : undefined,
    });
  }

  // ---- Rooms -----------------------------------------------------------

  private _roomRows(cfg: ClusterConfig): Row[] {
    if (clusterSource(cfg) !== 'list') {
      return this._autoRefs(cfg).map((ref) => ({ ref, shown: !cfg.exclude.includes(ref.room.entity) }));
    }
    const listed = clusterGroups(this.hass, cfg).flatMap((g) => g.rooms);
    const ids = new Set(listed.map((r) => r.room.entity));
    const rest = this._autoRefs({ ...cfg, group_by: 'area', rooms: [] }).filter((r) => !ids.has(r.room.entity));
    return [...listed.map((ref) => ({ ref, shown: true })), ...rest.map((ref) => ({ ref, shown: false }))];
  }

  private _toggle(entity: string, shown: boolean) {
    this._set((c) => {
      if (clusterSource(c) !== 'list') {
        return { ...c, exclude: shown ? [...c.exclude, entity] : c.exclude.filter((id) => id !== entity) };
      }
      return { ...c, entities: shown ? c.entities.filter((r) => r.entity !== entity) : [...c.entities, { entity }] };
    });
  }

  private _move(index: number, dir: -1 | 1) {
    this._set((c) => {
      const list = [...c.entities];
      const to = index + dir;
      if (to < 0 || to >= list.length) return c;
      [list[index], list[to]] = [list[to], list[index]];
      return { ...c, entities: list };
    });
  }

  private _patchRoom(entity: string, field: RoomField, value: string) {
    const apply = (r: ClusterRoom): ClusterRoom => {
      const next = { ...r };
      if (value) next[field] = value;
      else delete next[field];
      return next;
    };
    this._set((c) => {
      if (clusterSource(c) === 'list') return { ...c, entities: c.entities.map((r) => (r.entity === entity ? apply(r) : r)) };
      const has = c.rooms.some((r) => r.entity === entity);
      const rooms = has ? c.rooms.map((r) => (r.entity === entity ? apply(r) : r)) : [...c.rooms, apply({ entity })];
      return { ...c, rooms };
    });
  }

  private _roomRow(cfg: ClusterConfig, row: Row, index: number, list: boolean) {
    const { ref, shown } = row;
    const id = ref.room.entity;
    const detail = ref.areaName ? this._t('editor.roomDetail', { area: ref.areaName, name: ref.entityName }) : ref.entityName;
    const open = this._open === id;
    const listed = list && shown;
    const field = (key: RoomField, label: string, placeholder: string, suggest = false, help = '') => html`<label class="field">
      <span class="lbl">${label}</span>
      <input
        type="text"
        list=${suggest ? `lc-${key}` : nothing}
        .value=${ref.room[key] ?? ''}
        placeholder=${placeholder}
        @change=${(e: Event) => this._patchRoom(id, key, (e.target as HTMLInputElement).value.trim())}
      />
      ${help ? html`<span class="hint">${help}</span>` : nothing}
    </label>`;
    const panel = `lc-override-${index}`;
    return html`<div class="roomrow ${shown ? '' : 'off'}">
      <div class="row">
        ${list
          ? html`<span class="order">
              <button class="ghost small" aria-label=${this._t('editor.moveUp', { name: ref.name })} ?disabled=${!listed || index === 0} @click=${() => this._move(index, -1)}>${this._t('editor.up')}</button>
              <button class="ghost small" aria-label=${this._t('editor.moveDown', { name: ref.name })} ?disabled=${!listed || index >= cfg.entities.length - 1} @click=${() => this._move(index, 1)}>${this._t('editor.down')}</button>
            </span>`
          : nothing}
        <div class="grow">
          <span class="name">${ref.name}</span>
          <span class="hint">${detail}</span>
        </div>
        <button class="ghost small" aria-label=${this._t('editor.editRoom', { name: ref.name })} aria-controls=${panel} aria-expanded=${open ? 'true' : 'false'} ?disabled=${!shown} @click=${() => (this._open = open ? null : id)}>${this._t('editor.edit')}</button>
        <button
          class="sw ${shown ? 'on' : ''}"
          role="switch"
          aria-checked=${shown ? 'true' : 'false'}
          aria-label=${this._t('editor.showRoom', { name: ref.name })}
          @click=${() => this._toggle(id, shown)}
        >
          <span></span>
        </button>
      </div>
      ${open && shown
        ? html`<div class="override" id=${panel}>
            ${field('name', this._t('editor.name'), ref.areaName && ref.name === ref.areaName ? ref.areaName : ref.entityName)}
            ${field('temperature_sensor', this._t('editor.roomSensor'), this._t('editor.unitSensor'), true)}
            ${field('pause_entity', this._t('editor.pauseEntity'), 'binary_sensor.window', true, this._t('editor.pauseHelp'))}
          </div>`
        : nothing}
    </div>`;
  }

  protected override render(): TemplateResult {
    const cfg = this._cluster;
    if (!cfg || !this.hass) return html``;
    const source = clusterSource(cfg);
    const rows = this._roomRows(cfg);
    const areas = this._areas();
    const floors = this._floors();
    const roomSensors = Object.keys(this.hass.states).filter(
      (id) => id.startsWith('sensor.') && this.hass.states[id].attributes.device_class === 'temperature',
    );
    const pauseIds = Object.keys(this.hass.states).filter((id) => PAUSE_DOMAINS.some((d) => id.startsWith(d)));
    const note =
      source === 'list'
        ? this._t('editor.noteList')
        : source === 'auto' && cfg.group_by === 'floor'
          ? this._t('editor.noteFloor')
          : this._t('editor.noteAuto');
    return html`
      <div class="body">
        <label class="field">
          <span class="lbl">${this._t('editor.clusterTitle')}</span>
          <input
            type="text"
            .value=${cfg.title ?? ''}
            placeholder=${this._t('cluster.title')}
            @change=${(e: Event) => this._set({ title: (e.target as HTMLInputElement).value.trim() || undefined })}
          />
        </label>
        ${this._seg<ClusterSource>(
          this._t('editor.source'),
          [
            ['auto', this._t('editor.sourceAll')],
            ['floor', this._t('editor.sourceFloor'), !floors.length],
            ['area', this._t('editor.sourceArea'), !areas.length],
            ['list', this._t('editor.sourceList')],
          ],
          source,
          (v) => this._setSource(v),
          this._help('source', 'editor.source'),
        )}
        ${source === 'auto'
          ? this._seg<'floor' | 'area'>(
              this._t('editor.groupBy'),
              [
                ['floor', this._t('editor.floor')],
                ['area', this._t('editor.area')],
              ],
              cfg.group_by,
              (v) => this._set({ group_by: v }),
            )
          : nothing}
        ${source === 'floor'
          ? html`<label class="field">
              <span class="lbl">${this._t('editor.floor')}</span>
              ${floors.length
                ? html`<select @change=${(e: Event) => this._set({ floor: (e.target as HTMLSelectElement).value })}>
                    <option value="" disabled ?selected=${!floors.some((f) => f.floor_id === cfg.floor)}>${this._t('editor.chooseFloor')}</option>
                    ${floors.map((f) => html`<option value=${f.floor_id} ?selected=${f.floor_id === cfg.floor}>${f.name}</option>`)}
                  </select>`
                : html`<span class="hint">${this._t('editor.noFloors')}</span>`}
            </label>`
          : nothing}
        ${source === 'area'
          ? html`<label class="field">
              <span class="lbl">${this._t('editor.area')}</span>
              ${areas.length
                ? html`<select @change=${(e: Event) => this._set({ area: (e.target as HTMLSelectElement).value })}>
                    <option value="" disabled ?selected=${!areas.some((a) => a.area_id === cfg.area)}>${this._t('editor.chooseArea')}</option>
                    ${areas.map((a) => html`<option value=${a.area_id} ?selected=${a.area_id === cfg.area}>${a.name}</option>`)}
                  </select>`
                : html`<span class="hint">${this._t('editor.noAreas')}</span>`}
            </label>`
          : nothing}
        <div class="field">
          <div class="lblrow"><span class="lbl" id="lc-rooms-label">${this._t('editor.rooms')}</span>${this._help('rooms', 'editor.rooms')}</div>
          <div class="rooms" role="group" aria-labelledby="lc-rooms-label">
            ${rows.length
              ? rows.map((row, i) => this._roomRow(cfg, row, i, source === 'list'))
              : html`<span class="hint pad">${this._t('editor.noRooms')}</span>`}
          </div>
          <span class="hint">${note}</span>
          <datalist id="lc-temperature_sensor">${roomSensors.map((id) => html`<option value=${id}></option>`)}</datalist>
          <datalist id="lc-pause_entity">${pauseIds.map((id) => html`<option value=${id}></option>`)}</datalist>
        </div>
        ${this._writeDelay(this._config!)}
        ${this._head('look', 'editor.tabLook')}
        ${this._look(this._config!)}
        <span class="hint">${this._t('editor.yamlHint')}</span>
      </div>
      ${this._footer()}
    `;
  }

  static override styles = [
    LiquidClimateCardEditor.styles,
    css`
      .rooms {
        display: flex;
        flex-direction: column;
      }
      .roomrow.off .grow {
        opacity: 0.5;
      }
      .order {
        display: flex;
        gap: 4px;
        flex: none;
      }
      .override {
        display: grid;
        gap: 8px;
        padding: 8px 0 12px;
        border-bottom: 1px solid var(--divider-color);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'liquid-climate-cluster-editor': LiquidClimateClusterEditor;
  }
}
