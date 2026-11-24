/// <reference types="vite/client" />
// Everything the live examples need in the browser. Loaded with a dynamic import from LiveCard.vue,
// so Lit and the custom elements never run during the server side render of the pages.
import '../../../src/cards/dial/liquid-climate-card';
import '../../../src/cards/tile/liquid-climate-tile';
import '../../../src/cards/badge/liquid-climate-badge';
import '../../../src/cards/cluster/liquid-climate-cluster';
import { defineHaIcon } from './ha-icon';
import { ensureLiquidFont } from '../../../src/ui/font';
// The shipped Inter font, as in Home Assistant: the docs build emits it as an asset (43 KB, never inlined).
import fontUrl from '../../../fonts/liquid-inter.woff2?url';

export { createDemo } from '../../../src/demo/service';
export type { Demo } from '../../../src/demo/service';

defineHaIcon();
ensureLiquidFont(fontUrl);
