import { join } from 'node:path';
import { newPage, openScene } from './browser.mjs';
import { startCapture } from './capture.mjs';
import { encodeGif, encodeWebp, mb } from './encode.mjs';
import { pointer, sleep, dialPoint, centerOf } from './input.mjs';

const HOLD = 450;
/** Wait until the dial has sent its change ("Sending" gone), then let it sit a moment. */
const sent = async (page) => {
  await page.waitForFunction(() => {
    const root = document.querySelector('liquid-climate-card')?.shadowRoot;
    return !!root && !root.querySelector('.progress') && !/Sending/.test(root.querySelector('.centersub')?.textContent ?? '');
  });
  await sleep(300);
};
const row = (i) => `liquid-climate-card .status .srow[data-index="${i}"]`;
/** Drop keyboard focus rings that programmatic focus (sheet open and close) would leave in the frame. */
const blurActive = (page) =>
  page.evaluate(() => {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    el?.blur?.();
  });
const sheetCard = 'liquid-climate-sheet dialog liquid-climate-card';

/**
 * Reusable interaction segments. Every one ends in the state it started in, so any sequence
 * of them loops without a jump. The demo video chains them on the hero scene.
 */
export const steps = {
  /** Setpoint 19.5 -> 24 -> 19.5, then fan 3 -> 5 -> 3. */
  async dragDial(page, p) {
    const temp = await Promise.all([19.5, 21.5, 24, 22, 19.5].map((v) => dialPoint(page, 'temp', (v - 10) / 20)));
    await p.dragThrough(temp, 330);
    await sleep(500);
    const fan = await Promise.all([0.64, 0.785, 0.93, 0.785, 0.64].map((f) => dialPoint(page, 'fan', f)));
    await p.dragThrough(fan, 300);
    await sent(page);
  },

  /** Heat -> cool -> auto -> heat. */
  async switchModes(page, p) {
    const modes = page.locator('liquid-climate-card .modes button.mode');
    for (const i of [2, 3, 1]) {
      const b = await modes.nth(i).boundingBox();
      await p.click(b.x + b.width / 2, b.y + b.height / 2, 450);
      await sleep(900);
    }
    await sent(page);
  },

  /** Tap a tile, nudge the setpoint up and down, close the sheet. */
  async openSheet(page, p, tileIndex = 1) {
    const tile = await centerOf(page, `liquid-climate-tile >> nth=${tileIndex} >> button.body`);
    await p.click(tile.x - 40, tile.y, 500);
    await sleep(1000);
    await blurActive(page);
    for (const [index, wait] of [[1, 450], [0, 600]]) {
      const b = await centerOf(page, `${sheetCard} .steps button >> nth=${index}`);
      await p.click(b.x, b.y, 450);
      await sleep(200);
      await p.click(b.x, b.y, 80);
      await sleep(wait);
    }
    const close = await centerOf(page, 'liquid-climate-sheet dialog button.close');
    await p.click(close.x, close.y, 450);
    await sleep(300);
    await blurActive(page);
    await sleep(400);
  },

  /** Open the Heating mode menu, pick Eco, toggle the schedule off and on, back to Auto, close the menu. */
  async statusMenu(page, p) {
    const head = `${row(0)} button.row`;
    const expanded = async () => (await page.locator(head).getAttribute('aria-expanded')) === 'true';
    // Picking an option can close the menu by itself, so open it again whenever it is shut.
    const open = async () => {
      if (await expanded()) return;
      const h = await centerOf(page, head);
      await p.click(h.x, h.y, 420);
      await sleep(500);
    };
    await open();
    const eco = await centerOf(page, `${row(0)} [role=radio] >> nth=2`);
    await p.click(eco.x, eco.y, 380);
    await sleep(550);
    await open();
    const sched = await centerOf(page, `${row(0)} [role=switch]`);
    await p.click(sched.x, sched.y, 380);
    await sleep(500);
    await p.click(sched.x, sched.y, 250);
    await sleep(450);
    await open();
    const auto = await centerOf(page, `${row(0)} [role=radio] >> nth=0`);
    await p.click(auto.x, auto.y, 380);
    await sleep(500);
    if (await expanded()) {
      const h = await centerOf(page, head);
      await p.click(h.x, h.y, 400);
      await sleep(450);
    }
    // Closed, Heating mode Auto and the schedule on again, as at the start: the loop must close.
    const state = await page.evaluate(() => {
      const h = document.querySelector('liquid-climate-card').hass.states;
      return [h['input_select.heating_mode'].state, h['automation.heating_schedule'].state];
    });
    if (await expanded()) throw new Error('Status menu did not close');
    if (state.join() !== 'Auto,on') throw new Error(`Status menu ended in ${state.join()}`);
  },

  /** Hallway valve: idle -> heating, battery low, then back to idle with a full battery. */
  async trvHeats(page) {
    const set = (patch) => page.evaluate((p) => window.__media.trv('hallway', p), patch);
    await sleep(400);
    await set({ action: 'heating', current: 20.2, target: 21.5, valve: 55 });
    await sleep(1300);
    await set({ battery: 12 });
    await sleep(1300);
    await set({ action: 'idle', current: 20.6, target: 20, valve: 0, battery: 78 });
    await sleep(900);
  },

  /** Water heater: Eco -> Pump -> Eco, then the humidifier target 55 -> 60 -> 55. */
  async applianceControls(page, p) {
    const settled = async () => {
      await page.waitForFunction(() =>
        [...document.querySelectorAll('liquid-climate-card')].every((c) => !c.shadowRoot?.querySelector('.progress') && !/Sending/.test(c.shadowRoot?.querySelector('.centersub')?.textContent ?? '')),
      );
      await sleep(150);
    };
    const modes = page.locator('.w-dial:nth-child(1) liquid-climate-card .modes button.mode');
    for (const i of [4, 0]) {
      const b = await modes.nth(i).boundingBox();
      await p.click(b.x + b.width / 2, b.y + b.height / 2, 300);
      await sleep(900);
    }
    await settled();
    const scope = '.w-dial:nth-child(2) liquid-climate-card';
    const humidity = await Promise.all([0.55, 0.6, 0.55].map((f) => dialPoint(page, 'temp', f, scope)));
    await p.dragThrough(humidity, 220);
    await settled();
  },

  /** en -> nl -> de -> en. */
  async languages(page) {
    for (const lang of ['nl', 'de', 'en']) {
      await page.evaluate((l) => window.__media.setLang(l), lang);
      await sleep(1200);
    }
  },
};

/**
 * scene: the staging scene. first: where the pointer first appears (it fades in there).
 * grow: extra canvas height in CSS px, for a card that gets taller during the clip (the battery alert).
 * webpMax: a tighter size budget in bytes for the webp (default 2.4 MB).
 * tall: size the canvas for the open status menu, so the whole menu and the card's bottom edge stay in frame.
 */
export const ANIMATIONS = {
  'dial-drag': {
    scene: 'dial',
    first: (page) => dialPoint(page, 'temp', (19.5 - 10) / 20),
    run: (page, p) => steps.dragDial(page, p),
  },
  'mode-switch': {
    scene: 'dial',
    first: (page) => centerOf(page, 'liquid-climate-card .modes button.mode >> nth=2'),
    run: (page, p) => steps.switchModes(page, p),
  },
  'sheet-open': {
    scene: 'sheet',
    first: async (page) => {
      const c = await centerOf(page, 'liquid-climate-tile >> nth=1 >> button.body');
      return { x: c.x - 40, y: c.y };
    },
    run: (page, p) => steps.openSheet(page, p, 1),
  },
  'status-menu': {
    scene: 'status-menu',
    tall: true,
    first: (page) => centerOf(page, `${row(0)} button.row`),
    run: (page, p) => steps.statusMenu(page, p),
  },
  trv: { scene: 'trv', grow: 48, pointer: false, run: (page) => steps.trvHeats(page) },
  appliances: {
    scene: 'appliances',
    webpMax: 0.9 * 1048576,
    first: (page) => centerOf(page, '.w-dial:nth-child(1) liquid-climate-card .modes button.mode >> nth=4'),
    run: (page, p) => steps.applianceControls(page, p),
  },
  language: { scene: 'dial', pointer: false, run: (page) => steps.languages(page) },
};

const stageSize = (page) =>
  page.evaluate(() => {
    const r = document.getElementById('stage').getBoundingClientRect();
    return { width: Math.ceil(r.width), height: Math.ceil(r.height) };
  });

/** Open the status menu once, note the tallest the stage gets, close it, and keep that size as the canvas. */
async function sizeForOpenMenu(page) {
  const head = page.locator(`${row(0)} button.row`);
  await head.click();
  await sleep(900);
  const open = await stageSize(page);
  await head.click();
  await sleep(700);
  await page.setViewportSize(open);
  await page.mouse.move(-50, -50);
  return open;
}

export async function renderAnimations(browser, base, out, only = []) {
  console.log('Animations');
  for (const [name, def] of Object.entries(ANIMATIONS)) {
    if (only.length && !only.includes(name)) continue;
    const page = await newPage(browser);
    try {
      await openScene(page, base, { scene: def.scene, theme: 'light', lang: 'en', cursor: '1' });
      await page.waitForTimeout(1200);
      if (def.tall) await sizeForOpenMenu(page);
      if (def.grow) {
        // Grow the stage itself, so its background (and the cards' shadows) reach the new bottom edge.
        await page.evaluate((px) => { const s = document.getElementById('stage'); s.style.minHeight = `${s.getBoundingClientRect().height + px}px`; }, def.grow);
        await page.setViewportSize(await stageSize(page));
      }
      // The pointer sits hidden at its first target, fades in there, and fades out where it ends.
      const p = await pointer(page, def.first ? await def.first(page) : { x: -50, y: -50 });
      const cap = await startCapture(page, name);
      await sleep(HOLD + 300);
      if (def.pointer !== false) await p.show();
      await def.run(page, p);
      if (def.pointer !== false) await p.hide();
      await sleep(HOLD + 300);
      const done = await cap.stop();
      const gif = await encodeGif(done, join(out, `${name}.gif`));
      const webp = await encodeWebp(done, join(out, `${name}.webp`), def.webpMax ? { maxBytes: def.webpMax } : {});
      console.log(`  ${name}: ${done.frames.length} frames, gif ${gif.width}px ${gif.fps}fps ${mb(gif.size)} MB, webp ${webp.width}px ${webp.fps}fps ${mb(webp.size)} MB`);
    } finally {
      await page.context().close();
    }
  }
}
