'use strict';
// Film Room content script, part 5 of 13. Loaded in order (see manifest.json); all parts share one scope.

// ---------------------------------------------------------------
// STORAGE (chrome.storage.local): your notes and shared notes are kept apart
// ---------------------------------------------------------------
function save(key, value) {
  try {
    const p = chrome.storage.local.set({ [key]: value });
    if (p && p.catch) p.catch(warn);
  } catch (err) {
    warn(err); // e.g. extension was reloaded while this tab was open: refresh the tab
  }
}

function persist() {
  if (currentVideoId) save(keyFor(currentVideoId), notes);
  updateStale(true);
  linkChanged(false);
}

// ---- Is the link you shared still the latest version? ----
// When you copy a share link, we keep a short fingerprint of each note and shape that went into it (only the parts
// a link carries: time, text, emoji, shape corners, label; where a note sits on the picture is not in a link).
// Comparing that with your notes now tells us how many changes the link does not include.
function hash32(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
const noteSig = (n) => hash32([round1(n.start), round1(n.end), n.text || '', n.emoji || ''].join('|'));
const shapeSig = (s) => hash32([round1(s.start), round1(s.end), s.type, round1(s.x1), round1(s.y1), round1(s.x2), round1(s.y2), s.label || ''].join('|'));

function makeShareSnap(noteList, shapeList) {
  const n = {};
  const s = {};
  noteList.forEach((x, i) => { n[x.id || 'i' + i] = noteSig(x); });
  shapeList.forEach((x, i) => { s[x.id || 'i' + i] = shapeSig(x); });
  return { t: Date.now(), n: n, s: s, w: false };
}

function cleanLastShare(v) {
  if (!v || typeof v !== 'object' || !isFinite(v.t)) return null;
  const clean = (m) => {
    const out = {};
    if (m && typeof m === 'object') {
      Object.keys(m).slice(0, 2000).forEach((k) => { if (typeof m[k] === 'string') out[k.slice(0, 40)] = m[k].slice(0, 12); });
    }
    return out;
  };
  return { t: v.t, n: clean(v.n), s: clean(v.s), w: !!v.w };
}

// Added + removed + changed, counted against the snapshot.
function countShareChanges(snap, noteList, shapeList) {
  let c = 0;
  const diff = (list, sigFn, old) => {
    const seen = {};
    list.forEach((x, i) => {
      const k = x.id || 'i' + i;
      seen[k] = true;
      if (old[k] !== sigFn(x)) c++; // new, or changed
    });
    Object.keys(old).forEach((k) => { if (!seen[k]) c++; }); // deleted
  };
  diff(noteList, noteSig, snap.n);
  diff(shapeList, shapeSig, snap.s);
  return c;
}

function saveShareSnap(videoId, snap) {
  save(LASTSHARE_PREFIX + videoId, snap);
  if (currentVideoId === videoId) {
    lastShare = snap;
    staleCount = 0;
    updateStale(false);
  }
}

// ---- Live share link ----
function cleanLink(v) {
  if (!v || typeof v !== 'object' || typeof v.id !== 'string' || !LINK_ID_RE.test(v.id) || typeof v.key !== 'string' || !LINK_KEY_RE.test(v.key)) return null;
  return { id: v.id, key: v.key, sig: typeof v.sig === 'string' ? v.sig.slice(0, 16) : '', title: typeof v.title === 'string' ? v.title.slice(0, 120) : '', t: isFinite(v.t) ? v.t : 0 };
}

// What the link carries (time, text, emoji, shape corners, label), as one short fingerprint. Where a note sits on the picture is not in a link.
const linkSig = (noteList, shapeList) => hash32(noteList.map(noteSig).join(',') + '|' + shapeList.map(shapeSig).join(','));

function saveLink(videoId, rec) {
  save(LINK_PREFIX + videoId, rec);
}

function persistLastShare() {
  if (currentVideoId && lastShare) save(LASTSHARE_PREFIX + currentVideoId, lastShare);
}

// This install's anonymous author id: made once, kept in storage, put in every link you make. When a link
// with your own id comes back to you, its notes are already yours, so they are not imported again.
let myAuthorId = '';
async function getAuthorId() {
  if (myAuthorId) return myAuthorId;
  try {
    const res = await chrome.storage.local.get(AUTHOR_KEY);
    const have = res && res[AUTHOR_KEY];
    if (typeof have === 'string' && AUTHOR_RE.test(have)) {
      myAuthorId = have;
      return myAuthorId;
    }
  } catch (err) {
    warn(err);
  }
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  myAuthorId = toB64Url(bytes); // 12 characters
  save(AUTHOR_KEY, myAuthorId);
  return myAuthorId;
}

function persistShared() {
  if (currentVideoId) save(sharedKeyFor(currentVideoId), sharedNotes);
}

function cleanList(list) {
  return Array.isArray(list)
    ? list.filter((n) => n && isFinite(n.start) && isFinite(n.end) && typeof n.text === 'string')
           .map((n) => cleanPlacement(Object.assign({}, n, { emoji: cleanEmoji(n.emoji) })))
           .sort((a, b) => a.start - b.start)
    : [];
}

function loadNotes(videoId) {
  try {
    const p = chrome.storage.local.get([keyFor(videoId), sharedKeyFor(videoId), SHAPES_PREFIX + videoId, SHARED_SHAPES_PREFIX + videoId, LASTSHARE_PREFIX + videoId, LINK_PREFIX + videoId]);
    p.then((res) => {
      if (currentVideoId !== videoId) return; // user already moved on
      notes = cleanList(res && res[keyFor(videoId)]);
      sharedNotes = cleanList(res && res[sharedKeyFor(videoId)]);
      shapes = cleanShapes(res && res[SHAPES_PREFIX + videoId]);
      sharedShapes = cleanShapes(res && res[SHARED_SHAPES_PREFIX + videoId]);
      lastShare = cleanLastShare(res && res[LASTSHARE_PREFIX + videoId]);
      linkRec = cleanLink(res && res[LINK_PREFIX + videoId]);
      if (linkRec) lastShare = null; // a live link is never "out of date"
      linkState = linkRec ? 'ok' : 'none';
      staleCount = 0;
      updateStale(false);
      updateLinkUI();
      linkChanged(true); // changes made while the site was unreachable (or in another tab) go up now
      rebuildView();
      renderNotes();
      renderShapes();
      syncShapePanel();
      return importFromHash(videoId);
    }).catch(warn);
  } catch (err) {
    warn(err);
  }
}

// If this page was opened from a shared link (youtube.com/watch?v=ID#fr=PAYLOAD), load those notes.
async function importFromHash(videoId) {
  const h = location.hash || '';
  if (h.indexOf('#fr=') !== 0) return;
  let result = null;
  try {
    result = await decodeShare(h.slice(4));
  } catch (err) {
    warn(err);
  }
  if (currentVideoId !== videoId) return;
  try {
    history.replaceState(null, '', location.pathname + location.search); // so a refresh doesn't re-import
  } catch (err) {
    warn(err);
  }
  if (!result || result.id !== videoId) {
    toast('That shared link couldn\u2019t be read.');
    return;
  }
  const me = await getAuthorId();
  if (currentVideoId !== videoId) return;
  if (result.author && result.author === me) {
    // Your own link: these notes are already yours. Also drop old shared copies (made before links carried
    // an author id, or from your own earlier links) so nothing shows twice.
    const keep = sharedNotes.filter((n) => n.a && n.a !== me);
    const keepShapes = sharedShapes.filter((n) => n.a && n.a !== me);
    if (keep.length !== sharedNotes.length || keepShapes.length !== sharedShapes.length) {
      sharedNotes = keep;
      sharedShapes = keepShapes;
      persistShared();
      persistSharedShapes();
      rebuildView();
      renderNotes();
      renderShapes();
      syncShapePanel();
    }
    toast('That\u2019s your own link, so your notes are already here.');
    return;
  }
  result.notes.forEach((n) => { n.a = result.author; }); // remember who these came from
  result.shapes.forEach((n) => { n.a = result.author; });
  sharedNotes = result.notes;
  sharedShapes = result.shapes.filter((s) => !shapes.some((m) => sameShape(m, s)));
  persistShared();
  persistSharedShapes();
  rebuildView();
  renderNotes();
  renderShapes();
  syncShapePanel();
  const fresh = shownShared().length;
  const drawn = sharedShapes.length;
  if (!fresh && !drawn) toast('Those notes are already in your list.');
  else if (!drawn) toast('Shared notes loaded (' + fresh + (fresh < sharedNotes.length ? ' new' : '') + '). Alt+L to see them.');
  else toast('Shared ' + (fresh ? fresh + (fresh === 1 ? ' note' : ' notes') + ' and ' : '') + drawn + (drawn === 1 ? ' shape' : ' shapes') + ' loaded.');
}
