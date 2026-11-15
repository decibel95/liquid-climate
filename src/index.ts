import './cards/dial/liquid-climate-card';
import './cards/tile/liquid-climate-tile';
import './cards/badge/liquid-climate-badge';
import './cards/cluster/liquid-climate-cluster';
import './editor/liquid-climate-card-editor';
import './editor/liquid-climate-tile-editor';
import './editor/liquid-climate-badge-editor';
import './editor/liquid-climate-cluster-editor';

interface PickerEntry {
  type: string;
  name: string;
  description: string;
  preview?: boolean;
  documentationURL?: string;
}

declare global {
  interface Window {
    customCards?: PickerEntry[];
    customBadges?: PickerEntry[];
  }
}

function register(list: PickerEntry[], entry: PickerEntry) {
  if (!list.some((c) => c.type === entry.type)) list.push(entry);
}

const BADGE: PickerEntry = {
  type: 'liquid-climate-badge',
  name: 'Liquid Climate badge',
  description: 'Glass status pill: room temperature, or Off, Paused or Error when that matters more.',
  preview: true,
};

window.customCards = window.customCards || [];
register(window.customCards, {
  type: 'liquid-climate-card',
  name: 'Liquid Climate',
  description: 'Glass dial for any climate entity: setpoint and fan rings, modes, swing, presets and detected sensors.',
  preview: true,
});
register(window.customCards, {
  type: 'liquid-climate-tile',
  name: 'Liquid Climate tile',
  description: 'Compact glass row: power, status, target steppers. Tap to open the dial as a sheet.',
  preview: true,
});
register(window.customCards, BADGE);
register(window.customCards, {
  type: 'liquid-climate-cluster',
  name: 'Liquid Climate cluster',
  description: 'Every climate entity in one glass card, grouped by floor or area, with a mode and target strip.',
  preview: true,
});

window.customBadges = window.customBadges || [];
register(window.customBadges, BADGE);
