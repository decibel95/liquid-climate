<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useData } from 'vitepress';
import type { Demo } from '../../../src/demo/service';
import { HA_THEME_VARS, type HaTheme } from './ha-theme';

type CardType = 'dial' | 'tile' | 'badge' | 'cluster';
type Config = Record<string, unknown>;
type CardElement = HTMLElement & { hass: unknown; setConfig(config: Config): void };

const props = withDefaults(
  defineProps<{
    type: CardType;
    /** Merged over the default config of the type. */
    config?: Config;
    /** Initial language: en, nl, de, fr, es or it. */
    lang?: string;
    theme?: 'auto' | 'light' | 'dark';
    /** CSS width of the card box. */
    width?: string;
    /** CSS height of the card box. */
    height?: string;
    /** The language select and the light/dark/auto toggle. Accepts the string "false" too. */
    controls?: boolean | string;
    /** Shows the Edit links of the status menu (they would navigate away from the docs). */
    admin?: boolean;
  }>(),
  { config: () => ({}), lang: 'en', theme: 'auto', controls: true, admin: false },
);

const TAGS: Record<CardType, string> = {
  dial: 'liquid-climate-card',
  tile: 'liquid-climate-tile',
  badge: 'liquid-climate-badge',
  cluster: 'liquid-climate-cluster',
};

const DEFAULT_WIDTH: Record<CardType, string> = {
  dial: 'min(100%, 360px)',
  tile: 'min(100%, 360px)',
  badge: 'auto',
  cluster: 'min(100%, 720px)',
};

/** The three status rows of the dev harness: a unit, a select with actions, and a switch. */
const DEFAULT_CONFIG: Record<CardType, Config> = {
  dial: {
    entity: 'climate.living_room',
    name: 'Living Room',
    status_entities: [
      { entity: 'climate.office', name: 'Next door' },
      { entity: 'input_select.heating_mode', name: 'Heating mode', actions: ['script.apply_heating', 'automation.heating_schedule'] },
      { entity: 'input_boolean.window', name: 'Window pause' },
    ],
  },
  tile: { entity: 'climate.living_room', name: 'Living Room' },
  badge: { entity: 'climate.living_room', pause_entity: 'input_boolean.window', tap_action: 'sheet' },
  cluster: { type: 'custom:liquid-climate-cluster', entities: ['climate.living_room', 'climate.bedroom', 'climate.office', 'climate.studio'] },
};

const LANGUAGES: [string, string][] = [
  ['en', 'English'],
  ['nl', 'Nederlands'],
  ['de', 'Deutsch'],
  ['fr', 'Français'],
  ['es', 'Español'],
  ['it', 'Italiano'],
];
const MODES = ['auto', 'light', 'dark'] as const;

const { isDark } = useData();
const box = ref<HTMLElement>();
const mounted = ref(false);
const error = ref('');
const language = ref(LANGUAGES.some(([code]) => code === props.lang) ? props.lang : 'en');
const mode = ref<'auto' | 'light' | 'dark'>(props.theme);

const showControls = computed(() => props.controls !== false && props.controls !== 'false');
// Server side and the first client render stay light, so hydration matches; the real theme follows on mount.
const effective = computed<HaTheme>(() => {
  if (!mounted.value) return 'light';
  return mode.value === 'auto' ? (isDark.value ? 'dark' : 'light') : mode.value;
});
const themeStyle = computed(() => HA_THEME_VARS[effective.value]);
const boxStyle = computed(() => ({ width: props.width ?? DEFAULT_WIDTH[props.type], height: props.height }));
// A config for another entity does not inherit the name and status rows written for the default one.
// The history button is off in every example: it would leave the docs for a /history page that only Home Assistant has.
// An example can still show it with `show_history: true` in its config.
const merged = computed<Config>(() => {
  const base = DEFAULT_CONFIG[props.type];
  const other = props.config.entity !== undefined && props.config.entity !== base.entity;
  return { show_history: false, ...(other ? {} : base), ...props.config };
});

let demo: Demo | undefined;
let card: CardElement | undefined;
let unsubscribe: (() => void) | undefined;

onMounted(async () => {
  mounted.value = true;
  const live = await import('./live');
  if (!box.value) return; // unmounted while the cards were loading
  demo = live.createDemo({ delay: 400, english: true, language: language.value, dark: effective.value === 'dark', admin: props.admin });
  card = document.createElement(TAGS[props.type]) as CardElement;
  try {
    card.setConfig(merged.value);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    card = undefined;
    return;
  }
  card.hass = demo.hass;
  unsubscribe = demo.subscribe((hass) => {
    if (card) card.hass = hass;
  });
  box.value.append(card);
});

onBeforeUnmount(() => {
  unsubscribe?.();
  demo?.dispose();
  card?.remove();
  demo = card = undefined;
});

watch(language, (l) => demo?.setLanguage(l));
watch(effective, (t) => demo?.setDark(t === 'dark'));
watch(
  () => JSON.stringify(merged.value),
  () => {
    if (!card) return;
    try {
      card.setConfig(merged.value);
      error.value = '';
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    }
  },
);

// The cards ask the dashboard for more-info dialogs; there is none here.
function ignoreMoreInfo(e: Event) {
  e.stopPropagation();
}
</script>

<template>
  <div class="live-card" :data-ha-theme="effective" :style="themeStyle">
    <div v-if="showControls" class="live-controls">
      <label>
        <span>Language</span>
        <select v-model="language" aria-label="Language">
          <option v-for="[code, name] in LANGUAGES" :key="code" :value="code">{{ name }}</option>
        </select>
      </label>
      <div class="live-modes" role="group" aria-label="Theme">
        <button
          v-for="m in MODES"
          :key="m"
          type="button"
          :class="{ on: mode === m }"
          :aria-pressed="mode === m"
          @click="mode = m"
        >
          {{ m }}
        </button>
      </div>
    </div>
    <div class="live-stage">
      <div ref="box" class="live-box" :style="boxStyle" @hass-more-info="ignoreMoreInfo" />
      <p v-if="error" class="live-error" role="alert">{{ error }}</p>
    </div>
  </div>
</template>

<style scoped>
.live-card {
  margin: 16px 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  overflow: hidden;
  font-family: Roboto, system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: var(--primary-text-color);
  background: var(--primary-background-color);
  color-scheme: light;
}
.live-card[data-ha-theme='dark'] {
  color-scheme: dark;
}
.live-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--secondary-text-color);
  border-bottom: 1px solid var(--divider-color);
}
.live-controls label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.live-controls select {
  font: inherit;
  color: var(--primary-text-color);
  background: var(--card-background-color);
  border: 1px solid var(--divider-color);
  border-radius: 6px;
  padding: 2px 6px;
}
.live-modes {
  display: inline-flex;
  border: 1px solid var(--divider-color);
  border-radius: 6px;
  overflow: hidden;
}
.live-modes button {
  font: inherit;
  text-transform: capitalize;
  color: var(--secondary-text-color);
  background: transparent;
  border: 0;
  padding: 2px 10px;
  cursor: pointer;
}
.live-modes button.on {
  color: var(--text-primary-color);
  background: var(--primary-color);
}
.live-stage {
  display: flex;
  justify-content: center;
  padding: 20px 16px;
}
.live-error {
  margin: 0;
  color: var(--error-color, #db4437);
  font-size: 13px;
}
.live-box {
  max-width: 100%;
  min-height: 40px;
}
</style>
