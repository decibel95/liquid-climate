import { join } from 'node:path';
import { newPage, openScene } from './browser.mjs';
import { startCapture } from './capture.mjs';
import { encodeMp4, mb } from './encode.mjs';
import { pointer, sleep, dialPoint } from './input.mjs';
import { steps } from './animations.mjs';

/**
 * demo.mp4: the hero scene at 1600x900 CSS px, captured at 1.2x so the frames are 1920x1080.
 * Chains the dial drag, the mode switch, a tile opening its sheet and the language cycle.
 */
export async function renderDemo(browser, base, out) {
  console.log('Demo video');
  const page = await newPage(browser, { width: 1600, height: 900, scale: 1.2 });
  try {
    await openScene(page, base, { scene: 'hero', theme: 'light', lang: 'en', cursor: '1' });
    await page.waitForTimeout(1200);
    const p = await pointer(page, await dialPoint(page, 'temp', (19.5 - 10) / 20));
    const cap = await startCapture(page, 'demo');
    await sleep(800);
    await p.show();
    await steps.dragDial(page, p);
    await steps.switchModes(page, p);
    await steps.openSheet(page, p, 1);
    await p.hide();
    await steps.languages(page);
    await sleep(500);
    const done = await cap.stop();
    const file = join(out, 'demo.mp4');
    const { size } = await encodeMp4(done, file, { width: 1920, height: 1080, crf: 18 });
    console.log(`  demo.mp4 ${mb(size)} MB, ${done.frames.length} frames`);
  } finally {
    await page.context().close();
  }
}
