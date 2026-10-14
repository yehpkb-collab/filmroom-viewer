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
    const p = chrome.storage.local.get([keyFor(videoId), sharedKeyFor(videoId), SHAPES_PREFIX + videoId, SHARED_SHAPES_PREFIX + videoId]);
    p.then((res) => {
      if (currentVideoId !== videoId) return; // user already moved on
      notes = cleanList(res && res[keyFor(videoId)]);
      sharedNotes = cleanList(res && res[sharedKeyFor(videoId)]);
      shapes = cleanShapes(res && res[SHAPES_PREFIX + videoId]);
      sharedShapes = cleanShapes(res && res[SHARED_SHAPES_PREFIX + videoId]);
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
