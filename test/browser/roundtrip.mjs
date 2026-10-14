import { createRequire } from 'node:module';
const require = createRequire(process.env.PW_MODULES || '/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');
import fs from 'node:fs';
import { parsePayload } from '../../netlify/lib/share-core.mjs';
const extDir = new URL('../../extension', import.meta.url).pathname;
const VID = 'dQw4w9WgXcQ';
const clip = fs.readFileSync('' + (process.env.SMOKE_DIR || '/tmp/smoke') + '/clip.webm');
const ytHtml = `<!doctype html><html><head><title>Stub - YouTube</title></head><body style="margin:0;background:#111"><div id="primary" style="width:640px;float:left"><div id="movie_player" style="position:relative;width:640px;height:360px"><video class="html5-main-video" src="/clip.webm" muted loop style="width:640px;height:360px"></video></div></div><div id="secondary" style="width:340px;float:left"><div id="secondary-inner"></div></div></body></html>`;
const ctx = await chromium.launchPersistentContext('' + (process.env.SMOKE_DIR || '/tmp/smoke') + '/profile-x' + Date.now(), {
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: false,
  args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--autoplay-policy=no-user-gesture-required'],
});
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://www.youtube.com' });
const out = {};
await ctx.route('https://www.youtube.com/**', (route) => {
  const u = new URL(route.request().url());
  if (u.pathname === '/clip.webm') return route.fulfill({ status: 200, contentType: 'video/webm', body: clip });
  if (u.pathname === '/iframe_api') return route.fulfill({ status: 200, contentType: 'text/javascript', body: `
    window.YT = { Player: function (id, opts) { var t0 = performance.now(), base = 0, playing = true; var self = this;
      this.getCurrentTime = function () { return base + (playing ? (performance.now() - t0) / 1000 : 0); };
      this.seekTo = function (s) { base = s; t0 = performance.now(); };
      this.playVideo = function () { if (!playing) { playing = true; t0 = performance.now(); } };
      this.pauseVideo = function () { base = this.getCurrentTime(); playing = false; };
      setTimeout(function () { opts.events.onReady({}); }, 50); window.__fakeFs = opts.playerVars.fs; } };
    setTimeout(function () { window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady(); }, 10);` });
  return route.fulfill({ status: 200, contentType: 'text/html', body: ytHtml });
});
let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
// extension: notes straight into storage, then Alt+S for a real share link
const notes = [{ id: 'a1', start: 1, end: 3, text: 'Late split step', emoji: '', x: 25, y: 72, w: 50 }, { id: 'a2', start: 2, end: 4, text: '', emoji: '👀', x: 25, y: 72, w: 50 }];
await sw.evaluate(([k, v]) => chrome.storage.local.set({ [k]: v }), ['fr_notes:' + VID, notes]);
await sw.evaluate(([k, v]) => chrome.storage.local.set({ [k]: v }), ['fr_shapes:' + VID, [{ id: 's1', type: 'arrow', start: 0, end: 30, x1: 20, y1: 30, x2: 50, y2: 60, label: 'Watch the split step' }, { id: 's2', type: 'circle', start: 0, end: 30, x1: 55, y1: 20, x2: 80, y2: 50 }, { id: 's3', type: 'box', start: 100, end: 110, x1: 10, y1: 70, x2: 40, y2: 90 }]]);
const page = await ctx.newPage();
await page.goto(`https://www.youtube.com/watch?v=${VID}`);
await page.waitForSelector('#fr-panel', { state: 'attached' });
await page.waitForTimeout(800);
await page.keyboard.press('Alt+KeyS');
await page.waitForTimeout(9000); // short-link service is unreachable here, so it falls back to the long link
let link = '';
try { link = await page.evaluate(() => navigator.clipboard.readText()); } catch (e) { out.clipErr = String(e); }
if (!link) { link = await page.evaluate(() => { const i = document.querySelector('#fr-sharebox input'); return i ? i.value : ''; }); }
out.link = link.slice(0, 70) + '…';
const payload = link.split('#')[1] || '';
const parsed = parsePayload(payload);
out.serverAcceptsExtensionPayload = !!parsed; out.serverSeesNotes = parsed ? parsed.n.length : null; out.serverSeesShapes = parsed && parsed.s ? parsed.s.length : 0; out.serverLabel = parsed && parsed.s ? parsed.s[0][7] : null;
// viewer: serve public/index.html at the real origin
const vpage = await ctx.newPage();
await ctx.route('https://filmroom-viewer.netlify.app/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(new URL('../../public/index.html', import.meta.url).pathname, 'utf8') }));
const verrs = []; vpage.on('pageerror', (e) => verrs.push(String(e))); vpage.on('console', (m) => { if (m.type() === 'error') verrs.push(m.text()); });
console.log('payload ok?', !!parsed, payload.length);
await vpage.goto('https://filmroom-viewer.netlify.app/?plain#' + payload);
await vpage.waitForSelector('#viewer:not([hidden])', { timeout: 8000 });
out.viewerShapes = await vpage.locator('#shapes .shape').count(); out.viewerShapesOn = await vpage.locator('#shapes .shape.on').count(); out.sub = await vpage.locator('#sub').textContent();
out.viewerLabels = await vpage.locator('.sh-label.on').allTextContents(); out.listRows = await vpage.locator('#list li').count(); out.listShapeRows = await vpage.locator('#list button.li-shape').allTextContents();
await vpage.locator('.sh-ctl button[data-sh=off]').click(); out.afterShapesOff = { shapes: await vpage.locator('#shapes .shape.on').count(), labels: await vpage.locator('.sh-label.on').count(), notesStillOn: (await vpage.locator('#vo .vo-item').count()) >= 0 }; await vpage.locator('.sh-ctl button[data-sh=on]').click(); await vpage.waitForTimeout(400); out.afterShapesOn = await vpage.locator('#shapes .shape.on').count();
out.viewerNoteCount = await vpage.locator('#list li').count();
const probe = async () => vpage.evaluate(() => [...document.querySelectorAll('#vo .vo-item')].map((e) => e.textContent.trim()));
const samples = [];
for (let i = 0; i < 20; i++) { await vpage.waitForTimeout(250); if (i === 8) await vpage.screenshot({ path: '' + (process.env.SMOKE_DIR || '/tmp/smoke') + '/viewer_on.png' }); samples.push((await vpage.evaluate(() => window.__t = 0, 0), (await probe()).join('|') || '-')); }
out.overlayTimeline = samples.join(' , ');
out.fsParam = await vpage.evaluate(() => window.__fakeFs); out.fsButtonVisible = await vpage.locator('#fs').isVisible();
await vpage.locator('.vo-ctl button[data-vo=off]').click(); await vpage.evaluate(() => window.__fr.setVo(false, false));
await vpage.evaluate(() => { /* restart the fake clock into the active window */ });
out.afterOff = (await probe()).length; out.shapesOnAfterOff = await vpage.locator('#shapes .shape.on').count();
await vpage.screenshot({ path: '' + (process.env.SMOKE_DIR || '/tmp/smoke') + '/viewer.png' });
out.viewerErrors = verrs.slice(0, 4);
console.log(JSON.stringify(out, null, 1));
await ctx.close();
