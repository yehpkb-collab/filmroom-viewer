import { createRequire } from 'node:module';
const require = createRequire(process.env.PW_MODULES || '/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');
import fs from 'node:fs';
const extDir = process.argv[2];
const VID = 'dQw4w9WgXcQ';
const clip = fs.readFileSync('' + (process.env.SMOKE_DIR || '/tmp/smoke') + '/clip.webm');
const html = `<!doctype html><html><head><title>Stub - YouTube</title></head><body style="margin:0;background:#111"><div id="primary" style="width:640px;float:left"><div id="movie_player" style="position:relative;width:640px;height:360px"><video class="html5-main-video" src="/clip.webm" muted loop style="width:640px;height:360px"></video></div></div><div id="secondary" style="width:340px;float:left"><div id="secondary-inner"></div></div></body></html>`;
const ctx = await chromium.launchPersistentContext('' + (process.env.SMOKE_DIR || '/tmp/smoke') + '/profile-sh' + Date.now(), {
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: false,
  args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--autoplay-policy=no-user-gesture-required'], acceptDownloads: true });
await ctx.route('https://www.youtube.com/**', (r) => { const u = new URL(r.request().url());
  if (u.pathname === '/clip.webm') return r.fulfill({ status: 200, contentType: 'video/webm', body: clip, headers: { 'Accept-Ranges': 'none' } });
  return r.fulfill({ status: 200, contentType: 'text/html', body: html }); });
let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10000 });
const store = () => sw.evaluate(() => chrome.storage.local.get(null));
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`https://www.youtube.com/watch?v=${VID}`);
await page.waitForSelector('#fr-shapes', { state: 'attached', timeout: 10000 });
await page.waitForTimeout(500);
const out = {};
const k = 'fr_shapes:' + VID; const sh = async () => (await store())[k] || [];
// pencil on the video starts drawing
out.pencilVisible = await page.evaluate(() => getComputedStyle(document.getElementById('fr-pencil')).opacity);
await page.evaluate(() => document.getElementById('fr-pencil').click());
await page.waitForTimeout(300);
out.drawingViaPencil = await page.evaluate(() => document.getElementById('fr-overlay').classList.contains('fr-drawing'));
const box = await page.evaluate(() => { const r = document.getElementById('fr-draw').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
await page.keyboard.press('Digit2');
await page.mouse.move(box.x + box.w * 0.3, box.y + box.h * 0.3); await page.mouse.down(); await page.mouse.move(box.x + box.w * 0.6, box.y + box.h * 0.6, { steps: 6 }); await page.mouse.up();
await page.waitForTimeout(300);
out.editorOpen = await page.evaluate(() => !!document.getElementById('fr-labelinput') && document.activeElement === document.getElementById('fr-labelinput'));
await page.keyboard.type('Watch the split step. k 1 space');
out.videoStillPaused = await page.evaluate(() => document.querySelector('video').paused);
await page.keyboard.press('Enter'); await page.waitForTimeout(300);
out.saved = (await sh()).map((x) => x.type + ':' + x.label);
out.pillText = await page.evaluate(() => [...document.querySelectorAll('.fr-shlabel')].map((e) => e.textContent + '|' + e.classList.contains('fr-on')));
out.stillDrawing = await page.evaluate(() => document.getElementById('fr-overlay').classList.contains('fr-drawing'));
// arrow, then Esc in editor leaves it unlabeled
await page.keyboard.press('Digit1');
await page.mouse.move(box.x + box.w * 0.1, box.y + box.h * 0.8); await page.mouse.down(); await page.mouse.move(box.x + box.w * 0.3, box.y + box.h * 0.6, { steps: 6 }); await page.mouse.up();
await page.waitForTimeout(200); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
out.afterEscEditor = { drawing: await page.evaluate(() => document.getElementById('fr-overlay').classList.contains('fr-drawing')), shapes: (await sh()).map((x) => x.type + ':' + (x.label || '')) };
// click the pill to edit it
const pb = await page.locator('.fr-shlabel.fr-on').first().boundingBox(); await page.mouse.click(pb.x + pb.width / 2, pb.y + pb.height / 2); await page.waitForTimeout(200);
out.editValue = await page.evaluate(() => (document.getElementById('fr-labelinput') || {}).value);
await page.keyboard.press('Control+A'); await page.keyboard.type('Changed'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
out.afterEdit = (await sh()).map((x) => x.type + ':' + (x.label || ''));
await page.screenshot({ path: '' + (process.env.SMOKE_DIR || '/tmp/smoke') + '/label1.png', clip: { x: 0, y: 0, width: 640, height: 360 } });
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
// panel rows
out.panelRows = await page.evaluate(() => [...document.querySelectorAll('#fr-panel .fr-pshape')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
out.header = await page.evaluate(() => document.querySelector('.fr-panel-count').textContent);
// toggles
await page.evaluate(() => { const v = document.querySelector('video'); v.pause(); v.currentTime = 0.05; });
await page.waitForTimeout(500);
const vis = () => page.evaluate(() => ({ shapes: getComputedStyle(document.getElementById('fr-shapes')).display, labels: getComputedStyle(document.getElementById('fr-shapelabels')).display, liveShapes: document.querySelectorAll('#fr-shapes .fr-shape.fr-on').length }));
out.vis0 = await vis();
await page.evaluate(() => [...document.querySelectorAll('.fr-panel-toggle')].find((b) => b.textContent === 'Shapes').click()); await page.waitForTimeout(200);
out.visShapesOff = await vis(); out.stored = (await store()).fr_settings;
await page.keyboard.press('Alt+KeyH'); await page.waitForTimeout(200);
out.afterAltH = await page.evaluate(() => ({ notesHidden: document.getElementById('fr-overlay').classList.contains('fr-hide-notes'), shapesHidden: document.getElementById('fr-overlay').classList.contains('fr-hide-shapes') }));
await page.keyboard.press('Alt+KeyH'); await page.waitForTimeout(200);
out.afterAltH2 = await page.evaluate(() => ({ notesHidden: document.getElementById('fr-overlay').classList.contains('fr-hide-notes'), shapesHidden: document.getElementById('fr-overlay').classList.contains('fr-hide-shapes') }));
// delete a shape row, undo
await page.locator('#fr-panel .fr-pshape').first().hover(); await page.locator('#fr-panel .fr-pshape .fr-pdel').first().click({ force: true }); await page.waitForTimeout(200);
out.afterRowDelete = (await sh()).length;
await page.locator('#fr-undo button').click(); await page.waitForTimeout(200); out.afterRowUndo = (await sh()).length;
// share payload carries labels
const link = await page.evaluate(async () => { await navigator.clipboard.writeText(''); return null; }).catch(() => null);
out.errors = errors;
console.log(JSON.stringify(out, null, 1));
await ctx.close();
