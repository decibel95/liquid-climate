import { LitElement, css, html, nothing, type CSSResultGroup, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import {
  cleanActions,
  defaultConfig,
  hasMenu,
  menuDefault,
  normalizeConfig,
  parseSensor,
  pruneDefaults,
  withSensorEntity,
  withSensorName,
  type LiquidClimateConfig,
  type SensorSetting,
} from '../config';
import { migrateConfig } from '../migrate';
import { windowOf } from '../detect/resolve';
import { detectSensors, suggestRoomSensors, type Detection, type RegistryInfo, type SensorRef } from '../detect/roles';
import { fetchRegistry } from '../detect/registry';
import { getDeviceFamily } from '../detect/family';
import { materializeConfig } from '../detect/materialize';
import { Memo } from '../detect/cache';
import { getCapabilities } from '../cards/dial/capabilities';
import { MODES, modeLabel } from '../ui/modes';
import { formatState } from '../ui/status';
import { buildDiagnostics, copyText, diagnosticsText } from '../diagnostics';
import { editorStyles, helpLink, lookFields } from '@decibel95/liquid-core';
import { DOCS_URL } from '../const';
import { currentSensor, domainOf, isSupportedEntity, roleApplies } from '../domain';
import { num, t, type Vars } from '../i18n';
import type { HomeAssistant } from '../types';

type Tab = 'setup' | 'sensors' | 'controls' | 'look';
const TABS: [Tab, string][] = [
  ['setup', 'editor.tabSetup'],
  ['sensors', 'editor.tabSensors'],
  ['controls', 'editor.tabControls'],
  ['look', 'editor.tabLook'],
];

/** Core's editor helper keys and the Liquid Climate key with the same text (spelled out so the key check in test/i18n.test.ts sees them). */
const CORE_EDITOR_KEYS: Record<string, string> = {
  'core.editor.help': 'editor.help',
  'core.editor.glass': 'editor.glass',
  'core.editor.glassAuto': 'editor.glassAuto',
  'core.editor.glassDark': 'editor.glassDark',
  'core.editor.glassLight': 'editor.glassLight',
  'core.editor.tint': 'editor.tint',
  'core.editor.blur': 'editor.blur',
  'core.editor.motion': 'editor.motion',
  'core.editor.motionRich': 'editor.motionRich',
  'core.editor.motionSubtle': 'editor.motionSubtle',
  'core.editor.motionMinimal': 'editor.motionMinimal',
  'core.editor.reducedMotion': 'editor.reducedMotion',
};

/** Entity domains each role can point at. */
const SENSOR_DOMAINS: Record<keyof LiquidClimateConfig['sensors'], string[]> = {
  humidity: ['sensor.'],
  outdoor: ['sensor.'],
  energy: ['sensor.'],
  cloud_limit: ['sensor.'],
  health: ['binary_sensor.'],
  battery: ['sensor.', 'binary_sensor.'],
  valve: ['sensor.', 'valve.'],
  window: ['binary_sensor.'],
};

interface SensorRow {
  key: keyof LiquidClimateConfig['sensors'];
  label: string;
  source: string;
  found: boolean;
  /** Entity ids found by detection for this role. */
  ids: string[];
  value: string;
}

@customElement('liquid-climate-card-editor')
export class LiquidClimateCardEditor extends LitElement {
  @property({ attribute: false }) hass!: HomeAssistant;
  @state() protected _config?: LiquidClimateConfig;
  @state() private _tab: Tab = 'setup';
  @state() private _changing: string | null = null;
  @state() private _copy: 'idle' | 'copied' | 'failed' = 'idle';
  private _copyTimer?: ReturnType<typeof setTimeout>;
  /** Which card this editor belongs to: the docs page and the prefix of its anchors. */
  protected _card = 'dial';
  /** Index of the status row whose Add action text was not a script or automation id. */
  @state() private _badAction: number | null = null;
  @state() private _registry: { entity: string; info: RegistryInfo } | null = null;
  private _loading: string | null = null;
  private _memo = new Memo<Detection>();

  /** A string of the editor in the user's language. */
  protected _t(key: string, vars?: Vars): string {
    return t(this.hass, key, vars);
  }

  /** The translate function the core editor helpers take: core's `core.editor.X` keys are this editor's `editor.X`. */
  private _tCore = (key: string, vars?: Vars): string => this._t(CORE_EDITOR_KEYS[key] ?? key, vars);

  setConfig(raw: Record<string, unknown>): void {
    this._config = normalizeConfig(migrateConfig(raw ?? {}));
  }

  protected override willUpdate(): void {
    const entity = this._config?.entity;
    if (!entity || !this.hass || this._loading === entity || this._registry?.entity === entity) return;
    if (!this.hass.states[entity]) return;
    this._loading = entity;
    // Admin-only: unique_id and original_name let detection resolve roles by meaning.
    const ids = getDeviceFamily(this.hass, entity).entities.map((e) => e.entity_id);
    void fetchRegistry(this.hass, ids).then((info) => {
      this._registry = { entity, info };
      this._memo.clear();
    });
  }

  protected _fire(patch: Partial<LiquidClimateConfig> | ((c: LiquidClimateConfig) => LiquidClimateConfig)) {
    if (!this._config) return;
    let next = typeof patch === 'function' ? patch(this._config) : { ...this._config, ...patch };
    // Whatever the registry resolved becomes concrete, so the card never needs the registry.
    const found = next.entity === this._config.entity ? this._detection() : null;
    if (found?.usedRegistry) next = materializeConfig(next, found);
    this._config = next;
    const config = pruneDefaults(next, this._defaults(next.entity));
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }));
  }

  /** What the card fills in by itself; equal values are left out of the saved config. */
  protected _defaults(entity: string): Record<string, unknown> {
    return defaultConfig(entity) as unknown as Record<string, unknown>;
  }

  /** Memoised per entity, registry and hass registries; not recomputed on every render. */
  private _detection(): Detection | null {
    if (!this._config || !this.hass || !this.hass.states[this._config.entity]) return null;
    const entity = this._config.entity;
    const info = this._registry?.entity === entity ? this._registry.info : undefined;
    const key = [entity, this.hass.entities, this.hass.devices, info, Object.keys(this.hass.states).length];
    return this._memo.get(key, () => detectSensors(this.hass, entity, info));
  }

  protected override render(): TemplateResult {
    const cfg = this._config;
    if (!cfg || !this.hass) return html``;
    return html`
      <div class="tabrow">
      <div class="tabs" role="tablist" aria-label=${this._t('editor.sections')}>
        ${TABS.map(
          ([id, key]) => html`<button
            role="tab"
            aria-selected=${this._tab === id ? 'true' : 'false'}
            class=${this._tab === id ? 'on' : ''}
            @click=${() => (this._tab = id)}
          >
            ${this._t(key)}
          </button>`,
        )}
      </div>
      ${this._help(this._tab === 'setup' ? 'entity' : this._tab, TABS.find(([id]) => id === this._tab)![1])}
      </div>
      <div class="body">
        ${this._tab === 'setup' ? this._setup(cfg) : nothing} ${this._tab === 'sensors' ? this._sensors(cfg) : nothing}
        ${this._tab === 'controls' ? this._controls(cfg) : nothing} ${this._tab === 'look' ? this._look(cfg) : nothing}
      </div>
      ${this._footer()}
    `;
  }

  protected _footer() {
    const key = this._copy === 'copied' ? 'editor.copied' : this._copy === 'failed' ? 'editor.diagnosticsFailed' : 'editor.copyDiagnostics';
    return html`<div class="foot">
      <button class="ghost" @click=${this._copyDiagnostics}>${this._t(key)}</button>
      <span class="sr" role="status" aria-live="polite">${this._copy === 'idle' ? '' : this._t(key)}</span>
    </div>`;
  }

  /** A small (?) link to the docs section `<card>-<slug>`; the label is the section's name. */
  protected _help(slug: string, labelKey: string) {
    return helpLink(DOCS_URL, this._card, slug, this._t(labelKey), this._tCore);
  }

  /** Section heading with its help link, for the editors without tabs. */
  protected _head(slug: string, labelKey: string) {
    return html`<div class="lblrow"><span class="lbl">${this._t(labelKey)}</span>${this._help(slug, labelKey)}</div>`;
  }

  /** The config as the editor saves it. */
  protected _savedConfig(): Record<string, unknown> {
    const cfg = this._config!;
    return pruneDefaults(cfg, this._defaults(cfg.entity)) as unknown as Record<string, unknown>;
  }

  /** The registry details the editor has fetched, if any, to resolve roles the way the editor does. */
  protected _registryInfo(): RegistryInfo | undefined {
    return this._registry?.entity === this._config?.entity ? this._registry?.info : undefined;
  }

  private _copyDiagnostics = async () => {
    if (!this._config || !this.hass) return;
    let ok = false;
    try {
      const config = this._savedConfig();
      const text = diagnosticsText(buildDiagnostics({ cardType: this._config.type, config, hass: this.hass, registry: this._registryInfo() }));
      ok = await copyText(text);
    } catch {
      ok = false;
    }
    if (!this.isConnected) return;
    this._copy = ok ? 'copied' : 'failed';
    clearTimeout(this._copyTimer);
    this._copyTimer = setTimeout(() => (this._copy = 'idle'), 2000);
  };

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this._copyTimer);
    this._copy = 'idle';
  }

  // ---- Setup -----------------------------------------------------------

  protected _setup(cfg: LiquidClimateConfig) {
    const climates = Object.keys(this.hass.states).filter((id) => isSupportedEntity(id));
    const detection = this._detection();
    const stateObj = this.hass.states[cfg.entity];
    const area = stateObj?.attributes.friendly_name ?? '';
    const unit = detection?.unitTemperature;
    const suggestions = stateObj ? suggestRoomSensors(this.hass, cfg.entity) : [];
    // Whole degrees and their room sensor suggestion are about climate units.
    const climate = domainOf(cfg.entity) === 'climate';
    const useSuggestion = climate && !cfg.temperature_sensor && unit?.wholeDegrees ? suggestions[0] : undefined;
    const cloud = stateObj ? this.hass.entities[cfg.entity]?.platform === 'daikin_onecta' : false;
    // The override of the figure the card shows: room temperature, water temperature or humidity.
    const figure = currentSensor(domainOf(cfg.entity));
    const roomSensors = Object.keys(this.hass.states).filter(
      (id) => id.startsWith('sensor.') && this.hass.states[id].attributes.device_class === figure.deviceClass,
    );

    return html`
      <label class="field">
        <span class="lbl">${this._t('editor.entity')}</span>
        <select @change=${(e: Event) => this._fire({ entity: (e.target as HTMLSelectElement).value })}>
          ${climates.map(
            (id) => html`<option value=${id} ?selected=${id === cfg.entity}>
              ${this.hass.states[id].attributes.friendly_name ?? id} (${id})
            </option>`,
          )}
        </select>
      </label>
      <label class="field">
        <span class="lbl">${this._t('editor.name')}</span>
        <input
          type="text"
          .value=${cfg.name ?? ''}
          placeholder=${area}
          @change=${(e: Event) => this._fire({ name: (e.target as HTMLInputElement).value || undefined })}
        />
        <span class="hint">${this._t('editor.nameHint')}</span>
      </label>
      <label class="field">
        <span class="lbl">${this._t(figure.label)}</span>
        <input
          type="text"
          list="lc-room-sensors"
          .value=${cfg.temperature_sensor ?? ''}
          placeholder=${this._t('editor.unitSensor')}
          @change=${(e: Event) => this._fire({ temperature_sensor: (e.target as HTMLInputElement).value.trim() || undefined })}
        />
        <datalist id="lc-room-sensors">${roomSensors.map((id) => html`<option value=${id}></option>`)}</datalist>
      </label>
      ${useSuggestion
        ? html`<div class="note warn">
            <span>
              ${this._t('editor.wholeUse', {
                sensor: this.hass.states[useSuggestion].attributes.friendly_name ?? useSuggestion,
                value: formatState(this.hass, this.hass.states[useSuggestion]),
              })}
            </span>
            <button class="solid" @click=${() => this._fire({ temperature_sensor: useSuggestion })}>${this._t('editor.useIt')}</button>
          </div>`
        : climate && !cfg.temperature_sensor && unit?.wholeDegrees
          ? html`<div class="note warn">
              <span>${this._t('editor.wholePick')}</span>
            </div>`
          : nothing}
      ${cloud
        ? html`<div class="note info">
            <span>
              ${this._t('editor.cloudNote', {
                delay: cfg.write_delay === 0 ? this._t('editor.immediately') : this._t('editor.seconds', { n: num(this.hass, cfg.write_delay, Number.isInteger(cfg.write_delay) ? 0 : 1) }),
              })}
            </span>
          </div>`
        : nothing}
    `;
  }

  // ---- Sensors ---------------------------------------------------------

  private _rows(cfg: LiquidClimateConfig, d: Detection): SensorRow[] {
    const st = (id?: string | null) => (id && this.hass.states[id] ? this.hass.states[id].state : '');
    const val = (id?: string | null) => (id && st(id) ? formatState(this.hass, this.hass.states[id]).trim() : '');
    const today = d.energy.filter((e) => e.period === 'day');
    const bad = d.health.filter((h) => {
      const s = st(h.entity_id);
      return h.type === 'problem' ? s === 'on' : s !== '' && !['00-00', '0', '00', 'none', 'ok', 'unknown', 'unavailable'].includes(s.toLowerCase());
    });
    return [
      { key: 'humidity', label: this._t('editor.sensorHumidity'), source: d.humidity?.source ?? '', found: !!d.humidity, ids: d.humidity ? [d.humidity.entity_id] : [], value: val(d.humidity?.entity_id) },
      { key: 'outdoor', label: this._t('editor.sensorOutdoor'), source: d.outdoor?.source ?? '', found: !!d.outdoor, ids: d.outdoor ? [d.outdoor.entity_id] : [], value: val(d.outdoor?.entity_id) },
      {
        key: 'energy',
        label: this._t('editor.sensorEnergy'),
        source: today.length ? this._t('editor.energySource', { sources: [...new Set(today.map((e) => e.source))].join(', '), n: d.energy.length }) : '',
        found: today.length > 0,
        ids: today.map((e) => e.entity_id),
        value: today.length ? `${num(this.hass, today.reduce((a, e) => a + (Number(st(e.entity_id)) || 0), 0), 1)} kWh` : '',
      },
      { key: 'cloud_limit', label: this._t('editor.sensorCloud'), source: d.cloudLimit?.source ?? '', found: !!d.cloudLimit, ids: d.cloudLimit ? [d.cloudLimit.entity_id] : [], value: val(d.cloudLimit?.entity_id) },
      this._row('battery', 'editor.sensorBattery', d.battery ?? d.batteryLow, [d.battery, d.batteryLow]),
      this._row('valve', 'editor.sensorValve', d.valve, [d.valve]),
      this._row('window', 'editor.sensorWindow', windowOf(d, cfg.sensors.valve), [windowOf(d, cfg.sensors.valve)]),
      {
        key: 'health',
        label: this._t('editor.sensorHealth'),
        source: d.health.length ? this._t('editor.healthSource', { sources: [...new Set(d.health.map((h) => h.source))].join(', '), n: d.health.length }) : '',
        found: d.health.length > 0,
        ids: d.health.map((h) => h.entity_id),
        value: d.health.length ? this._t(bad.length ? 'editor.problem' : 'editor.allOk') : '',
      },
    ];
  }

  /** A single-sensor row; `all` are the detected ids (battery has a level and a low flag). */
  private _row(key: SensorRow['key'], label: string, shown: SensorRef | null, all: (SensorRef | null)[]): SensorRow {
    const ids = all.filter((r): r is SensorRef => !!r).map((r) => r.entity_id);
    const id = shown?.entity_id;
    return { key, label: this._t(label), source: shown?.source ?? '', found: !!shown, ids, value: id && this.hass.states[id] ? formatState(this.hass, this.hass.states[id]).trim() : '' };
  }

  private _sensors(cfg: LiquidClimateConfig) {
    const d = this._detection();
    if (!d) return html`<p class="hint">${this._t('editor.pickFirst')}</p>`;
    // Battery, valve and window are for devices that have them: hidden until found or set.
    const optional = ['battery', 'valve', 'window'];
    // Only the badge and the cluster read the window contact; the dial and tile editors leave it out.
    const readsWindow = this._card === 'badge' || this._card === 'cluster';
    const rows = this._rows(cfg, d)
      .filter((r) => r.key !== 'window' || readsWindow)
      // A role that means nothing for this domain shows only when it was set explicitly.
      .filter((r) => roleApplies(domainOf(cfg.entity), r.key) || cfg.sensors[r.key] !== 'auto')
      .filter((r) => !optional.includes(r.key) || r.found || cfg.sensors[r.key] !== 'auto');
    const unit = d.unitTemperature;
    // display: contents keeps the body's spacing while every part sits inside an element.
    return html`<div class="group">
      ${d.usedRegistry ? nothing : html`<div class="note warn"><span>${this._t('editor.limited')}</span></div>`}
      <span class="hint">${this._t('editor.foundOn', { name: this.hass.states[cfg.entity].attributes.friendly_name ?? cfg.entity, n: Math.max(0, d.deviceCount - 1) })}</span>
      ${rows.map((r) => {
        const setting = cfg.sensors[r.key];
        const on = setting !== false;
        const parsed = parseSensor(setting);
        const configured = parsed.mode === 'set' ? parsed.ids : [];
        const override = configured.length ? configured.join(', ') : null;
        return html`<div class="group">
          <div class="row">
            <div class="grow">
              <span class="name">${parsed.name ?? r.label}</span>
              <span class="hint">${override ? this._t('editor.using', { ids: override }) : r.found ? r.source : this._t('editor.notFoundPick')}</span>
            </div>
            <span class="val">${configured.length === 1 ? this._valueOf(configured[0]) : r.value}</span>
            <button class="ghost small" @click=${() => (this._changing = this._changing === r.key ? null : r.key)}>${this._t('editor.change')}</button>
            <button
              class="sw ${on ? 'on' : ''}"
              role="switch"
              aria-checked=${on ? 'true' : 'false'}
              aria-label=${this._t('editor.showSensor', { label: r.label })}
              @click=${() => this._setSensor(r.key, on ? false : 'auto')}
            >
              <span></span>
            </button>
          </div>
          ${this._changing === r.key
            ? html`<div class="change">
                <input
                  type="text"
                  list="lc-ids-${r.key}"
                  .value=${configured.length === 1 ? configured[0] : ''}
                  placeholder=${this._t('editor.entityPlaceholder')}
                  aria-label=${this._t('editor.sensorEntity', { label: r.label })}
                  @change=${(e: Event) => {
                    const v = (e.target as HTMLInputElement).value.trim();
                    this._setSensor(r.key, withSensorEntity(cfg.sensors[r.key], v));
                  }}
                />
                <input
                  type="text"
                  .value=${parsed.name ?? ''}
                  placeholder=${r.label}
                  aria-label=${this._t('editor.sensorName', { label: r.label })}
                  ?disabled=${!on}
                  @change=${(e: Event) => this._setSensor(r.key, withSensorName(cfg.sensors[r.key], (e.target as HTMLInputElement).value.trim()))}
                />
                <datalist id="lc-ids-${r.key}">
                  ${Object.keys(this.hass.states)
                    .filter((id) => SENSOR_DOMAINS[r.key].some((domain) => id.startsWith(domain)))
                    .map((id) => html`<option value=${id}></option>`)}
                </datalist>
              </div>`
            : nothing}
        </div>`;
      })}
      ${unit
        ? html`<div class="row">
            <div class="grow">
              <span class="name">${this._t('editor.unitTemperature')}</span>
              <span class="hint">${unit.wholeDegrees ? this._t('editor.wholeOnly', { source: unit.source }) : unit.source}</span>
            </div>
            <span class="val">${this._valueOf(unit.entity_id)}</span>
          </div>`
        : nothing}
      <span class="hint pad">${this._t('editor.notShown')}</span>
    </div>`;
  }

  private _valueOf(id: string): string {
    const s = this.hass.states[id];
    return s ? formatState(this.hass, s).trim() : this._t('common.notFound');
  }

  private _setSensor(key: keyof LiquidClimateConfig['sensors'], value: SensorSetting) {
    this._fire((c) => ({ ...c, sensors: { ...c.sensors, [key]: value } }));
  }

  // ---- Controls --------------------------------------------------------

  private _controls(cfg: LiquidClimateConfig) {
    const stateObj = this.hass.states[cfg.entity];
    // Mode, fan, swing and preset choices are climate options: a water heater or humidifier shows what it supports by itself.
    const climate = domainOf(cfg.entity) === 'climate';
    const caps = stateObj ? getCapabilities(stateObj, { ...cfg, controls: { ...cfg.controls, modes: MODES.map((m) => m.id) } }, this.hass) : null;
    const modeIds = ['off', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only'].filter((m) => !caps || caps.modes.includes(m));
    const toggles: [keyof LiquidClimateConfig['controls'], string, string][] = [
      ['fan', this._t('editor.fanRing'), caps?.fanModes.join(', ') ?? ''],
      ['swing', this._t('editor.swingVertical'), caps?.swingModes.join(', ') ?? ''],
      ['swing_horizontal', this._t('editor.swingHorizontal'), caps?.swingHModes.join(', ') ?? ''],
      ['presets', this._t('editor.presets'), caps?.presetModes.join(', ') ?? ''],
    ];
    // display: contents (.group) keeps the body's spacing while the climate part sits inside one element.
    // The History switch applies to every domain, so it sits after the climate-only part.
    // The wrapper keeps the template from starting with a child part (happy-dom shifts the bindings of such a template).
    return html`<div class="group">
      ${climate
        ? html`<div class="group"><div class="field">
        <span class="lbl">${this._t('editor.modesOnCard')}</span>
        <div class="chiprow">
          ${modeIds.map((id) => {
            const on = cfg.controls.modes.includes(id);
            return html`<button
              class="pill ${on ? 'on' : ''}"
              aria-pressed=${on ? 'true' : 'false'}
              @click=${() =>
                this._fire((c) => ({
                  ...c,
                  controls: {
                    ...c.controls,
                    modes: on ? c.controls.modes.filter((m) => m !== id) : modeIds.filter((m) => m === id || c.controls.modes.includes(m)),
                  },
                }))}
            >
              ${modeLabel(this.hass, id)}${id === 'auto' ? ` ${this._t('editor.autoSuffix')}` : ''}
            </button>`;
          })}
        </div>
        <span class="hint">${this._t('editor.modesHint')}</span>
      </div>
      ${toggles.map(([key, label, detail]) => {
        const supported = !caps || this._supports(caps, key);
        const on = cfg.controls[key] as boolean;
        return html`<div class="row">
          <span class="grow name">${label}</span>
          <span class="hint">${supported ? detail : this._t('editor.notSupported')}</span>
          <button
            class="sw ${on && supported ? 'on' : ''}"
            role="switch"
            aria-checked=${on ? 'true' : 'false'}
            aria-label=${label}
            ?disabled=${!supported}
            @click=${() => this._fire((c) => ({ ...c, controls: { ...c.controls, [key]: !on } }))}
          >
            <span></span>
          </button>
        </div>`;
      })}</div>`
        : nothing}
      ${this._historySwitch(cfg)}
      ${this._writeDelay(cfg)}
      <div class="field">
        <div class="lblrow"><span class="lbl">${this._t('editor.statusRows')}</span>${this._help('status-rows', 'editor.statusRows')}</div>
        ${repeat(
          cfg.status_entities.map((s, i) => [s, i] as const),
          ([, i]) => i,
          ([s, i]) => html`<div class="statusrow">
            <input
              type="text"
              id=${`lc-status-${i}`}
              list="lc-status-ids"
              .value=${s.entity}
              aria-label=${this._t('editor.statusEntity')}
              aria-invalid=${s.entity && !this.hass.states[s.entity] ? 'true' : 'false'}
              aria-describedby=${s.entity && !this.hass.states[s.entity] ? `lc-status-${i}-warn` : nothing}
              @change=${(e: Event) => this._setStatus(i, { entity: (e.target as HTMLInputElement).value.trim() })}
            />
            <input
              type="text"
              .value=${s.name ?? ''}
              placeholder=${this._t('editor.name')}
              aria-label=${this._t('editor.statusName')}
              @change=${(e: Event) => this._setStatus(i, { name: (e.target as HTMLInputElement).value || undefined })}
            />
            <input
              type="text"
              .value=${s.icon ?? ''}
              placeholder="mdi:icon"
              aria-label=${this._t('editor.statusIcon')}
              @change=${(e: Event) => this._setStatus(i, { icon: (e.target as HTMLInputElement).value.trim() || undefined })}
            />
            <button class="ghost small" aria-label=${this._t('editor.removeRow')} @click=${() => this._removeRow(i)}>${this._t('editor.remove')}</button>
            ${s.entity && !this.hass.states[s.entity]
              ? html`<span class="hint warn" id=${`lc-status-${i}-warn`}>
                  <ha-icon icon="mdi:alert-outline" aria-hidden="true"></ha-icon>${this._t('editor.missingEntity')}
                </span>`
              : nothing}
            ${this._statusActions(s, i)}
          </div>`,
        )}
        <datalist id="lc-action-ids">${Object.keys(this.hass.states)
          .filter((id) => /^(script|automation)\./.test(id))
          .map((id) => html`<option value=${id}></option>`)}</datalist>
        <datalist id="lc-status-ids">${Object.keys(this.hass.states).map((id) => html`<option value=${id}></option>`)}</datalist>
        <button class="ghost dashed" @click=${() => this._fire((c) => ({ ...c, status_entities: [...c.status_entities, { entity: '' }] }))}>${this._t('editor.addEntity')}</button>
      </div>
    </div>`;
  }

  /** Segmented single choice, as a radio group. */
  protected _seg<T>(label: string, opts: [T, string][], current: T, pick: (v: T) => void, help?: unknown) {
    return html`
      <div class="field">
        ${help ? html`<div class="lblrow"><span class="lbl">${label}</span>${help}</div>` : html`<span class="lbl">${label}</span>`}
        <div class="seg" role="radiogroup" aria-label=${label}>
          ${opts.map(
            ([v, l]) => html`<button role="radio" aria-checked=${current === v ? 'true' : 'false'} class=${current === v ? 'on' : ''} @click=${() => pick(v)}>
              ${l}
            </button>`,
          )}
        </div>
      </div>
    `;
  }

  /** The History button switch, the same in every editor: on is the default and is not saved. */
  protected _historySwitch(cfg: LiquidClimateConfig, hint = 'editor.historyHint') {
    return html`<div class="row">
      <span class="grow name">${this._t('editor.historyButton')}</span>
      <span class="hint">${this._t(hint)}</span>
      <button
        class="sw ${cfg.show_history ? 'on' : ''}"
        role="switch"
        aria-checked=${cfg.show_history ? 'true' : 'false'}
        aria-label=${this._t('editor.historyButton')}
        @click=${() => this._fire((c) => ({ ...c, show_history: !c.show_history }))}
      >
        <span></span>
      </button>
    </div>`;
  }

  /** The write delay and the hold after sending, in one wrapper that adds no layout. */
  protected _writeDelay(cfg: LiquidClimateConfig) {
    return html`<div class="group">${this._delaySeg(cfg)}${this._writeHold(cfg)}</div>`;
  }

  private _delaySeg(cfg: LiquidClimateConfig) {
    return this._seg<number>(
      this._t('editor.writeDelay'),
      [
        [0, this._t('editor.instant')],
        [1, this._t('editor.seconds', { n: num(this.hass, 1, 0) })],
        [1.5, this._t('editor.seconds', { n: num(this.hass, 1.5, 1) })],
        [3, this._t('editor.seconds', { n: num(this.hass, 3, 0) })],
      ],
      cfg.write_delay,
      (v) => this._fire({ write_delay: v }),
      this._help('write-delay', 'editor.writeDelay'),
    );
  }

  /** How long a sent value is shown as is while a slow device has not reported it back. */
  protected _writeHold(cfg: LiquidClimateConfig) {
    return this._seg<number>(
      this._t('editor.writeHold'),
      [10, 30, 60].map((n): [number, string] => [n, this._t('editor.seconds', { n: num(this.hass, n, 0) })]),
      cfg.write_hold,
      (v) => this._fire({ write_hold: v }),
      this._help('write-hold', 'editor.writeHold'),
    );
  }

  private _supports(caps: ReturnType<typeof getCapabilities>, key: keyof LiquidClimateConfig['controls']): boolean {
    // Capabilities are computed with every control enabled by config, so
    // an empty list means the entity itself lacks support.
    if (key === 'fan') return caps.fanModes.length > 0;
    if (key === 'swing') return caps.swingModes.length > 0;
    if (key === 'swing_horizontal') return caps.swingHModes.length > 0;
    if (key === 'presets') return caps.presetModes.length > 0;
    return true;
  }

  /** Rows are keyed by index, so a removed row leaves stale Add action text behind: clear it. */
  private _removeRow(i: number) {
    this._badAction = null;
    this._fire((c) => ({ ...c, status_entities: c.status_entities.filter((_, j) => j !== i) }));
    void this.updateComplete.then(() => {
      this.shadowRoot?.querySelectorAll<HTMLInputElement>('.actionsbox input').forEach((el) => (el.value = ''));
    });
  }

  /** The Actions list and the Show menu toggle of one status row. */
  private _statusActions(s: { entity: string; actions?: string[]; menu?: boolean }, i: number) {
    const actions = s.actions ?? [];
    const menuOn = hasMenu(s as Parameters<typeof hasMenu>[0]);
    const inputId = `lc-add-action-${i}`;
    const name = (s as { name?: string }).name || s.entity || `${i + 1}`;
    const add = (e: Event) => {
      const input = (e.currentTarget as HTMLElement).parentElement!.querySelector('input') as HTMLInputElement;
      const text = input.value.trim();
      if (!text) {
        this._badAction = null;
        return;
      }
      const next = cleanActions([...actions, text]);
      // Not a script or automation id: keep the text so it can be fixed, and say why.
      if (!cleanActions([text]).length) {
        this._badAction = i;
        return;
      }
      this._badAction = null;
      input.value = '';
      if (next.length !== actions.length) this._setStatus(i, { actions: next });
    };
    const bad = this._badAction === i;
    return html`<div class="actionsbox" role="group" aria-label=${`${this._t('editor.actions')}: ${name}`}>
      <span class="lbl">${this._t('editor.actions')}</span>
      ${actions.map(
        (id) => html`<div class="actionrow">
          <span class="actionid" id=${`lc-action-${i}-${id}`}>${id}</span>
          <button
            class="ghost small"
            aria-label=${this._t('editor.removeAction', { id })}
            aria-describedby=${this.hass.states[id] ? nothing : `lc-action-${i}-${id}-warn`}
            @click=${() => {
              this._badAction = null;
              this._setStatus(i, { actions: actions.filter((a) => a !== id) });
            }}
          >
            ${this._t('editor.remove')}
          </button>
          ${this.hass.states[id]
            ? nothing
            : html`<span class="hint warn" id=${`lc-action-${i}-${id}-warn`}>
                <ha-icon icon="mdi:alert-outline" aria-hidden="true"></ha-icon>${this._t('editor.missingAction')}
              </span>`}
        </div>`,
      )}
      <label class="vh" for=${inputId}>${this._t('editor.addAction')}</label>
      <div class="actionrow">
        <input
          id=${inputId}
          type="text"
          list="lc-action-ids"
          placeholder=${this._t('editor.actionPlaceholder')}
          aria-invalid=${bad ? 'true' : 'false'}
          aria-describedby=${bad ? `${inputId}-hint` : nothing}
          @input=${() => {
            if (this._badAction === i) this._badAction = null;
          }}
          @change=${add}
        />
        <button class="ghost small" @click=${add}>${this._t('editor.addAction')}</button>
      </div>
      ${bad ? html`<span class="hint" id="${inputId}-hint" role="alert">${this._t('editor.invalidAction')}</span>` : nothing}
      <div class="row hint-row">
        <span>${this._t('editor.showMenu')}</span>
        <button
          class="sw ${menuOn ? 'on' : ''}"
          role="switch"
          aria-checked=${menuOn ? 'true' : 'false'}
          aria-label=${this._t('editor.showMenu')}
          @click=${() => this._setStatus(i, { menu: !menuOn })}
        >
          <span></span>
        </button>
      </div>
    </div>`;
  }

  private _setStatus(i: number, patch: { entity?: string; name?: string | undefined; icon?: string | undefined; actions?: string[]; menu?: boolean }) {
    this._fire((c) => ({
      ...c,
      status_entities: c.status_entities.map((s, j) => {
        if (j !== i) return s;
        const next: Record<string, unknown> & { entity: string; actions?: string[]; menu?: boolean } = { ...s, ...patch };
        // Nothing unpicked is written: no empty name or icon, no empty actions list.
        for (const key of ['name', 'icon'] as const) if (!next[key]) delete next[key];
        if (!next.actions?.length) delete next.actions;
        // The menu flag is only written when it differs from what the row would do by itself.
        // Only a change of the flag or of the entity can make it redundant: a deliberate false stays when the last action goes.
        if (('menu' in patch || 'entity' in patch) && next.menu === menuDefault(next)) delete next.menu;
        return next;
      }),
    }));
  }

  // ---- Look ------------------------------------------------------------

  protected _look(cfg: LiquidClimateConfig) {
    return lookFields(cfg.look, this._tCore, (patch) => this._fire((c) => ({ ...c, look: { ...c.look, ...patch } })), { tint: true });
  }

  /** What editorStyles (core) does not have: notes, rows, buttons, status rows and the footer. */
  static override styles: CSSResultGroup = [
    editorStyles,
    css`
      .hint.pad {
        padding-top: 8px;
      }
      .note {
        display: flex;
        align-items: center;
        gap: 12px;
        border-radius: 12px;
        padding: 10px 12px;
        font-size: 13px;
        line-height: 1.45;
      }
      .note.warn {
        background: rgba(255, 176, 103, 0.12);
        border: 1px solid rgba(255, 176, 103, 0.4);
      }
      .note.info {
        background: rgba(90, 176, 255, 0.1);
        border: 1px solid rgba(90, 176, 255, 0.35);
      }
      .note span {
        flex: 1;
      }
      .row {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 0;
        border-bottom: 1px solid var(--divider-color);
      }
      .grow {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .name {
        font-size: 14px;
        font-weight: 500;
      }
      .val {
        font-size: 13px;
        color: var(--secondary-text-color);
        white-space: nowrap;
      }
      .change {
        padding: 6px 0;
      }
      .group {
        display: contents;
      }
      .change {
        display: grid;
        grid-template-columns: 1.4fr 1fr;
        gap: 6px;
      }
      .change input {
        width: 100%;
      }
      button.ghost,
      button.solid,
      button.pill {
        font: inherit;
        font-size: 13px;
        cursor: pointer;
        color: var(--primary-text-color);
        border-radius: 18px;
        border: 1px solid var(--divider-color);
        background: transparent;
        padding: 0 14px;
        min-height: 34px;
      }
      button.small {
        min-height: 30px;
        padding: 0 10px;
        font-size: 12px;
      }
      button.dashed {
        align-self: flex-start;
        border-style: dashed;
      }
      button.solid {
        background: #ffb067;
        border-color: #ffb067;
        color: #1b1206;
        font-weight: 600;
      }
      button.pill.on {
        background: var(--primary-color);
        border-color: var(--primary-color);
        color: var(--text-primary-color, #fff);
      }
      .chiprow {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .statusrow {
        display: grid;
        grid-template-columns: 1.4fr 1fr 1fr auto;
        gap: 6px;
      }
      .vh {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
      .actionsbox {
        grid-column: 1 / -1;
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 0 0 8px;
      }
      .actionrow {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 6px;
        align-items: center;
      }
      .hint.warn {
        grid-column: 1 / -1;
        display: flex;
        align-items: center;
        gap: 4px;
        color: var(--primary-text-color);
      }
      .hint.warn ha-icon {
        --mdc-icon-size: 16px;
        color: var(--warning-color, #b45309);
      }
      .actionid {
        font-size: 13px;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .hint-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 13px;
      }
      .sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
      .foot button {
        min-height: 44px;
      }
      .foot {
        display: flex;
        padding-top: 10px;
        border-top: 1px solid var(--divider-color);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'liquid-climate-card-editor': LiquidClimateCardEditor;
  }
}
