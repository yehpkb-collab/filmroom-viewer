import { createRequire } from 'node:module';
const require = createRequire(process.env.PW_MODULES || '/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');
import fs from 'node:fs';
const extDir = process.argv[2];
const label = process.argv[3] || 'ext';
const VID = 'dQw4w9WgXcQ';
const clip = fs.readFileSync('' + (process.env.SMOKE_DIR || '/tmp/smoke') + '/clip.webm');
const page_html = `<!doctype html><html><head><title>Stub - YouTube</title></head><body style="margin:0;background:#111">
<div id="primary" style="width:640px;float:left"><div id="movie_player" style="position:relative;width:640px;height:360px"><video class="html5-main-video" src="/clip.webm" muted loop style="width:640px;height:360px"></video></div></div>
<div id="secondary" style="width:340px;float:left"><div id="secondary-inner"></div></div></body></html>`;
const results = {};
const ctx = await chromium.launchPersistentContext('' + (process.env.SMOKE_DIR || '/tmp/smoke') + '/profile-' + label + Date.now(), {
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: false, // we run under xvfb or new headless via args
  args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--autoplay-policy=no-user-gesture-required'],
  acceptDownloads: true,
});
await ctx.route('https://www.youtube.com/**', (route) => {
  const u = new URL(route.request().url());
  if (u.pathname === '/clip.webm') return route.fulfill({ status: 200, contentType: 'video/webm', body: clip, headers: { 'Accept-Ranges': 'none' } });
  return route.fulfill({ status: 200, contentType: 'text/html', body: page_html });
});
let sw = ctx.serviceWorkers()[0];
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10000 });
const store = () => sw.evaluate(() => chrome.storage.local.get(null));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`https://www.youtube.com/watch?v=${VID}`);
await page.waitForSelector('#fr-overlay', { state: 'attached', timeout: 10000 });
await page.waitForSelector('#fr-panel', { state: 'attached', timeout: 10000 });
results.overlayAndPanel = true;
// 1. first-run card (0.8 only)
await page.waitForTimeout(600);
results.firstRunVisible = await page.evaluate(() => { const e = document.getElementById('fr-firstrun'); return !!e && e.classList.contains('fr-on'); });
results.panelVersion = await page.evaluate(() => (document.querySelector('.fr-panel-ver') || {}).textContent || null);
// idle CPU while paused, nothing showing
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
await page.evaluate(() => document.querySelector('video').pause());
const m = async () => { const r = (await cdp.send('Performance.getMetrics')).metrics; const o = {}; r.forEach((x) => (o[x.name] = x.value)); return o; };
const m1 = await m(); await page.waitForTimeout(4000); const m2 = await m();
results.idlePausedMsPerSec = { task: +(((m2.TaskDuration - m1.TaskDuration) / 4) * 1000).toFixed(2), script: +(((m2.ScriptDuration - m1.ScriptDuration) / 4) * 1000).toFixed(2), layouts: (m2.LayoutCount - m1.LayoutCount) / 4 };
// 2. bookmark at ~3s while playing
await page.evaluate(() => { const v = document.querySelector('video'); v.currentTime = 3; v.play(); });
await page.waitForTimeout(500);
await page.keyboard.press('Alt+KeyB');
await page.waitForTimeout(400);
let st = await store();
const key = 'fr_notes:' + VID;
results.bookmarkSaved = Array.isArray(st[key]) && st[key].length === 1 ? { start: st[key][0].start, end: st[key][0].end, emoji: st[key][0].emoji } : st[key];
results.firstRunDismissedByKey = st['fr_firstrun'] === undefined ? 'n/a(0.7)' : st['fr_firstrun'];
// 3. add a note with Alt+N at ~6s
await page.evaluate(() => { const v = document.querySelector('video'); v.currentTime = 6; });
await page.waitForTimeout(300);
await page.keyboard.press('Alt+KeyN');
await page.waitForTimeout(300);
await page.keyboard.type('Split step late');
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
st = await store();
results.notesAfterAdd = (st[key] || []).map((n) => [n.start, n.end, n.text, n.emoji]);
// 4. does the note show at the right time and the bar move?
await page.evaluate(() => { const v = document.querySelector('video'); v.currentTime = 5.0; v.play(); });
const seen = [];
for (let i = 0; i < 16; i++) {
  await page.waitForTimeout(250);
  seen.push(await page.evaluate(() => { const v = document.querySelector('video'); const on = [...document.querySelectorAll('#fr-stack .fr-note.fr-on, #fr-stack [class*=fr-on]')].length; return [Math.round(v.currentTime * 10) / 10, on]; }));
}
results.timeline = seen.map((x) => x.join(':')).join(' ');
// 5. export
await page.evaluate(() => document.querySelector('video').pause());
const dl = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
const expBtn = page.locator('#fr-panel button', { hasText: 'Export notes' });
results.hasExportButton = (await expBtn.count()) > 0;
let exported = null;
if (results.hasExportButton) {
  await expBtn.click();
  const d = await dl;
  if (d) { const p = await d.path(); exported = JSON.parse(fs.readFileSync(p, 'utf8')); results.exportFile = d.suggestedFilename(); results.exportShape = { app: exported.app, v: exported.v, videos: Object.keys(exported.notes).length, notes: (exported.notes[VID] || []).length }; fs.writeFileSync('' + (process.env.SMOKE_DIR || '/tmp/smoke') + '/export.json', JSON.stringify(exported)); }
}
// 6. import: wipe, then import the file
if (exported) {
  await sw.evaluate((k) => chrome.storage.local.remove(k), key);
  await page.reload(); await page.waitForSelector('#fr-panel', { state: 'attached' });
  await page.waitForTimeout(800);
  results.afterWipe = ((await store())[key] || []).length;
  await page.locator('#fr-panel input[type=file]').setInputFiles('' + (process.env.SMOKE_DIR || '/tmp/smoke') + '/export.json');
  await page.waitForTimeout(800);
  results.afterImport = ((await store())[key] || []).length;
  results.panelRowsAfterImport = await page.locator('#fr-panel .fr-prow').count();
  await page.locator('#fr-panel input[type=file]').setInputFiles('' + (process.env.SMOKE_DIR || '/tmp/smoke') + '/export.json');
  await page.waitForTimeout(600);
  results.afterSecondImport = ((await store())[key] || []).length; // dedupe: still the same
  fs.writeFileSync('' + (process.env.SMOKE_DIR || '/tmp/smoke') + '/bad.json', '{"app":"other","v":1,"notes":{}}');
  await page.locator('#fr-panel input[type=file]').setInputFiles('' + (process.env.SMOKE_DIR || '/tmp/smoke') + '/bad.json');
  await page.waitForTimeout(400);
  results.badFileToast = await page.evaluate(() => (document.getElementById('fr-toast') || {}).textContent);
  const evil = { app: 'film-room-notes', v: 1, notes: { [VID]: [{ start: 1, end: 2, text: '<img src=x onerror=alert(1)>', emoji: '💥' }, { start: 'x', end: 2, text: 'bad' }, { start: 20, end: 10, text: 'bad2' }], 'not a video id': [{ start: 1, end: 2, text: 'x' }] } };
  fs.writeFileSync('' + (process.env.SMOKE_DIR || '/tmp/smoke') + '/evil.json', JSON.stringify(evil));
  await page.locator('#fr-panel input[type=file]').setInputFiles('' + (process.env.SMOKE_DIR || '/tmp/smoke') + '/evil.json');
  await page.waitForTimeout(600);
  const after = (await store())[key] || [];
  results.evilImport = { total: after.length, evilEmojiKept: after.some((n) => n.emoji === '💥'), evilTextAsText: after.filter((n) => n.text.startsWith('<img')).length, domHasImg: await page.evaluate(() => !!document.querySelector('#fr-panel img, #fr-overlay img')) };
}
results.pageErrors = errors.slice(0, 5);
console.log(label, JSON.stringify(results, null, 1));
await ctx.close();
