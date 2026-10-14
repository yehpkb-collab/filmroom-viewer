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
out.panelDrawBtn = await page.evaluate(() => !!document.querySelector('.fr-panel-draw'));
// enter draw mode with Alt+A (video stub paused or playing)
await page.evaluate(() => document.querySelector('video').play().catch(() => {}));
await page.keyboard.press('Alt+KeyA');
await page.waitForTimeout(300);
out.drawing = await page.evaluate(() => document.getElementById('fr-overlay').classList.contains('fr-drawing'));
out.pausedByDraw = await page.evaluate(() => document.querySelector('video').paused);
await page.evaluate(() => [...document.querySelectorAll('#fr-drawbar .fr-tool')].find((b) => b.textContent === 'Label').click());
const box = await page.evaluate(() => { const r = document.getElementById('fr-draw').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const drag = async (x1, y1, x2, y2) => { await page.mouse.move(box.x + box.w * x1, box.y + box.h * y1); await page.mouse.down(); await page.mouse.move(box.x + box.w * (x1 + x2) / 2, box.y + box.h * (y1 + y2) / 2, { steps: 4 }); await page.mouse.move(box.x + box.w * x2, box.y + box.h * y2, { steps: 4 }); await page.mouse.up(); };
await drag(0.2, 0.3, 0.5, 0.6);                // arrow
await page.keyboard.press('Digit2'); await drag(0.55, 0.2, 0.8, 0.5);   // circle
await page.keyboard.press('Digit3'); await drag(0.1, 0.7, 0.4, 0.9);    // box
await page.mouse.click(box.x + box.w * 0.3, box.y + box.h * 0.5); // plain click with box tool: nothing
await page.waitForTimeout(300);
let s = await store(); const k = 'fr_shapes:' + VID;
out.saved = (s[k] || []).map((x) => [x.type, x.start, x.end, x.x1, x.y1, x.x2, x.y2].join('|'));
out.liveGroups = await page.evaluate(() => document.querySelectorAll('#fr-shapes .fr-shape.fr-on').length);
await page.screenshot({ path: '' + (process.env.SMOKE_DIR || '/tmp/smoke') + '/shapes1.png' });
// erase the circle
await page.keyboard.press('Digit4'); await page.mouse.click(box.x + box.w * 0.675, box.y + box.h * 0.35);
await page.waitForTimeout(200);
s = await store(); out.afterErase = (s[k] || []).map((x) => x.type);
out.undoVisible = await page.evaluate(() => getComputedStyle(document.getElementById('fr-undo') || document.body).display);
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
out.drawingAfterEsc = await page.evaluate(() => document.getElementById('fr-overlay').classList.contains('fr-drawing'));
out.resumed = await page.evaluate(() => !document.querySelector('video').paused);
out.headerCount = await page.evaluate(() => document.querySelector('.fr-panel-count').textContent);
// shapes hidden when time is outside
await page.evaluate(() => { const v = document.querySelector('video'); v.pause(); v.currentTime = 0.05; });
await page.waitForTimeout(500);
out.liveAtTime = await page.evaluate(() => document.querySelectorAll('#fr-shapes .fr-shape.fr-on').length);
// export includes shapes, wipe, import
const dl = page.waitForEvent('download');
await page.evaluate(() => [...document.querySelectorAll('#fr-panel button')].find((b) => b.textContent === 'Export notes').click());
const d = await dl; const p = '' + (process.env.SMOKE_DIR || '/tmp/smoke') + '/export-shapes.json'; await d.saveAs(p);
const ex = JSON.parse(fs.readFileSync(p, 'utf8')); out.exportShapes = Object.values(ex.shapes || {}).map((a) => a.length);
await sw.evaluate(() => chrome.storage.local.clear()); await page.reload(); await page.waitForSelector('#fr-shapes', { state: 'attached' }); await page.waitForTimeout(500);
out.afterWipe = (await store())[k] ? 1 : 0;
await page.setInputFiles('.fr-panel-files input[type=file]', p); await page.waitForTimeout(600);
out.afterImport = ((await store())[k] || []).length;
await page.setInputFiles('.fr-panel-files input[type=file]', p); await page.waitForTimeout(600);
out.afterReimport = ((await store())[k] || []).length;
// evil shapes in storage
await sw.evaluate((k) => chrome.storage.local.set({ [k]: [{ type: '<img>', start: 0, end: 5, x1: 1, y1: 1, x2: 2, y2: 2 }, { type: 'box', start: 0, end: 5, x1: -50, y1: 1e9, x2: 'a', y2: 2 }, { type: 'arrow', start: 0, end: 5, x1: -5, y1: 120, x2: 50, y2: 50 }] }), k);
await page.reload(); await page.waitForSelector('#fr-shapes', { state: 'attached' }); await page.waitForTimeout(600);
out.evilGroups = await page.evaluate(() => document.querySelectorAll('#fr-shapes .fr-shape').length);
out.errors = errors;
console.log(JSON.stringify(out, null, 1));
await ctx.close();
