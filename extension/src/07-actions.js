'use strict';
// Film Room content script, part 7 of 13. Loaded in order (see manifest.json); all parts share one scope.

// ---------------------------------------------------------------
// ACTIONS
// ---------------------------------------------------------------
function seekTo(seconds) {
  const v = getVideo();
  if (v) v.currentTime = seconds;
}

function deleteNote(id) {
  const gone = notes.find((n) => n.id === id);
  if (!gone) return;
  notes = notes.filter((n) => n.id !== id);
  persist();
  rebuildView();
  renderNotes();
  showUndo('Note deleted.', () => {
    if (!notes.some((n) => n.id === gone.id)) notes.push(gone);
    notes.sort((a, b) => a.start - b.start);
    followMark(gone);
    persist();
    rebuildView();
    renderNotes();
    toast('Note restored.');
  });
}

// Whatever you just deleted can be brought back for a few seconds (one note, or all the shared notes).
function showUndo(label, restore) {
  if (!undoEl) return;
  undoRestore = restore;
  undoTextEl.textContent = label;
  clearTimeout(undoTimer);
  undoEl.style.display = 'flex';
  undoTimer = setTimeout(hideUndo, UNDO_MS);
}

function hideUndo() {
  clearTimeout(undoTimer);
  undoRestore = null;
  if (undoEl) undoEl.style.display = 'none';
}

function undoDelete() {
  const restore = undoRestore;
  if (!restore) return;
  hideUndo();
  restore();
}

// Alt+E: the camera cut away and your note is still up? End it right here.
function endNoteHere() {
  const v = getVideo();
  if (!v) return;
  const t = v.currentTime;
  const live = notes.filter((n) => isLive(n, t));
  if (!live.length) {
    const sharedLive = shownShared().some((n) => isLive(n, t));
    toast(sharedLive ? 'The note on screen was shared with you, so you can\u2019t change it.' : 'None of your notes is on screen right now.');
    return;
  }
  const n = live.reduce((a, b) => (b.start > a.start ? b : a)); // the most recent one
  n.end = Math.round(Math.max(n.start + MIN_DURATION, Math.floor(t * 10) / 10) * 10) / 10;
  persist();
  rebuildView();
  renderNotes();
  toast('Note ends here (' + fmt(n.end) + ').');
}

// Is this note on screen at video time t? Jumping to a note (list click, Edit, Previous / Next) puts the video
// exactly at the note's start, but players often land a hair before it (frame snapping), and a paused video would
// then never show the note. So a note is live from a moment before its start.
const isLive = (n, t) => t >= n.start - LIVE_EPS && t < n.end;

// ---- lead-in ----
const cleanSizeStep = (v) => (v === -1 || v === 1 ? v : 0);
const cleanLead = (v) => (LEAD_CHOICES.indexOf(v) >= 0 ? v : LEAD_DEFAULT);

// How far back to start a new note. Playing: the full lead-in. Paused: only if you paused a moment ago
// (you stopped to react). A video you stepped or sat on for a while is where you meant it to be.
function leadFor(v) {
  if (!v.paused) return leadIn;
  return pausedAt && Date.now() - pausedAt <= PAUSE_GRACE_MS ? leadIn : 0;
}

const startFor = (pressed, lead) => Math.max(0, Math.floor((pressed - lead) * 10 + 1e-6) / 10);

function onVideoEvent(e) {
  const t = e.target;
  if (!t || t.tagName !== 'VIDEO') return;
  if (e.type === 'pause') pausedAt = Date.now();
  else if (e.type !== 'seeked') pausedAt = 0; // play, or a seek while paused: no longer "just paused"
  tick(); // react at once: a seek or play/pause changes what should be on screen
}

function setLead(n) {
  leadIn = cleanLead(n);
  saveSettings();
  renderPanelBm();
  toast(leadIn ? 'New notes will start ' + leadIn + ' s before you press.' : 'New notes will start right where you press.');
}

// ---- quick bookmark ----
const bookmarkWindowActive = () => !!lastBookmarkId && Date.now() < bookmarkUntil;

// Alt+B: one key, one bookmark. Press 1-8 right after to pick a different emoji.
function bookmarkHere() {
  if (captureOpen) return;
  const v = getVideo();
  if (!v || !currentVideoId) return;
  const pressed = Math.floor(v.currentTime * 10 + 1e-6) / 10; // the frozen moment of the key press
  const t = startFor(pressed, leadFor(v));                  // bookmarks start a little before it
  const near = notes.find((n) => !n.text && n.emoji && Math.abs(n.start - t) < 1);
  if (near) { // a second press at the same moment never makes a duplicate
    lastBookmarkId = near.id;
    bookmarkUntil = Date.now() + BOOKMARK_WINDOW_MS;
    toast('Already bookmarked here.', BOOKMARK_WINDOW_MS, { keys: true });
    return;
  }
  const note = {
    id: newId(),
    start: t,
    end: Math.round((pressed + BOOKMARK_DURATION) * 10) / 10,
    x: DEFAULT_POS.x,
    y: DEFAULT_POS.y,
    w: DEFAULT_POS.w,
    text: '',
    emoji: bookmarkEmoji,
  };
  notes.push(note);
  notes.sort((a, b) => a.start - b.start);
  followMark(note);
  persist();
  rebuildView();
  renderNotes();
  lastBookmarkId = note.id;
  bookmarkUntil = Date.now() + BOOKMARK_WINDOW_MS;
  toast('Bookmarked at ' + fmt(t) + (t < pressed ? ' (' + round1(pressed - t) + ' s early)' : ''), BOOKMARK_WINDOW_MS, { emoji: bookmarkEmoji, keys: true });
}

// The + Bookmark buttons say which emoji they drop.
function syncBookmarkButtons() {
  if (panelBmBtn) panelBmBtn.textContent = '+ Bookmark ' + bookmarkEmoji;
}

// Make this emoji what Alt+B drops from now on (remembered). Bookmarks you already made are not touched.
function setBookmarkDefault(index) {
  bookmarkEmoji = EMOJIS[index].c;
  bmOpen = false;
  saveSettings();
  syncBookmarkButtons();
  renderPanelBm();
  toast('Alt+B will now drop ' + EMOJIS[index].m + '.', 3500, { emoji: EMOJIS[index].c });
}

function setBookmarkEmoji(index) {
  const note = notes.find((n) => n.id === lastBookmarkId);
  if (!note) return;
  note.emoji = EMOJIS[index].c;
  persist();
  rebuildView();
  renderNotes();
  bookmarkUntil = Date.now() + BOOKMARK_WINDOW_MS; // you can still change your mind
  toast(EMOJIS[index].m + ' at ' + fmt(note.start), BOOKMARK_WINDOW_MS, { emoji: EMOJIS[index].c, keys: true });
}

function clearShared() {
  const prev = sharedNotes;
  const prevShapes = sharedShapes;
  const count = shownShared().length;
  if (!prev.length && !prevShapes.length) return;
  sharedNotes = [];
  sharedShapes = [];
  persistShared();
  persistSharedShapes();
  rebuildView();
  renderNotes();
  renderShapes();
  syncShapePanel();
  showUndo(count ? count + (count === 1 ? ' shared note removed.' : ' shared notes removed.') : 'Shared shapes removed.', () => {
    if (sharedNotes.length || sharedShapes.length) { // a new link was opened in the meantime: don't overwrite it
      toast('Newer shared notes are loaded, so the removed ones were not brought back.');
      return;
    }
    sharedNotes = prev;
    sharedShapes = prevShapes;
    persistShared();
    persistSharedShapes();
    rebuildView();
    renderNotes();
    renderShapes();
    syncShapePanel();
    toast('Shared notes restored.');
  });
}

// opt.emoji: show it on a tile before the message. opt.keys: add the "press 1-8 to change it" row (after Alt+B).
function toast(message, ms, opt) {
  if (!toastEl) return;
  opt = opt || {};
  toastEl.textContent = '';
  toastEl.classList.toggle('fr-toast-tile', !!opt.emoji);
  const main = document.createElement('div');
  main.className = 'fr-toast-main';
  if (opt.emoji) {
    const info = emojiInfo(opt.emoji);
    const tile = emojiTile(opt.emoji);
    tile.classList.add('fr-toast-tile');
    if (info) tile.classList.add('fr-k-' + info.k);
    main.appendChild(tile);
  }
  const msg = document.createElement('span');
  msg.className = 'fr-toast-msg';
  msg.textContent = message;
  main.appendChild(msg);
  toastEl.appendChild(main);
  if (opt.keys) {
    const keys = document.createElement('div');
    keys.className = 'fr-toast-keys';
    const cap = document.createElement('span');
    cap.textContent = 'Change it:';
    keys.appendChild(cap);
    EMOJIS.forEach((e, i) => {
      const k = document.createElement('span');
      k.className = 'fr-toast-key';
      const num = document.createElement('i');
      num.textContent = String(i + 1);
      k.appendChild(num);
      k.appendChild(document.createTextNode(e.c));
      keys.appendChild(k);
    });
    toastEl.appendChild(keys);
  }
  toastEl.classList.add('fr-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('fr-on'), ms || 3500);
}

// ---- sharing ----
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    // fall through to the older method
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return !!ok;
  } catch (err) {
    return false;
  }
}

function closeShareBox() {
  if (shareBoxEl) shareBoxEl.style.display = 'none';
}

async function shareLink() {
  if (!currentVideoId) return;
  if (!notes.length && !shapes.length) {
    toast('No notes to share yet. Press Alt+N to add one.');
    return;
  }
  const title = (document.title || '').replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube\s*$/, '');
  let url;
  let isShort = false;
  try {
    const payload = await encodeShare(currentVideoId, title, notes, await getAuthorId(), shapes);
    toast('Making share link\u2026');
    const id = await createShortId(payload);
    isShort = !!id;
    url = SHARE_BASE + '#' + (id ? 's' + id : payload); // service unreachable: the long link still works
  } catch (err) {
    warn(err);
    toast('Couldn\u2019t build the share link.');
    return;
  }
  const ok = await copyText(url);
  if (ok) {
    toast(!isShort && url.length > LONG_LINK_WARN
      ? 'Link copied, but it\u2019s long (' + url.length + ' characters). Some apps may cut it off.'
      : 'Share link copied (' + notes.length + (notes.length === 1 ? ' note' : ' notes') + (shapes.length ? ', ' + shapes.length + (shapes.length === 1 ? ' shape' : ' shapes') : '') + ')');
  } else {
    shareInput.value = url;
    shareBoxEl.style.display = 'flex';
    shareInput.focus();
    shareInput.select();
  }
}

// ---- capture / edit ----
function pickEmoji(c) {
  pickedEmoji = c;
  emojiBtns.forEach((b, i) => b.classList.toggle('fr-sel', EMOJIS[i].c === c));
}

const sliderSecs = () => {
  const v = parseFloat(secsInput.value);
  return isFinite(v) ? v : DEFAULT_DURATION;
};

// How long a note's words need: 5 s after the press for a short one (as always), more for a long one, up to 12 s.
function autoDuration(text) {
  const n = (text || '').trim().length;
  if (!n) return DEFAULT_DURATION;
  const secs = clampNum(2 + n / 12, DEFAULT_DURATION, AUTO_CAP);
  return Math.round(secs / DURATION_STEP) * DURATION_STEP;
}

// As you type, the slider follows the length of the words, until you move it yourself.
// A new note gets its stay from the text. An old text-less note (a bookmark) that gains words gets the same stay on top
// of what it had; an old note that already had words is never changed this way.
function syncAutoDuration() {
  if (!captureOpen || durByUser) return;
  const text = textInput.value.trim();
  if (!editingId) {
    secsInput.value = String(autoDuration(text));
  } else if (editBookmarkLen != null) {
    if (text) {
      const len = Math.round((editBookmarkLen - BOOKMARK_DURATION + autoDuration(text)) / DURATION_STEP) * DURATION_STEP;
      secsInput.max = String(Math.max(parseFloat(secsInput.max) || MAX_DURATION, Math.ceil(len)));
      secsInput.value = String(len);
      durTouched = true; // from here the slider decides the end
    } else {
      secsInput.value = String(editBookmarkLen);
      durTouched = false; // back to a bookmark: it keeps its own end
    }
  } else {
    return;
  }
  updateDurLabel();
  updateStartLabel();
}

// Where the note will end. A new note stays up for the chosen time after you PRESSED the key
// (so the lead-in seconds are extra, not taken out of it). An old note keeps its end unless you move the slider.
function captureEndTime() {
  if (!editingId) return round1(capturePress + sliderSecs());
  if (durTouched) return round1(captureStart + sliderSecs());
  const n = notes.find((x) => x.id === editingId);
  return n ? n.end : round1(captureStart + sliderSecs());
}

function updateDurLabel() {
  durLabel.textContent = sliderSecs().toFixed(1) + ' s  \u00b7  ends at ' + fmt(captureEndTime());
}

function updateStartLabel() {
  let txt = 'Starts ' + fmt(captureStart);
  if (!editingId && capturePress > captureStart) txt += '  \u00b7  you pressed ' + fmt(capturePress);
  startLabel.textContent = txt;
  nudgeMinus.disabled = captureStart <= 0;
  nudgePlus.disabled = captureStart >= (editingId ? captureEndTime() - MIN_DURATION : capturePress) - 1e-6;
}

function nudgeStart(delta) {
  if (!captureOpen) return;
  const maxStart = editingId ? captureEndTime() - MIN_DURATION : capturePress;
  const next = round1(clampNum(captureStart + delta, 0, Math.max(0, maxStart)));
  if (next === captureStart) return;
  if (editingId) {
    const n = notes.find((x) => x.id === editingId);
    if (n && !durTouched) { // keep the end where it was; the slider shows the new length
      const len = Math.max(MIN_DURATION, round1(n.end - next));
      secsInput.max = String(Math.max(parseFloat(secsInput.max) || MAX_DURATION, Math.ceil(len)));
      secsInput.value = String(len);
    }
    const v = getVideo();
    if (v) v.currentTime = next; // show where it now starts
  }
  captureStart = next;
  updateStartLabel();
  updateDurLabel();
}

// note = one of your own notes to edit; leave it out for a new note at the current moment.
function openCapture(note) {
  if (!overlay || captureOpen) return;
  const video = getVideo();
  if (!video) return;

  wasPlaying = !video.paused;
  editingId = note ? note.id : null;
  durTouched = false;
  durByUser = false;
  editBookmarkLen = note && !note.text ? round1(note.end - note.start) : null;
  editSnap = note ? JSON.parse(JSON.stringify(note)) : null;
  // Only editing an old note pauses (and jumps to it). A NEW note leaves the video exactly as it is:
  // playing keeps playing, paused stays paused. The start time is frozen right now, at the key press.
  pausedByUs = !!note;
  if (note) video.pause();

  if (note) {
    captureStart = note.start;
    video.currentTime = note.start; // show the note on screen while you edit it
    const dur = Math.round((note.end - note.start) * 10) / 10;
    secsInput.max = String(Math.max(MAX_DURATION, Math.ceil(dur)));
    secsInput.value = String(dur);
    textInput.value = note.text;
    pickEmoji(note.emoji || '');
  } else {
    capturePress = Math.floor(video.currentTime * 10 + 1e-6) / 10; // floor, so the note is already live at this moment
    captureStart = startFor(capturePress, leadFor(video));
    secsInput.max = String(MAX_DURATION);
    secsInput.value = String(DEFAULT_DURATION);
    textInput.value = '';
    pickEmoji('');
  }

  captureLabel.textContent = note ? 'Edit note' : 'New note';
  updateStartLabel();
  updateDurLabel();
  // Editing: the box opens on the half of the picture the note is NOT in, so the note stays free to grab.
  captureEl.classList.toggle('fr-cap-top', !!note && (note.placed === true ? note.y > 40 : true));
  captureHint.style.display = note ? 'block' : 'none';
  capDelBtn.style.display = note ? '' : 'none';
  captureEl.style.display = 'flex';
  if (overlay) overlay.classList.add('fr-capturing'); // the notes step back while you write
  captureOpen = true;
  markEditing();
  textInput.focus();
}

// The note being edited stays bright, outlined and grabbable while the rest step back.
function markEditing() {
  noteEls.forEach((el, i) => {
    const vn = viewNotes[i];
    el.classList.toggle('fr-editing', !!(captureOpen && editingId && vn && !vn.shared && vn.ref && vn.ref.id === editingId));
  });
}

// Cancel: close the box and put the note back as it was (its place and size too, which you can change while editing).
function cancelCapture() {
  if (captureOpen && editingId && editSnap) {
    const n = notes.find((x) => x.id === editingId);
    if (n) {
      const keys = ['x', 'y', 'w', 'placed', 'size'];
      const before = JSON.stringify(keys.map((k) => n[k]));
      keys.forEach((k) => {
        if (editSnap[k] === undefined) delete n[k];
        else n[k] = editSnap[k];
      });
      if (JSON.stringify(keys.map((k) => n[k])) !== before) {
        persist();
        renderNotes();
      }
    }
  }
  closeCapture(true);
}

function closeCapture(resume) {
  if (!captureEl) return;
  captureEl.style.display = 'none';
  if (overlay) overlay.classList.remove('fr-capturing');
  captureOpen = false;
  editingId = null;
  editSnap = null;
  editBookmarkLen = null;
  markEditing();
  textInput.blur();
  const resumeIt = resume && wasPlaying && pausedByUs;
  pausedByUs = false;
  if (resumeIt) {
    const v = getVideo();
    if (v) {
      const p = v.play();
      if (p && p.catch) p.catch(() => {});
    }
  }
}

function saveCapture() {
  const text = textInput.value.trim();
  if (!text && !pickedEmoji) {
    if (editingId) {
      toast('Add some text or pick an emoji first.');
      return;
    }
    closeCapture(true); // a new note with nothing in it is just cancelled
    return;
  }

  const editing = editingId ? notes.find((n) => n.id === editingId) : null;
  if (editingId && !editing) {
    closeCapture(true); // the note was deleted while the box was open
    return;
  }

  const maxSecs = parseFloat(secsInput.max) || MAX_DURATION;
  let secs = parseFloat(secsInput.value);
  if (!isFinite(secs)) secs = DEFAULT_DURATION;
  secs = Math.min(maxSecs, Math.max(MIN_DURATION, secs));

  if (editing) {
    const end = captureEndTime(); // before the start moves
    editing.text = text;
    editing.emoji = pickedEmoji;
    editing.start = captureStart;  // you may have nudged it
    editing.end = Math.max(end, round1(captureStart + MIN_DURATION));
  } else {
    const added = {
      id: newId(),
      start: captureStart,
      end: Math.round((capturePress + secs) * 10) / 10,
      x: DEFAULT_POS.x,
      y: DEFAULT_POS.y,
      w: DEFAULT_POS.w,
      text: text,
      emoji: pickedEmoji,
    };
    notes.push(added);
    followMark(added); // the lists scroll to the new note (an edit never moves them)
  }
  notes.sort((a, b) => a.start - b.start);

  persist();
  rebuildView();
  renderNotes();
  closeCapture(true);
}

function onInputKey(e) {
  e.stopPropagation(); // never let YouTube see keys typed into our boxes
  if (e.type !== 'keydown') return;
  if (e.target === shareInput) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeShareBox();
    }
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    saveCapture();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    cancelCapture();
  }
}

function onKeyDown(e) {
  if (!overlay || overlay.style.display !== 'block') return; // not on a watch page, or an ad is playing
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (drawMode && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyZ') {
    e.preventDefault();
    e.stopPropagation();
    undoShape();
    return;
  }
  if (drawMode && !e.altKey && !e.ctrlKey && !e.metaKey) { // drawing: Esc leaves, 1-4 pick the tool (and YouTube's number-key seeking stays off)
    if (e.code === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      exitDraw(true);
      return;
    }
    if (/^Digit[1-4]$/.test(e.code)) {
      e.preventDefault();
      e.stopPropagation();
      setDrawTool(['arrow', 'circle', 'box', 'erase'][parseInt(e.code.slice(5), 10) - 1]);
      return;
    }
  }
  // Digits 1-8, only for a few seconds after Alt+B: pick the emoji (and keep YouTube from jumping the video).
  if (bookmarkWindowActive() && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && /^Digit[1-8]$/.test(e.code)) {
    e.preventDefault();
    e.stopPropagation();
    setBookmarkEmoji(parseInt(e.code.slice(5), 10) - 1);
    return;
  }
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;

  if (e.code === 'KeyN') {
    e.preventDefault();
    e.stopPropagation();
    dismissFirstRun();
    openCapture();
  } else if (e.code === 'KeyA') {
    e.preventDefault();
    e.stopPropagation();
    toggleDraw();
  } else if (e.code === 'KeyS') {
    e.preventDefault();
    e.stopPropagation();
    shareLink();
  } else if (e.code === 'KeyB') {
    e.preventDefault();
    e.stopPropagation();
    dismissFirstRun();
    bookmarkHere();
  } else if (e.code === 'KeyE') {
    e.preventDefault();
    e.stopPropagation();
    endNoteHere();
  } else if (e.code === 'KeyP') {
    e.preventDefault();
    e.stopPropagation();
    setPanel(!panelEnabled);
  } else if (e.code === 'Period') {
    e.preventDefault();
    e.stopPropagation();
    stepNote(1);
  } else if (e.code === 'Comma') {
    e.preventDefault();
    e.stopPropagation();
    stepNote(-1);
  }
}
