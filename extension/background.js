// Film Room: toolbar button = docked-panel on/off switch.
// Click the toolbar icon to turn the panel on or off. A small "off" badge shows when it is off.
// The setting lives in chrome.storage.local under "fr_settings", the same place the page uses,
// so the toolbar button, Alt+P, and the Hide / Show buttons all stay in step (and across tabs).

const KEY = 'fr_settings';

async function isOn() {
  const res = await chrome.storage.local.get(KEY);
  const s = res && res[KEY];
  return !(s && s.panel === false); // default ON; anything unrecognised counts as ON
}

async function paint(on) {
  await chrome.action.setBadgeText({ text: on ? '' : 'off' });
  await chrome.action.setBadgeBackgroundColor({ color: '#6b6b6b' });
  await chrome.action.setTitle({
    title: on
      ? 'Film Room: docked panel is ON. Click to turn it off.'
      : 'Film Room: docked panel is OFF. Click to turn it on.',
  });
}

chrome.action.onClicked.addListener(async () => {
  const on = await isOn();
  const res = await chrome.storage.local.get(KEY);
  const current = (res && res[KEY]) || {};
  // Merge, so the other saved settings (Alt+B emoji, lead-in) are kept.
  await chrome.storage.local.set({ [KEY]: Object.assign({}, current, { panel: !on }) });
  await paint(!on);
});

// Keep the badge right when the setting is changed from the page (Alt+P, Hide, Show panel).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[KEY]) return;
  const v = changes[KEY].newValue;
  paint(!(v && v.panel === false));
});

// Paint on browser start, on install/reload, and whenever the worker wakes up.
chrome.runtime.onStartup.addListener(() => { isOn().then(paint); });
chrome.runtime.onInstalled.addListener(() => { isOn().then(paint); });
isOn().then(paint);

// ---- Short-link service ----
// The page script asks this worker to talk to the Film Room site, because YouTube's own page rules and
// cross-site limits don't apply here. Only the two calls below are allowed, and only to that one site.
const API = 'https://filmroom-viewer.netlify.app/api/share';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'fr-api' || sender.id !== chrome.runtime.id) return false;
  (async () => {
    try {
      let r;
      if (typeof msg.payload === 'string') { // create: POST the share payload
        r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: msg.payload });
      } else if (typeof msg.id === 'string' && /^[A-Za-z0-9_-]{10}$/.test(msg.id)) { // open: GET by id
        r = await fetch(API + '/' + msg.id, { cache: 'no-store' });
      } else {
        sendResponse({ ok: false, status: 0, text: '' });
        return;
      }
      sendResponse({ ok: r.ok, status: r.status, text: await r.text() });
    } catch (err) {
      sendResponse({ ok: false, status: 0, text: '' });
    }
  })();
  return true; // the answer is sent asynchronously
});
