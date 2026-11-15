import { join } from 'node:path';
import { newPage, openScene } from './browser.mjs';

export const SCENES = ['hero', 'dial', 'tile', 'badge', 'cluster', 'editor', 'cluster-editor', 'status-menu', 'trv'];

const stageSize = (page) =>
  page.evaluate(() => {
    const r = document.getElementById('stage').getBoundingClientRect();
    return { width: Math.ceil(r.width), height: Math.ceil(r.height) };
  });

/** Wait for transitions to finish and park the endless animations, so re-runs match. */
const settle = (page) => page.evaluate(() => window.__media.settle());

async function still(browser, base, out, { scene, theme, name }) {
  const page = await newPage(browser);
  try {
    const box = await openScene(page, base, { scene, theme, lang: 'en' });
    if (scene === 'status-menu') {
      await page.locator('liquid-climate-card .status .srow[data-index="0"] button.row').click();
    }
    await settle(page);
    // The open menu grows the card: measure the stage again.
    const size = await stageSize(page);
    if (size.height !== box.height) await page.setViewportSize(size);
    await page.mouse.move(size.width + 50, size.height + 50);
    await settle(page);
    await page.screenshot({ path: join(out, `${name}.png`), clip: { x: 0, y: 0, ...size } });
    console.log(`  ${name}.png`);
  } finally {
    await page.context().close();
  }
}

/** First frame of the demo, without the pointer: 1600x900 CSS px at 1.2x. */
async function poster(browser, base, out) {
  const page = await newPage(browser, { width: 1600, height: 900, scale: 1.2 });
  try {
    const box = await openScene(page, base, { scene: 'hero', theme: 'light', lang: 'en' });
    await settle(page);
    await page.screenshot({ path: join(out, 'demo-poster.png'), clip: { x: 0, y: 0, ...box } });
    console.log('  demo-poster.png');
  } finally {
    await page.context().close();
  }
}

/** Without names: every still plus the split hero and the poster. With names: only the stills of those scenes. */
export async function renderStills(browser, base, out, only = []) {
  console.log('Stills');
  for (const scene of SCENES) {
    if (only.length && !only.includes(scene)) continue;
    for (const theme of ['light', 'dark']) {
      await still(browser, base, out, { scene, theme, name: `${scene}-${theme}` });
    }
  }
  if (only.length) return;
  await still(browser, base, out, { scene: 'hero', theme: 'split', name: 'hero-split' });
  await poster(browser, base, out);
}
