/**
 * A small fake hass for the two-bundles page: one dimmed colour light (for Liquid Home) and one climate entity (for
 * Liquid Climate), with the `config` Liquid Climate reads. Nothing talks to Home Assistant.
 */
export const LIGHT_ID = 'light.e2e_kitchen';
export const CLIMATE_ID = 'climate.e2e_living';

const NOW = '2026-11-18T12:00:00+00:00';
const entity = (id: string, state: string, attributes: Record<string, unknown>) => ({
  entity_id: id,
  state,
  attributes,
  last_changed: NOW,
  last_updated: NOW,
  context: { id, parent_id: null, user_id: null },
});

export function createPageHass(): Record<string, unknown> {
  return {
    states: {
      [LIGHT_ID]: entity(LIGHT_ID, 'on', {
        friendly_name: 'Kitchen Lights',
        supported_color_modes: ['color_temp', 'hs'],
        color_mode: 'hs',
        brightness: 26,
        hs_color: [345, 75],
        rgb_color: [255, 64, 112],
        xy_color: [0.588, 0.274],
        color_temp_kelvin: null,
        min_color_temp_kelvin: 2000,
        max_color_temp_kelvin: 6535,
        supported_features: 0,
      }),
      [CLIMATE_ID]: entity(CLIMATE_ID, 'heat', {
        friendly_name: 'Living Room Climate',
        hvac_modes: ['off', 'heat', 'cool', 'heat_cool'],
        hvac_action: 'heating',
        min_temp: 10,
        max_temp: 30,
        target_temp_step: 0.5,
        temperature_unit: '°C',
        current_temperature: 19.6,
        temperature: 21,
        current_humidity: 48,
        fan_modes: ['auto', 'low', 'medium', 'high'],
        fan_mode: 'auto',
        supported_features: 1 | 8,
      }),
    },
    entities: {},
    devices: {},
    areas: {},
    language: 'en',
    locale: { language: 'en', number_format: 'language', time_format: 'language' },
    themes: { darkMode: true },
    config: { unit_system: { temperature: '°C' }, version: '2025.1.4' },
    callService: async () => undefined,
  };
}

/** Loads a bundle as an ES module the way HA does for a dashboard resource. */
export async function loadBundle(name: 'liquid-home' | 'liquid-climate'): Promise<void> {
  await import(/* @vite-ignore */ `/__bundles/${name}.js`);
}
