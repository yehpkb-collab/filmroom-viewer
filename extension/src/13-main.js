'use strict';
// Film Room content script, part 13 of 13. Loaded in order (see manifest.json); all parts share one scope.

// ---------------------------------------------------------------
// VIEWER PAGE: a person with the extension who opens a shared link goes straight to
// YouTube with the notes on the video. (Add ?plain to the link to see the plain viewer page.)
// ---------------------------------------------------------------
// The viewer page (links that pointed at the retired GitHub Pages viewer no longer open anywhere).
const VIEWER_URLS = [new URL(SHARE_BASE)];

function isViewerPage() {
  return VIEWER_URLS.some((u) => location.origin === u.origin && location.pathname.indexOf(u.pathname) === 0);
}

async function viewerRedirect() {
  if (new URLSearchParams(location.search).has('plain')) return;
  let payload = location.hash.replace(/^#(fr=)?/, '');
  if (!payload) return;
  let result = null;
  try {
    if (SHORT_RE.test(payload)) payload = await fetchShortPayload(payload.slice(1)); // short link: look the notes up
    result = await decodeShare(payload); // validates the link; null if it is not a real share link
  } catch (err) {
    warn(err);
  }
  if (!result) return; // leave the viewer page to explain the problem
  const first = Math.min(result.notes.length ? result.notes[0].start : Infinity, result.shapes.length ? result.shapes[0].start : Infinity);
  const lead = Math.max(0, Math.floor(first) - 3); // start a few seconds before the first note
  const url = 'https://www.youtube.com/watch?v=' + result.id + (lead > 0 ? '&t=' + lead + 's' : '') + '#fr=' + payload;
  location.replace(url);
}

if (isViewerPage()) {
  viewerRedirect(); // nothing else to do on the viewer page
} else {
  loadSettings();
  watchSettings();
  document.addEventListener('keydown', onKeyDown, true);
  ['pause', 'play', 'seeking', 'seeked'].forEach((t) => document.addEventListener(t, onVideoEvent, true)); // media events don't bubble, so listen on the way down
  tick();
}
