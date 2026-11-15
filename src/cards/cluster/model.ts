import type { LiquidClimateConfig } from '../../config';
import { energyKWh, numericState, resolveSensors, type ResolvedSensors } from '../../detect/resolve';
import type { Detection } from '../../detect/roles';
import { optionLabel } from '../../ui/modes';
import { num, numAuto, resolveLanguage, t, type I18nHass } from '../../i18n';
import type { HassEntity, HomeAssistant } from '../../types';
import { buildView, getCapabilities, type Capabilities, type DialView, type Optimistic } from '../dial/capabilities';
import { statusWord } from '../tile/liquid-climate-tile';
import type { RoomRef } from './grouping';

export type RoomKind = 'on' | 'off' | 'error' | 'paused' | 'unavailable';

export interface RoomModel {
  ref: RoomRef;
  dial: LiquidClimateConfig;
  stateObj?: HassEntity;
  /** Only for an available entity. */
  caps?: Capabilities;
  view?: DialView;
  /** What the room shows first: error, then paused, then unavailable, off or on. */
  kind: RoomKind;
  /** The climate entity exists and reports a state. */
  available: boolean;
  mode: string;
  on: boolean;
  /** Status word: hvac_action when reported, else the mode verb. */
  verb: string;
  /** Doing what its mode says right now (hvac_action is not idle), so the icon carries the colour. */
  active: boolean;
  /** "Error" plus the error codes, when a problem flag is on. */
  problem: string | null;
  inside: number | null;
  /** Today's energy of this room in kWh, as the dial shows it. */
  energy: string | null;
  sensors: ResolvedSensors;
}

const RESTING = ['idle', 'off'];

/** Everything a room tile and the control strip show, with pending writes merged in. */
export function roomModel(
  hass: HomeAssistant,
  ref: RoomRef,
  dial: LiquidClimateConfig,
  detection: Detection,
  local: Optimistic,
  modeChanging: boolean,
): RoomModel {
  const stateObj = hass.states[dial.entity];
  const sensors = resolveSensors(hass, dial, detection);
  const pause = ref.room.pause_entity;
  if (pause) sensors.watched.push(pause);
  const details = [...new Set(sensors.problems.map((p) => p.detail).filter(Boolean))].join(', ');
  const problem = sensors.problems.length ? (details ? t(hass, 'common.errorDetail', { detail: details }) : t(hass, 'common.error')) : null;
  const energy = sensors.info.find((i) => i.key === 'energy')?.value ?? null;
  const base = { ref, dial, stateObj, problem, inside: sensors.roomTemperature, energy, sensors };

  const available = !!stateObj && stateObj.state !== 'unavailable' && stateObj.state !== 'unknown';
  const caps = available ? getCapabilities(stateObj, dial, hass) : undefined;
  const view = available ? buildView(stateObj, caps!, local) : undefined;
  const mode = view?.mode ?? 'off';
  const on = available && mode !== 'off';
  const action = stateObj?.attributes.hvac_action;
  const active = on && (modeChanging || typeof action !== 'string' || !action || !RESTING.includes(action));
  const verb = !stateObj ? t(hass, 'common.notFound') : !available ? t(hass, 'common.unavailable') : statusWord(hass, stateObj, mode, modeChanging);
  const paused = !!pause && hass.states[pause]?.state === 'on';
  const kind: RoomKind = problem ? 'error' : paused ? 'paused' : !available ? 'unavailable' : on ? 'on' : 'off';
  return { ...base, caps, view, kind, available, mode, on, verb, active };
}

/** A fan name inside a sentence: lower case, except in German where it stays a noun ("Lüfter Niedrig"). */
const fanWord = (hass: I18nHass | undefined, name: string): string => {
  const lang = resolveLanguage(hass);
  return lang === 'de' ? name : name.toLocaleLowerCase(lang);
};

/** The line under a room's mini dial. */
export function roomFooter(r: RoomModel, hass?: I18nHass): string {
  if (r.problem) return r.problem;
  if (r.kind === 'paused') return t(hass, 'common.paused');
  if (r.kind === 'unavailable') return r.verb;
  const kwh = r.energy != null ? t(hass, 'cluster.kwhToday', { value: r.energy }) : null;
  const off = t(hass, 'common.off');
  if (!r.on) return kwh ? `${off}, ${kwh}` : off;
  const fan = r.view?.fan ? t(hass, 'cluster.fan', { value: fanWord(hass, optionLabel(hass, 'fan_mode', r.view.fan, r.stateObj)) }) : null;
  return [r.verb, fan, kwh].filter(Boolean).join(', ');
}

const SUMMARY_KEY: Record<string, string> = { heat: 'cluster.summaryHeat', cool: 'cluster.summaryCool', dry: 'cluster.summaryDry' };

/**
 * "2 of 3 heating" when every running room is in the same mode and actually doing it (not
 * idle), else "2 of 3 on". "Unavailable" when no room is. Problems follow.
 */
export function clusterSummary(rooms: RoomModel[], hass?: I18nHass): string {
  if (!rooms.length) return t(hass, 'cluster.noEntities');
  const on = rooms.filter((r) => r.on);
  const count = (kind: RoomKind) => rooms.filter((r) => r.kind === kind).length;
  let head: string;
  if (on.length) {
    const modes = new Set(on.map((r) => r.mode));
    const key = modes.size === 1 && on.every((r) => r.active) ? (SUMMARY_KEY[[...modes][0]] ?? 'cluster.summaryOn') : 'cluster.summaryOn';
    head = t(hass, key, { n: on.length, total: rooms.length });
  } else head = rooms.some((r) => r.available) ? t(hass, 'cluster.allOff') : t(hass, 'common.unavailable');
  const errors = count('error');
  const paused = count('paused');
  const unavailable = count('unavailable');
  const allUnavailable = !on.length && !rooms.some((r) => r.available);
  const extra = [
    errors ? t(hass, errors === 1 ? 'cluster.errorOne' : 'cluster.errorMany', { n: errors }) : '',
    paused ? t(hass, 'cluster.paused', { n: paused }) : '',
    unavailable && !allUnavailable ? t(hass, 'cluster.unavailable', { n: unavailable }) : '',
  ].filter(Boolean);
  return [head, ...extra].join(', ');
}

export interface Figure {
  key: 'outdoor' | 'energy' | 'cloud_limit';
  value: string;
  label: string;
}

/**
 * Figures for the whole house, each only when it resolves: the first outdoor reading in room
 * order, today's energy summed over every distinct sensor in kWh (only when all of them resolve), and the lowest cloud call
 * count (units on one account report the same budget).
 */
export function clusterFigures(hass: HomeAssistant, rooms: RoomModel[]): Figure[] {
  const out: Figure[] = [];
  const outdoor = rooms.map((r) => numericState(hass, r.sensors.figures.outdoor)).find((v) => v != null);
  if (outdoor != null) out.push({ key: 'outdoor', value: `${numAuto(hass, outdoor, 1)}°`, label: t(hass, 'cluster.figOutside') });

  const energyIds = [...new Set(rooms.flatMap((r) => r.sensors.figures.energy))];
  const kwh = energyIds.map((id) => energyKWh(hass, id)).filter((v): v is number => v != null);
  // A partial sum would read as the house total while it is not, so the figure waits until
  // every configured energy sensor resolves.
  if (kwh.length && kwh.length === energyIds.length) out.push({ key: 'energy', value: `${num(hass, kwh.reduce((a, b) => a + b, 0), 1)} kWh`, label: t(hass, 'cluster.figToday') });

  const cloudIds = [...new Set(rooms.map((r) => r.sensors.figures.cloud_limit).filter((id): id is string => !!id))];
  const calls = cloudIds.map((id) => numericState(hass, id)).filter((v): v is number => v != null);
  if (calls.length) out.push({ key: 'cloud_limit', value: num(hass, Math.round(Math.min(...calls)), 0), label: t(hass, 'cluster.figCloud') });
  return out;
}
