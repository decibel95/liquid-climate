import {
  mdiAirConditioner, mdiAlert, mdiCalendar, mdiCalendarClock, mdiCheckCircle, mdiCloud, mdiCog, mdiDoorOpen,
  mdiFan, mdiFanSpeed1, mdiFanSpeed2, mdiFanSpeed3, mdiFire, mdiFlash, mdiHome, mdiHomeThermometer, mdiLeaf,
  mdiLightningBolt, mdiMeterElectric, mdiPencil, mdiPower, mdiRadiator, mdiSnowflake, mdiThermometer,
  mdiThermostat, mdiTimer, mdiWaterPercent, mdiWeatherNight, mdiWeatherSunny, mdiWifi, mdiWindowOpen, mdiWindowOpenVariant,
} from '@mdi/js';

/**
 * Stand-in for Home Assistant's <ha-icon>: an inline 24x24 svg from @mdi/js, sized by --mdc-icon-size.
 * Only the icons the cards and their docs examples use are bundled; any other renders an empty box.
 */
const ICONS: Record<string, string> = {
  'mdi:air-conditioner': mdiAirConditioner,
  'mdi:alert': mdiAlert,
  'mdi:calendar': mdiCalendar,
  'mdi:calendar-clock': mdiCalendarClock,
  'mdi:check-circle': mdiCheckCircle,
  'mdi:cloud': mdiCloud,
  'mdi:cog': mdiCog,
  'mdi:door-open': mdiDoorOpen,
  'mdi:fan': mdiFan,
  'mdi:fan-speed-1': mdiFanSpeed1,
  'mdi:fan-speed-2': mdiFanSpeed2,
  'mdi:fan-speed-3': mdiFanSpeed3,
  'mdi:fire': mdiFire,
  'mdi:flash': mdiFlash,
  'mdi:home': mdiHome,
  'mdi:home-thermometer': mdiHomeThermometer,
  'mdi:leaf': mdiLeaf,
  'mdi:lightning-bolt': mdiLightningBolt,
  'mdi:meter-electric': mdiMeterElectric,
  'mdi:pencil': mdiPencil,
  'mdi:power': mdiPower,
  'mdi:radiator': mdiRadiator,
  'mdi:snowflake': mdiSnowflake,
  'mdi:thermometer': mdiThermometer,
  'mdi:thermostat': mdiThermostat,
  'mdi:timer': mdiTimer,
  'mdi:water-percent': mdiWaterPercent,
  'mdi:weather-night': mdiWeatherNight,
  'mdi:weather-sunny': mdiWeatherSunny,
  'mdi:wifi': mdiWifi,
  'mdi:window-open': mdiWindowOpen,
  'mdi:window-open-variant': mdiWindowOpenVariant,
};

export function defineHaIcon(): void {
  if (customElements.get('ha-icon')) return;
  customElements.define(
    'ha-icon',
    class extends HTMLElement {
      static observedAttributes = ['icon'];

      connectedCallback() {
        this.render();
      }

      attributeChangedCallback() {
        this.render();
      }

      private render() {
        const name = this.getAttribute('icon') ?? '';
        const path = Object.hasOwn(ICONS, name) ? ICONS[name] : '';
        const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
        root.innerHTML = `<style>
          :host { display: inline-flex; width: var(--mdc-icon-size, 24px); height: var(--mdc-icon-size, 24px); flex: none; }
          svg { width: 100%; height: 100%; fill: currentColor; }
        </style><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"></path></svg>`;
      }
    },
  );
}
