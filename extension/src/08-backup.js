'use strict';
// Film Room content script, part 8 of 13. Loaded in order (see manifest.json); all parts share one scope.

// ---------------------------------------------------------------
// BACKUP: Export all your notes to a file, Import them on another computer (or after a reinstall).
// The file is plain JSON:  { app, v:1, exported, notes: { <videoId>: [ ...your notes ] } }.
// Import is a merge: notes already there (same time, length, text and emoji) are skipped, nothing is overwritten.
// ---------------------------------------------------------------
async function exportAll() {
  let all;
  try {
    all = await chrome.storage.local.get(null);
  } catch (err) {
    warn(err);
    toast('Couldn’t read your notes. Reload the tab and try again.');
    return;
  }
  const out = {};
  let count = 0;
  let videos = 0;
  const drawings = {};
  let shapeCount = 0;
  Object.keys(all || {}).forEach((k) => {
    if (k.indexOf(SHAPES_PREFIX) === 0) {
      const sid = k.slice(SHAPES_PREFIX.length);
      const sl = all[k];
      if (YT_ID_RE.test(sid) && Array.isArray(sl) && sl.length) {
        drawings[sid] = sl;
        shapeCount += sl.length;
      }
      return;
    }
    if (k.indexOf(STORAGE_PREFIX) !== 0) return;
    const id = k.slice(STORAGE_PREFIX.length);
    const list = all[k];
    if (!YT_ID_RE.test(id) || !Array.isArray(list) || !list.length) return;
    out[id] = list;
    count += list.length;
    videos++;
  });
  if (!count && !shapeCount) {
    toast('No notes to export yet.');
    return;
  }
  const file = { app: EXPORT_APP, v: 1, exported: new Date().toISOString(), notes: out }; // v stays 1: shapes are an optional extra field
  if (shapeCount) file.shapes = drawings;
  const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'film-room-notes-' + new Date().toISOString().slice(0, 10) + '.json';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast('Exported ' + count + (count === 1 ? ' note' : ' notes') + (shapeCount ? ' and ' + shapeCount + (shapeCount === 1 ? ' shape' : ' shapes') : '') + (videos ? ' from ' + videos + (videos === 1 ? ' video.' : ' videos.') : '.'), 5000);
}

// A note read from an import file is untrusted: keep only what a note is allowed to hold.
function cleanImported(row) {
  if (!row || typeof row !== 'object') return null;
  const start = Number(row.start);
  const end = Number(row.end);
  if (!isFinite(start) || !isFinite(end) || start < 0 || start > 1000000 || end <= start || end - start > 3600) return null;
  const text = typeof row.text === 'string' ? row.text.trim().slice(0, MAX_TEXT) : '';
  const emoji = cleanEmoji(row.emoji);
  if (!text && !emoji) return null;
  const n = { id: '', start: round1(start), end: round1(end), text: text, emoji: emoji };
  ['placed', 'x', 'y', 'w', 'size'].forEach((k) => { if (row[k] !== undefined) n[k] = row[k]; });
  return cleanPlacement(n);
}

const sameNote = (a, b) =>
  Math.abs(a.start - b.start) < 0.05 && Math.abs(a.end - b.end) < 0.05 &&
  (a.text || '') === (b.text || '') && (a.emoji || '') === (b.emoji || '');

async function importFile(file) {
  if (!file) return;
  if (file.size > IMPORT_MAX_BYTES) {
    toast('That file is too big to be a Film Room export.');
    return;
  }
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (err) {
    toast('That isn’t a Film Room export file.');
    return;
  }
  if (!data || data.app !== EXPORT_APP || data.v !== 1 || !data.notes || typeof data.notes !== 'object' || Array.isArray(data.notes)) {
    toast('That isn’t a Film Room export file.');
    return;
  }
  const ids = Object.keys(data.notes).filter((id) => YT_ID_RE.test(id)).slice(0, IMPORT_MAX_VIDEOS);
  const drawnIn = data.shapes && typeof data.shapes === 'object' && !Array.isArray(data.shapes) ? data.shapes : {};
  const shapeIds = Object.keys(drawnIn).filter((id) => YT_ID_RE.test(id)).slice(0, IMPORT_MAX_VIDEOS);
  if (!ids.length && !shapeIds.length) {
    toast('No notes found in that file.');
    return;
  }
  let existing;
  try {
    existing = await chrome.storage.local.get(ids.map(keyFor).concat(shapeIds.map((id) => SHAPES_PREFIX + id)));
  } catch (err) {
    warn(err);
    toast('Couldn’t read your notes. Reload the tab and try again.');
    return;
  }
  const used = new Set();
  const fresh = () => {
    let id;
    do { id = newId(); } while (used.has(id));
    used.add(id);
    return id;
  };
  const writes = {};
  let added = 0;
  let skipped = 0;
  const touchedVideos = new Set();
  ids.forEach((vid) => {
    const incoming = Array.isArray(data.notes[vid]) ? data.notes[vid].slice(0, IMPORT_MAX_NOTES) : [];
    const have = cleanList(existing && existing[keyFor(vid)]);
    have.forEach((n) => used.add(n.id));
    let changed = false;
    incoming.forEach((row) => {
      const n = cleanImported(row);
      if (!n) return;
      if (have.some((h) => sameNote(h, n))) { skipped++; return; }
      n.id = fresh();
      have.push(n);
      added++;
      changed = true;
    });
    if (changed) {
      have.sort((a, b) => a.start - b.start);
      writes[keyFor(vid)] = have;
      touchedVideos.add(vid);
    }
  });
  let addedShapes = 0;
  shapeIds.forEach((vid) => {
    const have = cleanShapes(existing && existing[SHAPES_PREFIX + vid]);
    have.forEach((s) => used.add(s.id));
    let changed = false;
    cleanShapes(drawnIn[vid]).slice(0, IMPORT_MAX_SHAPES).forEach((s) => {
      if (have.some((h) => sameShape(h, s))) { skipped++; return; }
      if (have.length >= MAX_SHAPES) return;
      s.id = fresh();
      delete s.a;
      have.push(s);
      addedShapes++;
      changed = true;
    });
    if (changed) {
      have.sort((a, b) => a.start - b.start);
      writes[SHAPES_PREFIX + vid] = have;
      touchedVideos.add(vid);
    }
  });
  if (!added && !addedShapes) {
    toast(skipped ? 'Everything in that file is already here.' : 'No usable notes in that file.');
    return;
  }
  try {
    await chrome.storage.local.set(writes);
  } catch (err) {
    warn(err);
    toast('Couldn’t save the imported notes.');
    return;
  }
  if (currentVideoId) loadNotes(currentVideoId); // show them now if this video was in the file
  toast('Imported ' + added + (added === 1 ? ' note' : ' notes') + (addedShapes ? ' and ' + addedShapes + (addedShapes === 1 ? ' shape' : ' shapes') : '') + ' across ' + touchedVideos.size + (touchedVideos.size === 1 ? ' video' : ' videos') +
    (skipped ? ' (' + skipped + ' already here).' : '.'), 5000);
}
