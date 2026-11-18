// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import '../src/index';
import { APPLIANCE_IDS as ID, allFixtures, appliances, makeHass, mergeFixtures } from './fixtures';

type AnyEl = HTMLElement & Record<string, any>;

const f = mergeFixtures(allFixtures, appliances());

const flush = async (ed: AnyEl) => {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await ed.updateComplete;
  }
};

async function editor(tag: string, config: Record<string, unknown>) {
  const out: Record<string, any>[] = [];
  const ed = document.createElement(tag) as unknown as AnyEl;
  ed.setConfig(config);
  ed.hass = makeHass(f);
  ed.addEventListener('config-changed', (e) => out.push((e as CustomEvent).detail.config));
  document.body.append(ed);
  await flush(ed);
  return { ed, last: () => out[out.length - 1], out };
}

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const tab = (ed: AnyEl, name: string) => [...ed.shadowRoot!.querySelectorAll<HTMLElement>('[role=tab]')].find((t) => text(t) === name)!;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('editors: water heaters and humidifiers', () => {
  it.each(['liquid-climate-card-editor', 'liquid-climate-tile-editor', 'liquid-climate-badge-editor'])('%s: the entity picker lists them next to climate', async (tag) => {
    const { ed } = await editor(tag, { type: 'custom:liquid-climate-card', entity: ID.waterHeater });
    const options = [...ed.shadowRoot!.querySelectorAll('select option')].map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(expect.arrayContaining(['climate.keuken_airco', ...Object.values(ID)]));
    expect(options.some((id) => id.startsWith('sensor.'))).toBe(false);
  });

  it.each([ID.waterHeater, ID.hygrostat])('dial editor: %s hides the climate-only controls', async (entity) => {
    const { ed } = await editor('liquid-climate-card-editor', { type: 'custom:liquid-climate-card', entity });
    tab(ed, 'Controls').click();
    await flush(ed);
    const body = text(ed.shadowRoot!.querySelector('.body'));
    for (const label of ['Modes on the card', 'Fan ring', 'Vertical swing', 'Horizontal swing', 'Presets']) expect(body).not.toContain(label);
    expect(body).toContain('Write delay');
    expect(body).toContain('Status rows under the dial');
  });

  it('dial editor: a climate entity keeps them', async () => {
    const { ed } = await editor('liquid-climate-card-editor', { type: 'custom:liquid-climate-card', entity: 'climate.keuken_airco' });
    tab(ed, 'Controls').click();
    await flush(ed);
    expect(text(ed.shadowRoot!.querySelector('.body'))).toContain('Modes on the card');
  });

  it('cluster editor: device types default to climate, picking one writes domains, the last one stays', async () => {
    const { ed, last } = await editor('liquid-climate-cluster-editor', { type: 'custom:liquid-climate-cluster' });
    const pills = () => [...ed.shadowRoot!.querySelectorAll<HTMLButtonElement>('[aria-labelledby=lc-domains-label] button')];
    expect(pills().map(text)).toEqual(['Climate', 'Water heaters', 'Humidifiers']);
    expect(pills().map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    expect(pills()[0].disabled).toBe(true);
    pills()[2].click();
    expect(last().domains).toEqual(['climate', 'humidifier']);
    await flush(ed);
    // The rooms list now offers the humidifiers.
    expect(text(ed.shadowRoot!.querySelector('.rooms'))).toContain('Hygrostat');
    pills()[2].click();
    expect(last()).not.toHaveProperty('domains');
  });

  it('the entity field is labelled Entity, in Dutch Entiteit', async () => {
    const { ed } = await editor('liquid-climate-card-editor', { type: 'custom:liquid-climate-card', entity: ID.humidifier });
    expect(text(ed.shadowRoot!.querySelector('label.field .lbl'))).toBe('Entity');
    ed.hass = { ...makeHass(f), language: 'nl', locale: { language: 'nl', number_format: 'language' } };
    await flush(ed);
    expect(text(ed.shadowRoot!.querySelector('label.field .lbl'))).toBe('Entiteit');
  });

  it('cluster editor: the title placeholder follows the default title', async () => {
    const climate = await editor('liquid-climate-cluster-editor', { type: 'custom:liquid-climate-cluster' });
    expect(climate.ed.shadowRoot!.querySelector('input[placeholder="Climate"]')).not.toBeNull();
    document.body.innerHTML = '';
    const mixed = await editor('liquid-climate-cluster-editor', { type: 'custom:liquid-climate-cluster', domains: ['climate', 'water_heater'] });
    expect(mixed.ed.shadowRoot!.querySelector('input[placeholder="Comfort"]')).not.toBeNull();
  });

  const setupLabels = (ed: AnyEl) => [...ed.shadowRoot!.querySelectorAll('label.field .lbl')].map(text);
  const sensorRows = async (ed: AnyEl) => {
    tab(ed, 'Sensors').click();
    await flush(ed);
    return [...ed.shadowRoot!.querySelectorAll('.row .grow .name')].map(text);
  };

  it.each([
    ['climate.keuken_airco', 'Room temperature sensor', 'Kamertemperatuursensor'],
    [ID.waterHeater, 'Water temperature sensor', 'Watertemperatuursensor'],
    [ID.humidifier, 'Humidity sensor', 'Vochtigheidssensor'],
  ])('%s: the Setup sensor field reads %s', async (entity, en, nl) => {
    const { ed } = await editor('liquid-climate-card-editor', { type: 'custom:liquid-climate-card', entity });
    expect(setupLabels(ed)).toContain(en);
    ed.hass = { ...makeHass(f), language: 'nl', locale: { language: 'nl', number_format: 'language' } };
    await flush(ed);
    expect(setupLabels(ed)).toContain(nl);
  });

  it('the humidifier suggests humidity sensors, the water heater temperature sensors', async () => {
    const g = mergeFixtures(f);
    g.states['sensor.bath_humidity'] = { entity_id: 'sensor.bath_humidity', state: '52', attributes: { device_class: 'humidity', unit_of_measurement: '%' } };
    g.states['sensor.tank_temperature'] = { entity_id: 'sensor.tank_temperature', state: '51', attributes: { device_class: 'temperature', unit_of_measurement: '°C' } };
    const options = async (entity: string) => {
      const ed = document.createElement('liquid-climate-card-editor') as unknown as AnyEl;
      ed.setConfig({ type: 'custom:liquid-climate-card', entity });
      ed.hass = makeHass(g);
      document.body.append(ed);
      await flush(ed);
      const ids = [...ed.shadowRoot!.querySelectorAll('#lc-room-sensors option')].map((o) => o.getAttribute('value'));
      ed.remove();
      return ids;
    };
    expect(await options(ID.humidifier)).toContain('sensor.bath_humidity');
    expect(await options(ID.humidifier)).not.toContain('sensor.tank_temperature');
    expect(await options(ID.waterHeater)).toContain('sensor.tank_temperature');
    expect(await options(ID.waterHeater)).not.toContain('sensor.bath_humidity');
  });

  it('Sensors tab: roles that mean nothing for the domain are hidden, unless set', async () => {
    const climate = await editor('liquid-climate-card-editor', { type: 'custom:liquid-climate-card', entity: 'climate.keuken_airco' });
    expect(await sensorRows(climate.ed)).toEqual(expect.arrayContaining(['Humidity', 'Outdoor temperature', 'Energy today']));
    document.body.innerHTML = '';
    const water = await editor('liquid-climate-card-editor', { type: 'custom:liquid-climate-card', entity: ID.waterHeater });
    const w = await sensorRows(water.ed);
    expect(w).not.toContain('Humidity');
    expect(w).toEqual(expect.arrayContaining(['Outdoor temperature', 'Energy today', 'Unit health']));
    document.body.innerHTML = '';
    const hum = await editor('liquid-climate-card-editor', { type: 'custom:liquid-climate-card', entity: ID.humidifier });
    const h = await sensorRows(hum.ed);
    expect(h).not.toContain('Humidity');
    expect(h).not.toContain('Outdoor temperature');
    expect(h).toEqual(expect.arrayContaining(['Energy today', 'Unit health']));
    document.body.innerHTML = '';
    const set = await editor('liquid-climate-card-editor', { type: 'custom:liquid-climate-card', entity: ID.humidifier, sensors: { outdoor: 'sensor.outside' } });
    expect(await sensorRows(set.ed)).toContain('Outdoor temperature');
  });

  it('cluster editor: a humidifier room labels its override Humidity sensor', async () => {
    const { ed } = await editor('liquid-climate-cluster-editor', { type: 'custom:liquid-climate-cluster', entities: [ID.humidifier] });
    (ed.shadowRoot!.querySelector('button[aria-controls]') as HTMLButtonElement).click();
    await flush(ed);
    const field = [...ed.shadowRoot!.querySelectorAll('.override label.field')].find((l) => text(l.querySelector('.lbl')) === 'Humidity sensor');
    expect(field?.querySelector('input')?.getAttribute('list')).toBe('lc-humidity_sensor');
  });

  it('cluster editor: no device types picker for a chosen list', async () => {
    const { ed } = await editor('liquid-climate-cluster-editor', { type: 'custom:liquid-climate-cluster', entities: [ID.hygrostat] });
    expect(ed.shadowRoot!.querySelector('#lc-domains-label')).toBeNull();
  });
});
