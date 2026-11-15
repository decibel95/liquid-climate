import '../src/index';
import { CLIMATE_IDS } from '../src/demo/fixtures';
import { createDemo } from '../src/demo/service';
import type { LiquidClimateCardEditor } from '../src/editor/liquid-climate-card-editor';
import type { HomeAssistant } from '../src/types';

const log = document.getElementById('log')!;
const grid = document.getElementById('grid')!;
const tiles = document.getElementById('tiles')!;
const badges = document.getElementById('badges')!;
const clusters = document.getElementById('clusters')!;
let logged = 0;

// Language: the switcher and ?lang=nl set hass.locale.language and hass.language, as Home Assistant does.
const LANGUAGES = ['en', 'nl', 'de', 'fr', 'es', 'it'];
const langSelect = document.getElementById('lang') as HTMLSelectElement;
const initialLang = new URLSearchParams(location.search).get('lang');
langSelect.value = LANGUAGES.includes(initialLang ?? '') ? initialLang! : 'en';

// The fake hass is shared with the docs site (src/demo). Each climate entity may use its own unit; the fixture says which one.
const demo = createDemo({
  delay: 800,
  language: langSelect.value,
  onCall(domain, service, data) {
    const line = `${new Date().toLocaleTimeString()}  ${domain}.${service} ${JSON.stringify(data)}`;
    log.textContent = (logged++ === 0 ? '' : `${log.textContent}\n`) + line;
    log.scrollTop = log.scrollHeight;
  },
});
const states = demo.states;
let hass: HomeAssistant = demo.hass;
const cards: (HTMLElement & { hass: HomeAssistant; setConfig(c: Record<string, unknown>): void })[] = [];
let editor: LiquidClimateCardEditor;
let clusterEditor: LiquidClimateCardEditor;

// Every publish (service call, language change, pause switch) reaches all cards and both editors.
demo.subscribe((next) => {
  hass = next;
  for (const c of cards) c.hass = hass;
  editor.hass = hass;
  clusterEditor.hass = hass;
});

editor = document.createElement('liquid-climate-card-editor') as LiquidClimateCardEditor;
editor.hass = hass;
editor.setConfig({ entity: 'climate.keuken_airco' });
editor.addEventListener('config-changed', (e) => {
  log.textContent += `\nconfig-changed ${JSON.stringify((e as CustomEvent).detail.config)}`;
});
document.getElementById('editorBox')!.append(editor);

langSelect.addEventListener('change', () => demo.setLanguage(langSelect.value));

clusterEditor = document.createElement('liquid-climate-cluster-editor') as LiquidClimateCardEditor;
clusterEditor.hass = hass;
clusterEditor.setConfig({ type: 'custom:liquid-climate-cluster' });
clusterEditor.addEventListener('config-changed', (e) => {
  const config = (e as CustomEvent).detail.config;
  log.textContent += `
config-changed ${JSON.stringify(config)}`;
  // The first cluster follows the editor, as the HA preview would.
  (clusters.querySelector('liquid-climate-cluster') as (typeof cards)[number] | null)?.setConfig(config);
});
document.getElementById('clusterEditorBox')!.append(clusterEditor);

for (const id of CLIMATE_IDS) {
  const fig = document.createElement('figure');
  const cap = document.createElement('figcaption');
  cap.textContent = id;
  const card = document.createElement('liquid-climate-card');
  const cfg: Record<string, unknown> = { entity: id };
  if (id === 'climate.keuken_airco') {
    cfg.name = 'Living Room';
    cfg.status_entities = [
      { entity: 'climate.nagelsalon_airco', name: 'Next door' },
      { entity: 'input_select.heating_mode', name: 'Heating mode', actions: ['script.apply_heating', 'automation.heating_schedule'] },
      { entity: 'input_boolean.window', name: 'Window pause' },
    ];
  }
  card.setConfig(cfg);
  card.hass = hass;
  cards.push(card);
  fig.append(cap, card);
  grid.append(fig);
}

// A pause switch for the badges: flip it from the browser console with togglePause().
(window as unknown as { togglePause: () => void }).togglePause = () => {
  const s = states['input_boolean.window'];
  states['input_boolean.window'] = { ...s, state: s.state === 'on' ? 'off' : 'on' };
  demo.publish();
};

function mount(tag: string, cfg: Record<string, unknown>, parent: HTMLElement) {
  const el = document.createElement(tag) as (typeof cards)[number];
  el.setConfig(cfg);
  el.hass = hass;
  cards.push(el);
  parent.append(el);
}

for (const id of CLIMATE_IDS) mount('liquid-climate-tile', { entity: id }, tiles);
mount('liquid-climate-tile', { entity: 'climate.keuken_airco', name: 'More info on tap', tap_action: 'more-info', look: { glass: 'light' } }, tiles);

for (const id of CLIMATE_IDS) mount('liquid-climate-badge', { entity: id, pause_entity: 'input_boolean.window', tap_action: 'sheet' }, badges);
for (const id of CLIMATE_IDS.slice(0, 3)) mount('liquid-climate-badge', { entity: id, icon_only: true, pause_entity: 'input_boolean.window' }, badges);

// Cluster: auto (grouped by floor) at full width, then the three Daikin units at the widths of a
// sections view card at 12 and at 6 columns, with the sensors the editor would fill in.
const daikin = (slug: string, name?: string) => ({
  entity: `climate.${slug}_airco`,
  name,
  pause_entity: slug === 'slaapkamer' ? 'input_boolean.window' : undefined,
  sensors: {
    outdoor: `sensor.${slug}_airco_buitentemperatuur`,
    energy: [`sensor.${slug}_airco_energie_verwarmen_dag`, `sensor.${slug}_airco_energie_koelen_dag`],
    cloud_limit: `sensor.${slug}_airco_gateway_ratelimit_remaining_day`,
  },
});
const house = [daikin('keuken', 'Living Room'), daikin('slaapkamer'), daikin('nagelsalon')];
for (const [width, cfg] of [
  ['min(100%, 900px)', { type: 'custom:liquid-climate-cluster' }],
  ['480px', { type: 'custom:liquid-climate-cluster', entities: house }],
  ['240px', { type: 'custom:liquid-climate-cluster', entities: house, look: { glass: 'light' } }],
] as [string, Record<string, unknown>][]) {
  const box = document.createElement('div');
  box.style.width = width;
  mount('liquid-climate-cluster', cfg, box);
  clusters.append(box);
}
