'use strict';
// Film Room content script, part 6 of 13. Loaded in order (see manifest.json); all parts share one scope.

// ---------------------------------------------------------------
// BUILD UI
// ---------------------------------------------------------------
function buildOverlay() {
  overlay = document.createElement('div');
  overlay.id = 'fr-overlay';

  // --- note stack: notes on screen at the same time stack upward, oldest at the bottom ---
  stackEl = document.createElement('div');
  stackEl.id = 'fr-stack';
  overlay.appendChild(stackEl);
  freeEl = document.createElement('div');
  freeEl.id = 'fr-free';
  overlay.appendChild(freeEl);
  // Clicks on notes never reach YouTube (they would pause the video); dragging is handled per note.
  [stackEl, freeEl].forEach((c) => ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerup', 'contextmenu'].forEach((t) => c.addEventListener(t, stopEvent)));

  // --- toast ---
  toastEl = document.createElement('div');
  toastEl.id = 'fr-toast';
  overlay.appendChild(toastEl);

  // --- capture / edit box (Alt+N, or the pencil in the list) ---
  captureEl = document.createElement('div');
  captureEl.id = 'fr-capture';

  const rowTop = document.createElement('div');
  rowTop.className = 'fr-cap-row';
  captureLabel = document.createElement('span');
  captureLabel.className = 'fr-cap-label';
  rowTop.appendChild(captureLabel);
  const emojiBar = document.createElement('span');
  emojiBar.className = 'fr-emojibar';
  emojiBtns = EMOJIS.map((e) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fr-emo fr-k-' + e.k;
    b.textContent = e.c;
    b.title = e.m;
    b.setAttribute('aria-label', e.m);
    b.addEventListener('mousedown', (ev) => ev.preventDefault()); // keep typing focus in the text box
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      pickEmoji(pickedEmoji === e.c ? '' : e.c); // click again to clear
    });
    emojiBar.appendChild(b);
    return b;
  });
  rowTop.appendChild(emojiBar);
  captureEl.appendChild(rowTop);

  // Where the note starts: a fixed line (it never ticks while you type) with - / + to fine-tune it.
  const rowStart = document.createElement('div');
  rowStart.className = 'fr-cap-row fr-cap-startrow';
  startLabel = document.createElement('span');
  startLabel.className = 'fr-cap-dur fr-cap-start';
  const mkNudge = (txt, dir, tip) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fr-btn fr-nudge';
    b.textContent = txt;
    b.title = tip;
    b.addEventListener('mousedown', (ev) => ev.preventDefault()); // keep typing focus in the text box
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      nudgeStart(dir * NUDGE_STEP);
    });
    return b;
  };
  nudgeMinus = mkNudge('\u2212 ' + NUDGE_STEP + ' s', -1, 'Start the note ' + NUDGE_STEP + ' second earlier');
  nudgePlus = mkNudge('+ ' + NUDGE_STEP + ' s', 1, 'Start the note ' + NUDGE_STEP + ' second later');
  rowStart.appendChild(startLabel);
  rowStart.appendChild(nudgeMinus);
  rowStart.appendChild(nudgePlus);
  captureEl.appendChild(rowStart);

  textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.maxLength = 200;
  textInput.placeholder = 'Add a note, or just pick an emoji';
  textInput.title = 'Enter saves \u00b7 Esc cancels';
  textInput.className = 'fr-cap-text';
  captureEl.insertBefore(textInput, rowStart); // kind, then the words, then when and how long
  textInput.addEventListener('input', syncAutoDuration);

  const rowDur = document.createElement('div');
  rowDur.className = 'fr-cap-row';
  const durCaption = document.createElement('span');
  durCaption.className = 'fr-cap-dur';
  durCaption.textContent = 'Stays';
  secsInput = document.createElement('input');
  secsInput.type = 'range';
  secsInput.min = String(MIN_DURATION);
  secsInput.max = String(MAX_DURATION);
  secsInput.step = String(DURATION_STEP);
  secsInput.className = 'fr-cap-secs';
  secsInput.title = 'How long the note stays on screen. Shorten it if the camera cuts away.';
  secsInput.addEventListener('input', () => {
    durTouched = true;
    durByUser = true;
    updateDurLabel();
  });
  durLabel = document.createElement('span');
  durLabel.className = 'fr-cap-dur fr-cap-durval';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'fr-btn fr-btn-primary';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', saveCapture);
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'fr-btn fr-btn-text';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', cancelCapture);
  capDelBtn = document.createElement('button');
  capDelBtn.type = 'button';
  capDelBtn.className = 'fr-btn fr-btn-text fr-cap-del';
  capDelBtn.textContent = 'Delete';
  capDelBtn.title = 'Delete this note (you can undo it for a few seconds)';
  capDelBtn.style.display = 'none';
  capDelBtn.addEventListener('click', () => {
    const id = editingId;
    if (!id) return;
    closeCapture(true);
    deleteNote(id);
  });
  rowDur.appendChild(durCaption);
  rowDur.appendChild(secsInput);
  rowDur.appendChild(durLabel);
  rowDur.appendChild(saveBtn);
  rowDur.appendChild(cancelBtn);
  rowDur.appendChild(capDelBtn);
  captureEl.appendChild(rowDur);
  captureHint = document.createElement('div'); // only while editing a saved note
  captureHint.className = 'fr-cap-hint';
  captureHint.textContent = 'Drag the note on the video to move it. Drag its corner to reshape it.';
  captureEl.appendChild(captureHint);
  overlay.appendChild(captureEl);

  // --- share box: only shown if the clipboard is blocked, so the link can be copied by hand ---
  shareBoxEl = document.createElement('div');
  shareBoxEl.id = 'fr-sharebox';
  const shareLabel = document.createElement('span');
  shareLabel.className = 'fr-cap-label';
  shareLabel.textContent = 'Copy this link (Ctrl+C)';
  shareInput = document.createElement('input');
  shareInput.type = 'text';
  shareInput.readOnly = true;
  shareInput.className = 'fr-cap-text';
  const shareClose = document.createElement('button');
  shareClose.type = 'button';
  shareClose.className = 'fr-btn';
  shareClose.textContent = 'Close';
  shareClose.addEventListener('click', closeShareBox);
  shareBoxEl.appendChild(shareLabel);
  shareBoxEl.appendChild(shareInput);
  shareBoxEl.appendChild(shareClose);
  overlay.appendChild(shareBoxEl);

  // Keep YouTube's keyboard shortcuts (space, f, k, m...) from firing while typing.
  [textInput, secsInput, shareInput].forEach((input) => {
    ['keydown', 'keyup', 'keypress'].forEach((type) => input.addEventListener(type, onInputKey));
  });
  // Keep clicks in our UI from toggling play/pause or triggering the player.
  const mouseTypes = ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'contextmenu'];
  isolate(captureEl, mouseTypes);
  isolate(shareBoxEl, mouseTypes);

  // --- undo bar (shown for a few seconds after you delete a note) ---
  undoEl = document.createElement('div');
  undoEl.id = 'fr-undo';
  undoTextEl = document.createElement('span');
  undoTextEl.textContent = 'Note deleted.';
  const undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.className = 'fr-btn';
  undoBtn.textContent = 'Undo';
  undoBtn.addEventListener('click', undoDelete);
  undoEl.appendChild(undoTextEl);
  undoEl.appendChild(undoBtn);
  overlay.appendChild(undoEl);
  isolate(undoEl, mouseTypes);

  buildPanel();

  // --- version badge (hover for the shortcuts) ---
  if (SHOW_BADGE) {
    debugEl = document.createElement('div');
    debugEl.id = 'fr-debug';
    let ver = '';
    try {
      const m = chrome.runtime.getManifest();
      ver = m.version_name || m.version || '';
    } catch (e) { /* extension reloaded: no badge version */ }
    debugEl.textContent = 'Film Room' + (ver ? ' v' + ver : '');
    debugEl.title = 'Alt+N add note\nAlt+B bookmark\nAlt+E end note\nAlt+S share\nAlt+P panel\nAlt+, and Alt+. step through notes';
    isolate(debugEl, mouseTypes);
    overlay.appendChild(debugEl);
  }
}

// Merge your notes and shared notes into one sorted list for display.
// Shared notes you don't already have. A shared note identical to one of yours (same time, length, text and
// emoji, e.g. you opened a link to your own notes) is hidden, so nothing shows twice. Nothing is deleted:
// if you later delete your copy, the shared one shows again.
function shownShared() {
  return sharedNotes.filter((s) => !notes.some((n) =>
    Math.abs(n.start - s.start) < 0.05 && Math.abs(n.end - s.end) < 0.05 &&
    (n.text || '') === (s.text || '') && (n.emoji || '') === (s.emoji || '')));
}

function rebuildView() {
  const mine = notes.map((n) => ({ start: n.start, end: n.end, text: n.text, emoji: n.emoji || '', shared: false, ref: n }));
  const theirs = shownShared().map((n) => ({ start: n.start, end: n.end, text: n.text, emoji: n.emoji || '', shared: true, ref: n }));
  viewNotes = mine.concat(theirs).sort((a, b) => a.start - b.start || (a.shared ? 1 : 0) - (b.shared ? 1 : 0));
}

function renderNotes() {
  noteEls.forEach((el) => el.remove());
  noteEls = viewNotes.map((n) => {
    const el = document.createElement('div');
    const info = emojiInfo(n.emoji);
    el.className = 'fr-item fr-text' + (n.shared ? ' fr-shared' : '') + (info ? ' fr-k-' + info.k : '') +
      (n.emoji && !n.text ? ' fr-emoji-only' : '');
    if (n.emoji) {
      const em = document.createElement('span');
      em.className = 'fr-emoji fr-tile';
      em.textContent = n.emoji;
      el.appendChild(em);
    }
    if (n.text) {
      const span = document.createElement('span');
      span.className = 'fr-label';
      span.textContent = n.text; // textContent, never innerHTML
      el.appendChild(span);
    }
    if (n.shared) el.appendChild(avatarEl());
    const timer = document.createElement('span'); // time left on screen; the main loop shrinks it
    timer.className = 'fr-timer';
    el.appendChild(timer);
    el._timer = timer;
    el.title = n.shared ? 'Drag to move \u00b7 drag the corner to reshape \u00b7 \u2212 / + for text size \u00b7 double-click to put it back' : 'Double-click to edit \u00b7 drag to move \u00b7 drag the corner to reshape \u00b7 \u2212 / + for text size';
    const grip = document.createElement('span');
    grip.className = 'fr-note-grip';
    grip.title = 'Drag to reshape this note (the text size stays the same)';
    el.appendChild(grip);
    const ctl = document.createElement('span');
    ctl.className = 'fr-note-ctl';
    [['\u2212', -1, 'Smaller text'], ['+', 1, 'Bigger text']].forEach((def) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = def[0];
      b.title = def[2];
      b.addEventListener('pointerdown', stopEvent); // pressing a button never starts a drag
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        stepNoteSize(el, n.ref, def[1]);
      });
      ctl.appendChild(b);
    });
    if (!n.shared) { // a note of yours: edit it right here (the same as the pencil in the lists)
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'fr-nc-edit';
      edit.textContent = '\u270E';
      edit.title = 'Edit this note: text, emoji, how long it stays (or double-click it)';
      edit.addEventListener('pointerdown', stopEvent);
      edit.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openCapture(n.ref);
      });
      ctl.appendChild(edit);
    }
    const back = document.createElement('button'); // only on a note you have moved (CSS)
    back.type = 'button';
    back.className = 'fr-nc-back';
    back.textContent = '\u21BA';
    back.title = 'Put this note back in its usual place';
    back.addEventListener('pointerdown', stopEvent);
    back.addEventListener('click', (ev) => {
      ev.stopPropagation();
      unplaceNote(n.ref);
    });
    ctl.appendChild(back);
    el.appendChild(ctl);
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest && e.target.closest('.fr-note-ctl')) return;
      beginNotePointer(e.target === grip ? 'resize' : 'move', e, el, n.ref);
    });
    // Double-click edits your own note. (A note shared with you cannot be edited: there it still puts a moved note back.)
    el.addEventListener('dblclick', () => {
      if (n.shared) unplaceNote(n.ref);
      else openCapture(n.ref);
    });
    placeNoteEl(el, n.ref);
    syncNoteCtl(el, n.ref);
    return el;
  });
  markEditing();
  refreshPanel();
}

// Scrolling helpers for the two lists. They only ever scroll the list itself, never the page.
function rowVisible(box, row) {
  const b = box.getBoundingClientRect();
  const r = row.getBoundingClientRect();
  return r.top >= b.top - 1 && r.bottom <= b.bottom + 1;
}

// Bring a row fully into view (nothing moves if it already is). False if the list is not on screen right now.
function revealRow(box, row) {
  if (!box || !row || !box.clientHeight) return false;
  const b = box.getBoundingClientRect();
  const r = row.getBoundingClientRect();
  if (r.top < b.top) box.scrollTop -= b.top - r.top;
  else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom;
  return true;
}

// A note or bookmark was just added: the panel list follows it, so the newest one is never hidden below the fold.
function followMark(note) {
  followPanel = note;
}

function applyPanelFollow() {
  if (!followPanel || !panelListEl) return;
  const i = viewNotes.findIndex((v) => v.ref === followPanel);
  const row = i >= 0 ? panelRows[i] : null;
  if (!row) { followPanel = null; return; }
  if (revealRow(panelListEl, row)) followPanel = null; // otherwise the panel is not on screen: it scrolls when it is
}

// ---- small helpers ----
const round1 = (v) => Math.round(v * 10) / 10;
const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---- the notes on the video: each one can be moved and scaled on its own ----
const sizeOf = (ref) => (ref && (ref.size === -1 || ref.size === 1) ? ref.size : 0);

// A note you never touched flows in the stack (earliest on top, newest at the bottom).
// One you moved or scaled sits where you put it, at its own size.
function placeNoteEl(el, ref) {
  const placed = !!(ref && ref.placed === true);
  const host = placed ? freeEl : stackEl;
  if (el.parentElement !== host) host.appendChild(el);
  el.classList.toggle('fr-moved', placed);
  const mult = SIZE_MULT[sizeOf(ref)];
  el.style.fontSize = mult === 1 ? '' : mult + 'em'; // the text size comes from the - / + step, whether moved or not
  if (placed) {
    el.style.left = ref.x + '%';
    el.style.top = ref.y + '%';
    el.style.width = ref.w + '%';
  } else {
    el.style.left = el.style.top = el.style.width = '';
  }
}

function syncNoteCtl(el, ref) {
  const sz = sizeOf(ref);
  const btns = el.querySelectorAll('.fr-note-ctl button');
  if (btns[0]) btns[0].disabled = sz <= -1;
  if (btns[1]) btns[1].disabled = sz >= 1;
  const info = el.querySelector('.fr-note-ctl');
  if (info) info.title = 'Text size: ' + SIZE_NAMES[sz];
}

// The - / + on a note: one step smaller or bigger, for this note only.
function stepNoteSize(el, ref, delta) {
  const next = clampNum(sizeOf(ref) + delta, -1, 1);
  if (next === sizeOf(ref)) return;
  if (next === 0) delete ref.size;
  else ref.size = next;
  persistNote(ref);
  placeNoteEl(el, ref);
  if (ref.placed === true && overlay) { // bigger text makes a taller box: keep it inside the picture
    const o = overlay.getBoundingClientRect();
    const hPct = o.height ? el.getBoundingClientRect().height / o.height * 100 : 0;
    if (ref.y + hPct > 100) {
      ref.y = round1(Math.max(0, 100 - hPct));
      placeNoteEl(el, ref);
      persistNote(ref);
    }
  }
  syncNoteCtl(el, ref);
}

// Keep a note placement sane (also used on data read back from storage)
function cleanPlacement(n) {
  if (n.size !== -1 && n.size !== 1) delete n.size;
  if (n.placed !== true) {
    delete n.placed;
    return n;
  }
  const w = clampNum(isFinite(Number(n.w)) ? Number(n.w) : DEFAULT_POS.w, NOTE_MIN_W, NOTE_MAX_W);
  n.w = round1(w);
  n.x = round1(clampNum(isFinite(Number(n.x)) ? Number(n.x) : DEFAULT_POS.x, 0, 100 - w));
  n.y = round1(clampNum(isFinite(Number(n.y)) ? Number(n.y) : DEFAULT_POS.y, 0, 95));
  return n;
}

function persistNote(ref) {
  if (notes.indexOf(ref) >= 0) persist();
  else persistShared();
}

function unplaceNote(ref) {
  if (!ref || ref.placed !== true) return;
  delete ref.placed; // (its text size step is kept)
  ref.x = DEFAULT_POS.x;
  ref.y = DEFAULT_POS.y;
  ref.w = DEFAULT_POS.w;
  persistNote(ref);
  renderNotes();
  toast('Note put back in the stack.');
}

function beginNotePointer(kind, e, el, ref) {
  if (e.button != null && e.button > 0) return;
  if (!overlay || !ref) return;
  const o = overlay.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (!o.width || !o.height) return;
  e.preventDefault();
  e.stopPropagation();
  noteDrag = {
    kind: kind, el: el, ref: ref, sx: e.clientX, sy: e.clientY, started: false,
    x0: (r.left - o.left) / o.width * 100, y0: (r.top - o.top) / o.height * 100, w0: r.width / o.width * 100,
    ow: o.width, oh: o.height,
  };
  const move = (ev) => {
    const d = noteDrag;
    if (!d) return;
    const dxPx = ev.clientX - d.sx;
    const dyPx = ev.clientY - d.sy;
    if (!d.started) {
      if (Math.abs(dxPx) < DRAG_SLOP && Math.abs(dyPx) < DRAG_SLOP) return; // still just a click
      d.started = true; // from here on this note is placed by you, not by the stack
      d.ref.placed = true;
      d.el.classList.add('fr-dragging');
    }
    const dx = dxPx / d.ow * 100;
    const dy = dyPx / d.oh * 100;
    let w = d.w0;
    let x = d.x0;
    let y = d.y0;
    if (d.kind === 'move') {
      x = clampNum(d.x0 + dx, 0, 100 - d.w0);
      y = d.y0 + dy;
    } else {
      w = clampNum(d.w0 + dx, NOTE_MIN_W, Math.min(NOTE_MAX_W, 100 - d.x0));
    }
    d.ref.x = round1(x);
    d.ref.w = round1(w);
    d.ref.y = round1(clampNum(y, 0, 95));
    placeNoteEl(d.el, d.ref);
    const hPct = d.el.getBoundingClientRect().height / d.oh * 100; // its height depends on its width and text
    if (d.ref.y + hPct > 100) {
      d.ref.y = round1(Math.max(0, 100 - hPct));
      placeNoteEl(d.el, d.ref);
    }
  };
  const up = () => {
    document.removeEventListener('pointermove', move, true);
    document.removeEventListener('pointerup', up, true);
    document.removeEventListener('pointercancel', up, true);
    const d = noteDrag;
    noteDrag = null;
    if (!d) return;
    d.el.classList.remove('fr-dragging');
    if (d.started) {
      cleanPlacement(d.ref);
      persistNote(d.ref);
      // If you let go away from the note, the browser aims the click at the player behind it, which would pause the video. Swallow it.
      const swallow = (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      document.addEventListener('click', swallow, true);
      setTimeout(() => document.removeEventListener('click', swallow, true), 60);
    }
  };
  document.addEventListener('pointermove', move, true);
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', up, true);
}
